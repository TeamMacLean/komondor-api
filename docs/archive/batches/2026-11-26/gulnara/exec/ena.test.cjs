'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {runExport,validateGraph,renderRoute,validateRows,verifySequenceFiles}=require('./ena.cjs');
const base=path.resolve(__dirname,'..'),repo=path.resolve(__dirname,'../../../../../..');
const scope=JSON.parse(syncFs.readFileSync(path.join(repo,'docs/archive/evidence/release-planning-20261030/gulnara-scope.json')));
const changePlan=JSON.parse(syncFs.readFileSync(path.join(base,'change-plan.json'))),enaPreview=JSON.parse(syncFs.readFileSync(path.join(base,'ena-fastq-preview.json')));
const routeSource=syncFs.readFileSync(path.join(repo,'routes/accessions.js'),'utf8'),storage=require(path.join(repo,'lib/storage-state'));
const clone=x=>JSON.parse(JSON.stringify(x)),id=x=>String(x?._id||x);
class ObjectId{constructor(value){this.value=value;}toString(){return this.value;}toJSON(){return this.value;}}
function fixture(original){
 const beforeDocuments=original?clone(original):{projects:[clone(scope.targetProject),...clone(scope.sourceProjects)],samples:[],runs:[],files:[],reads:[]};
 if(!original){
  for(const op of changePlan.operations){const row={_id:op.id,...clone(op.proposedIdentity),createdAt:'2021-08-21T19:12:48.902Z',accessions:[]};for(const[k,v]of Object.entries(op.businessChanges))row[k]=v.before;beforeDocuments[op.collection].push(row);}
  beforeDocuments.reads=[...enaPreview.sequenceFiles,...enaPreview.excludedFromSubmissionOnly].map(r=>({_id:r.readId,run:r.runId,file:r.fileId,paired:r.paired,sibling:r.siblingReadId}));
 }
 const documents=clone(beforeDocuments);documents.groups=[{_id:scope.targetProject.group,safeName:'ntalbot'}];
 for(const op of changePlan.operations){const row=documents[op.collection].find(x=>x._id===op.id);for(const[k,v]of Object.entries(op.businessChanges))row[k]=v.after;row.reconciliation={...(row.reconciliation||{}),version:1,operationId:'test-operation',identity:clone(op.proposedIdentity)};row.updatedAt='2026-11-26T13:00:00Z';}
 for(const row of documents.runs)row.createdAt=new Date(row.createdAt);
 const match=(row,q)=>Object.entries(q).every(([k,v])=>k==='$or'?v.some(x=>match(row,x)):v?.$in?v.$in.some(x=>id(row[k])===id(x)):id(row[k])===id(v));
 const db={collection(name){assert(Object.hasOwn(documents,name),'Unexpected collection');return {find(filter){const result=documents[name].filter(x=>match(x,filter));return {maxTimeMS(){return this;},async toArray(){return result;}};}};}};
 return {documents,beforeDocuments,db,ObjectId,apiRoot:repo,scope,changePlan,enaPreview,routeSource,storage,physicalVerifier:async()=>enaPreview.sequenceFiles.map(x=>({fileId:x.fileId,payloadRehashed:false}))};
}
async function temp(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gulnara-ena-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('actual deployed serializer emits31 raw read paths and24 reviewed FASTQs across12rows',async t=>{
 const f=fixture(),root=await temp(t);const r=await runExport({...f,outputDir:path.join(root,'export')});assert.equal(r.sequenceFiles,24);assert.equal(r.enaSubmission,false);
 const raw=await fs.readFile(path.join(root,'export/raw-scoped.csv'),'utf8'),filtered=await fs.readFile(path.join(root,'export/gulnara-ena.csv'),'utf8');
 assert(raw.split('\n')[0].endsWith(','),'Legacy heading format preserved');assert.equal((raw.match(/MD5\.txt/g)||[]).length,7);assert(!filtered.includes('MD5.txt'));assert.equal((filtered.match(/\.fq\.gz/g)||[]).length,24);assert.equal(filtered.trimEnd().split('\n').length,13);
 await assert.rejects(runExport({...f,outputDir:path.join(root,'export')}),/EEXIST/);
});
test('wrong post-change path fails before export',()=>{const f=fixture();f.documents.files[0].path='wrong';assert.throws(()=>validateGraph(f),/Post-reassignment/);});
test('changed accession or scientific metadata is refused',()=>{const f=fixture();f.documents.samples[0].accessions=['SAMEA_CHANGED'];assert.throws(()=>validateGraph(f),/Unrelated record metadata/);});
test('changed Read pairing is refused',()=>{const f=fixture();f.documents.reads[0].sibling='000000000000000000000000';assert.throws(()=>validateGraph(f),/Read metadata changed/);});
test('an additional Read row cannot be silently filtered',()=>{const f=fixture();f.documents.reads.push({...f.documents.reads[0],_id:'000000000000000000000001'});assert.throws(()=>validateGraph(f),/Read set/);});
test('wrong exclusion identity is refused',()=>{const f=fixture();f.enaPreview=clone(enaPreview);f.enaPreview.excludedFromSubmissionOnly[0].readId='000000000000000000000001';assert.throws(()=>validateGraph(f),/Read set/);});
test('actual CSV formula/quote protection remains in use',async()=>{const f=fixture();f.documents.runs[0].owner='=1+1';const r=await renderRoute({...f,reads:f.documents.reads,readsRoot:'/tsl/data/reads'});assert(r.csv.includes('"\'=1+1"'));});
test('missing physical metadata or a changed immutable receipt refuses verification',async t=>{
 const root=await temp(t),evidence=path.join(root,'evidence');await fs.mkdir(evidence);const filename=path.join(root,'test.fq.gz');await fs.writeFile(filename,'example');const st=await fs.stat(filename);
 const row={fileId:'000000000000000000000001',proposedFilePath:'test.fq.gz',proposedV1333Path:filename,bytes:st.size,sha256:'a'.repeat(64),crc64nvme:'AAAAAAAAAAA='};
 const meta=Object.fromEntries(['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].map(k=>[k,st[k]]));
 const r={operationId:'op',planSha256:'plan',copyDigest:'copy',fileId:row.fileId,destination:filename,sourceDigest:{bytes:row.bytes,sha256:row.sha256,crc64nvme:row.crc64nvme},destinationDigest:{bytes:row.bytes,sha256:row.sha256,crc64nvme:row.crc64nvme,metadata:meta}};
 const digest=crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');await fs.writeFile(path.join(evidence,'file-'+row.fileId+'.json'),JSON.stringify(r));await fs.writeFile(path.join(evidence,'copy-verified.json'),JSON.stringify({allVerified:true,files:1,operationId:'op',planSha256:'plan',copyDigest:'copy',receiptDigests:[{fileId:row.fileId,digest}]}));
 assert.equal((await verifySequenceFiles({enaPreview:{sequenceFiles:[row]},copyEvidenceDir:evidence,vmRoot:root})).length,1);
 await fs.appendFile(filename,'tamper');await assert.rejects(verifySequenceFiles({enaPreview:{sequenceFiles:[row]},copyEvidenceDir:evidence,vmRoot:root}),/metadata changed/);
});
const realSnapshot=process.env.GULNARA_TEST_BEFORE||'/Users/deeks/.codex/artifacts/gulnara-preflight-20261126/database-02.json';
test('rehearse actual observed scope with planned reassignment applied only in memory',{skip:!syncFs.existsSync(realSnapshot)},async t=>{
 const f=fixture(JSON.parse(syncFs.readFileSync(realSnapshot)).result.documents),root=await temp(t);const r=await runExport({...f,outputDir:path.join(root,'real-snapshot-export')});assert.equal(r.rows,12);assert.equal(r.sequenceFiles,24);assert.equal(r.excludedChecksumReads,7);
});
