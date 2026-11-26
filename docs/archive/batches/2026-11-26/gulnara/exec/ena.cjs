'use strict';
// Scoped post-reassignment export. Database access is find-only; output is a
// local review CSV, never an ENA submission or a change to application routes.
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const id=x=>x==null?null:String(x._id||x);
const plain=x=>JSON.parse(JSON.stringify(x));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(sort(plain(x)));
function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
const map=rows=>new Map(rows.map(x=>[id(x._id),x]));
const exact=(actual,expected,label)=>assert.deepEqual([...actual].sort(),[...expected].sort(),label);
async function safe(p){assert(path.isAbsolute(p)&&path.normalize(p)===p);let here=path.parse(p).root;for(const name of p.slice(here.length).split(path.sep).filter(Boolean)){here=path.join(here,name);const st=await fs.lstat(here);assert(!st.isSymbolicLink(),'Symlink in export path');if(here!==p)assert(st.isDirectory());}return fs.lstat(p);}

async function loadDocuments(db,ObjectId,scope,plan){
 const query=(collection,filter)=>db.collection(collection).find(filter).maxTimeMS(30000).toArray(),ids=xs=>xs.map(x=>new ObjectId(x));
 const projectIds=[scope.targetProject._id,...scope.sourceProjects.map(p=>p._id)],sampleIds=scope.matches.map(m=>m.sample._id),runIds=scope.matches.flatMap(m=>m.runs.map(r=>r._id)),fileIds=plan.operations.filter(o=>o.collection==='files').map(o=>o.id);
 const projects=await query('projects',{_id:{$in:ids(projectIds)}});
 const samples=await query('samples',{$or:[{_id:{$in:ids(sampleIds)}},{project:new ObjectId(scope.targetProject._id)}]});
 const runs=await query('runs',{$or:[{_id:{$in:ids(runIds)}},{sample:{$in:ids(sampleIds)}}]});
 const reads=await query('reads',{run:{$in:ids(runIds)}});
 const files=await query('files',{_id:{$in:ids(fileIds)}});
 const groups=await query('groups',{_id:new ObjectId(scope.targetProject.group)});
 return {projects,samples,runs,reads,files,groups};
}
function validateGraph({documents,beforeDocuments,scope,changePlan,enaPreview}){
 assert(beforeDocuments,'Preserved before-document snapshot is required');
 const expected={projects:[scope.targetProject._id,...scope.sourceProjects.map(p=>p._id)],samples:scope.matches.map(m=>m.sample._id),runs:scope.matches.flatMap(m=>m.runs.map(r=>r._id)),files:changePlan.operations.filter(o=>o.collection==='files').map(o=>o.id)};
 for(const [c,ids]of Object.entries(expected)){assert.equal(documents[c].length,ids.length,c+' count');exact(documents[c].map(x=>id(x._id)),ids,c+' identities');}
 const maps=Object.fromEntries(Object.entries(documents).map(([c,rows])=>[c,map(rows)]));
 assert.equal(documents.groups.length,1);assert.equal(id(documents.groups[0]._id),scope.targetProject.group);assert.equal(documents.groups[0].safeName,'ntalbot');assert.notEqual(documents.groups[0].deleted,true);
 const project=maps.projects.get(scope.targetProject._id);assert.equal(project.storage?.state||'hpc','hpc');
 for(const k of ['s3Uri','s3VerifiedAt','hpcVerifiedAbsentAt','archivedAt'])assert(project.storage?.[k]==null||project.storage[k]==='','Destination has unexpected archive evidence');
 for(const p of documents.projects){const before=beforeDocuments.projects.find(x=>id(x._id)===id(p._id));assert(before);assert.equal(stable(p),stable(before),'Project metadata changed outside reassignment');}
 const beforeMaps=Object.fromEntries(['samples','runs','files','reads'].map(c=>[c,map(beforeDocuments[c])]));
 for(const op of changePlan.operations){
  const actual=maps[op.collection].get(op.id),before=beforeMaps[op.collection].get(op.id);assert(actual&&before);
  assert.equal(actual.reconciliation?.version,1);assert(actual.reconciliation.operationId,'Missing administrative operation identity');
  const permitted=new Set(['reconciliation','reconciliationHistory','updatedAt',...Object.keys(op.businessChanges)]);
  for(const [key,change]of Object.entries(op.businessChanges))assert.equal(id(actual[key]),id(change.after),'Post-reassignment field differs: '+op.id+'/'+key);
  for(const [key,value]of Object.entries(op.proposedIdentity))assert.equal(id(actual.reconciliation?.identity?.[key]),id(value),'Identity pin differs: '+op.id+'/'+key);
  const strip=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!permitted.has(k)));
  assert.equal(stable(strip(actual)),stable(strip(before)),'Unrelated record metadata/accessions changed: '+op.id);
 }
 const selected=enaPreview.sequenceFiles,excluded=enaPreview.excludedFromSubmissionOnly,reviewed=[...selected,...excluded];
 assert.equal(selected.length,24);assert.equal(excluded.length,7);assert.equal(reviewed.length,31);
 exact(documents.reads.map(x=>id(x._id)),reviewed.map(x=>x.readId),'Read set differs from reviewed scope');
 exact(selected.map(x=>x.fileId),selected.map(x=>x.fileId).filter((v,i,a)=>a.indexOf(v)===i),'Duplicate FASTQ File');
 for(const row of reviewed){
  const r=maps.reads.get(row.readId),f=maps.files.get(row.fileId),run=maps.runs.get(row.runId),sample=maps.samples.get(row.sampleId);assert(r&&f&&run&&sample);
  assert.equal(id(r.run),row.runId);assert.equal(id(r.file),row.fileId);assert.equal(id(run.sample),row.sampleId);assert.equal(id(sample.project),scope.targetProject._id);
  assert.equal(f.path,row.proposedFilePath);assert.equal(f.originalName,row.originalName);assert.equal(run.name,row.runName);assert.equal(sample.name,row.sampleName);
  assert.equal(stable(r),stable(beforeMaps.reads.get(row.readId)),'Read metadata changed: '+row.readId);
  if(selected.some(x=>x.readId===row.readId)){
   assert(/\.f(?:ast)?q\.gz$/i.test(f.path));assert.equal(r.paired,true);assert.equal(id(r.sibling),row.siblingReadId);
   const sibling=maps.reads.get(row.siblingReadId);assert(sibling);assert.equal(id(sibling.sibling),row.readId);assert.equal(id(sibling.run),row.runId);
  }else {assert.equal(f.originalName,'MD5.txt');assert(f.path.endsWith('/MD5.txt'));}
 }
 for(const run of documents.runs)assert.equal(selected.filter(x=>x.runId===id(run._id)).length,2,'Exactly two FASTQs per Run required');
 return maps;
}
function queryFacade(rows){return {populate(){return this;},then(resolve,reject){return Promise.resolve(rows).then(resolve,reject);}};}
async function renderRoute({routeSource,documents,reads,readsRoot,storage}){
 const samples=map(documents.samples),groups=map(documents.groups),files=map(documents.files);
 const runs=documents.runs.map(r=>({...r,sample:samples.get(id(r.sample)),group:groups.get(id(r.group))}));
 const populatedReads=reads.map(r=>({...r,file:files.get(id(r.file))}));
 const model=rows=>({find(filter){assert.equal(stable(filter),'{}','Unexpected export query');return queryFacade(rows);}});
 const models={Project:model(documents.projects),Sample:model(documents.samples),Run:model(runs),Read:model(populatedReads),Group:model(documents.groups)};
 let handler;const router={route(url){return {all(){return this;},post(){return this;},get(fn){if(url==='/accessions/csv')handler=fn;return this;}};}};
 const modules={express:{Router:()=>router},mongoose:{Types:{ObjectId:{isValid:()=>false}}},path,
  './middleware':{isAuthenticated(){},hasFullRecordsAccess(){}},'../lib/utils/fullAccessUsers':{hasFullRecordsAccess:()=>true},
  './_utils':{handleError:(res,error)=>{throw error;}},'../lib/storage-state':storage};
 for(const[name,value]of Object.entries(models))modules['../models/'+name]=value;
 const logs=[],sandbox={module:{exports:{}},process:{env:{READS_ROOT_PATH:readsRoot}},console:{error:(...x)=>logs.push(x.join(' ')),warn:(...x)=>logs.push(x.join(' '))},require:name=>{assert(Object.hasOwn(modules,name),'Unexpected route dependency: '+name);return modules[name];}};
 vm.runInNewContext(routeSource+'\nmodule.exports={router,getMatrixOfData,HEADINGS,toCsvField};',sandbox,{timeout:1000,filename:'deployed-accessions.js'});
 assert(handler,'Actual route GET handler not found');let result,status;
 const res={status(n){status=n;return this;},send(value){result=value;return this;}};
 await handler({},res);assert.equal(status,200);assert.equal(typeof result.csv,'string');assert.deepEqual(logs,[],'Export skipped/unresolved a scoped row');
 const matrix=await sandbox.module.exports.getMatrixOfData();assert.equal(matrix.length,12);
 return {csv:result.csv,matrix:plain(matrix),headings:plain(sandbox.module.exports.HEADINGS)};
}
async function verifySequenceFiles({enaPreview,copyEvidenceDir,vmRoot='/mnt/reads'}){
 const files=[],completionPath=path.join(copyEvidenceDir,'copy-verified.json');assert((await safe(completionPath)).isFile());
 const completion=JSON.parse(await fs.readFile(completionPath,'utf8'));assert.equal(completion.allVerified,true);
 const receiptDigests=new Map(completion.receiptDigests.map(x=>[x.fileId,x.digest]));assert.equal(receiptDigests.size,completion.files);
 for(const row of enaPreview.sequenceFiles){
  const filename=path.join(vmRoot,row.proposedFilePath.replace(/^\//,''));assert.equal(filename,row.proposedV1333Path);
  const st=await safe(filename);assert(st.isFile(),'FASTQ is not a regular file');
  const receiptPath=path.join(copyEvidenceDir,'file-'+row.fileId+'.json');assert((await safe(receiptPath)).isFile());const r=JSON.parse(await fs.readFile(receiptPath,'utf8'));
  assert.equal(sha(JSON.stringify(r)),receiptDigests.get(row.fileId),'Immutable copy receipt changed');assert.equal(r.operationId,completion.operationId);assert.equal(r.planSha256,completion.planSha256);assert.equal(r.copyDigest,completion.copyDigest);
  assert.equal(r.fileId,row.fileId);assert.equal(r.destination,filename);
  for(const k of ['bytes','sha256','crc64nvme']){assert.equal(r.sourceDigest[k],row[k]);assert.equal(r.destinationDigest[k],row[k]);}
  const expected=r.destinationDigest.metadata;
  for(const k of ['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'])assert(k.endsWith('Ms')?Math.abs(st[k]-expected[k])<=1:st[k]===expected[k],'FASTQ metadata changed: '+row.fileId+'/'+k);
  files.push({fileId:row.fileId,path:filename,bytes:st.size,dev:st.dev,ino:st.ino,receiptSha256:sha(await fs.readFile(receiptPath)),payloadRehashed:false});
 }
 return files;
}
function validateRows(raw,filtered,preview,targetId){
 assert.deepEqual(raw.headings,filtered.headings);assert.equal(raw.headings[13],'list_of_read_files');
 const byRun=rows=>new Map(rows.map(r=>[r[10],r]));const a=byRun(raw.matrix),b=byRun(filtered.matrix);assert.equal(a.size,12);assert.equal(b.size,12);exact(a.keys(),b.keys(),'Run row identities differ');
 for(const[runId,row]of b){
  const before=a.get(runId);assert.deepEqual(row.slice(0,13),before.slice(0,13),'Filtering changed a non-file column');assert.equal(row[4],targetId);
  const expected=preview.sequenceFiles.filter(x=>x.runId===runId).map(x=>x.proposedDefaultExportPath);const removed=preview.excludedFromSubmissionOnly.filter(x=>x.runId===runId).map(x=>x.proposedDefaultExportPath);
  exact(row[13].split(';'),expected,'Filtered file list differs from exact reviewed FASTQs');exact(before[13].split(';'),[...expected,...removed],'Raw file list differs from reviewed 31 Reads');
 }
 assert.equal([...b.values()].reduce((n,r)=>n+r[13].split(';').length,0),24);
}
async function runExport({db,ObjectId,apiRoot,scope,changePlan,enaPreview,beforeDocuments,copyEvidenceDir,outputDir,readsRoot='/tsl/data/reads',vmRoot='/mnt/reads',routeSource,storage,physicalVerifier=verifySequenceFiles}){
 assert.equal(readsRoot,'/tsl/data/reads');assert.equal(vmRoot,'/mnt/reads');
 assert.equal(scope.targetProject._id,'6ae4ac89a6b876c643741d27');
 const documents=await loadDocuments(db,ObjectId,scope,changePlan);validateGraph({documents,beforeDocuments,scope,changePlan,enaPreview});
 const source=routeSource??await fs.readFile(path.join(apiRoot,'routes/accessions.js'),'utf8');
 const storageModule=storage??require(path.join(apiRoot,'lib/storage-state'));
 const raw=await renderRoute({routeSource:source,documents,reads:documents.reads,readsRoot,storage:storageModule});
 const excluded=new Set(enaPreview.excludedFromSubmissionOnly.map(x=>x.readId)),reads=documents.reads.filter(r=>!excluded.has(id(r._id)));
 const filtered=await renderRoute({routeSource:source,documents,reads,readsRoot,storage:storageModule});validateRows(raw,filtered,enaPreview,scope.targetProject._id);
 const fileChecks=await physicalVerifier({enaPreview,copyEvidenceDir,vmRoot});assert.equal(fileChecks.length,24);
 // Detect changed/deleted scoped graph rows across export construction.
 const reread=await loadDocuments(db,ObjectId,scope,changePlan);assert.equal(stable(documents),stable(reread),'Scoped database changed during export');
 const validation={at:new Date().toISOString(),kind:'gulnara-scoped-ena-export',status:'validated_local_export_not_submitted',databaseWrites:false,enaSubmission:false,rows:12,rawReadFiles:31,sequenceFiles:24,excludedChecksumReads:7,recordsReclassifiedOrDeleted:false,
  sourceRouteSha256:sha(source),sourceRoute:'routes/accessions.js',serializer:'Actual deployed /accessions/csv GET handler in isolated VM with query-only scoped facades',readsRoot,vmRoot,
  rawCsvSha256:sha(raw.csv),filteredCsvSha256:sha(filtered.csv),fileChecks,limitations:['Scoped export, not a request to the live authenticated endpoint.','No fresh payload hash; immutable copy receipts and current regular-file metadata checked.','No submission or ENA accession writes.']};
 await safe(path.dirname(outputDir));await fs.mkdir(outputDir,{mode:0o700});
 const outputs={'raw-scoped.csv':raw.csv,'gulnara-ena.csv':filtered.csv,'vm-paths.txt':enaPreview.sequenceFiles.map(x=>x.proposedV1333Path).join('\n')+'\n','validation.json':JSON.stringify(validation,null,2)+'\n'};
 for(const[name,value]of Object.entries(outputs))await fs.writeFile(path.join(outputDir,name),value,{flag:'wx',mode:0o600});
 return validation;
}
module.exports={loadDocuments,validateGraph,renderRoute,validateRows,verifySequenceFiles,runExport};
