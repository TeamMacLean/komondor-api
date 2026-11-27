'use strict';
// One inspected six-project retirement. No payload deletion, AWS operation,
// storage/archive edits, history erasure, implicit retry or automatic rollback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process'),os=require('node:os');
const ROOT='/mnt/reads',API='/storage/www/komondor-api';
const COLLECTIONS=['projects','samples','runs','reads','additionalfiles','files','ingestjobs','newsitems'];
const TARGETS={
 '5fc012bda3efcb29338b7cf9':['skamoun-002','skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01'],
 '5fc012bda3efcb29338b7cf5':['skamoun-003','skamoun/saunderd_pstriiformis_South_African_isolates'],
 '5fc012bda3efcb29338b7d5c':['skamoun-005','skamoun/saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68'],
 '5fc012bda3efcb29338b7d7a':['skamoun-013','skamoun/xiao_scr74'],
 '5fc012bda3efcb29338b7d0d':['skamoun-015','skamoun/saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01'],
 '5fc012bda3efcb29338b7cf8':['skamoun-016','skamoun/saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83'],
};
const TYPED={promoteValues:false,promoteLongs:false,promoteBuffers:false};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const id=x=>String(x?._id||x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&Object.getPrototypeOf(x)===Object.prototype?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
function read(filename){const absolute=path.resolve(filename);let p=path.parse(absolute).root;for(const part of absolute.slice(p.length).split('/')){p=path.join(p,part);assert(!fs.lstatSync(p).isSymbolicLink(),'Symlink in evidence path');}assert(fs.lstatSync(absolute).isFile());return fs.readFileSync(absolute);}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function alive(pid){assert(Number.isSafeInteger(pid)&&pid>1,'Invalid process PID');try{process.kill(pid,0);return true;}catch(e){if(e.code==='EPERM')return true;if(e.code==='ESRCH')return false;throw e;}}
function mutationWindow({directory,receiptBytes,digest,executionAt,apiHead,outputDir,isAlive=alive,pid=process.pid}){
 const pack=path.resolve(directory),receipt=JSON.parse(receiptBytes),receiptPath=path.join(pack,'window/paused.json');
 assert.equal(fs.realpathSync(pack),pack,'Unsafe window directory');assert(fs.lstatSync(pack).isDirectory());
 assert.equal(receipt.windowDirectory,pack);assert.equal(receipt.windowOperator,'tsldata');assert.equal(receipt.actor,'deeks');assert.equal(receipt.planSha256,digest);
 assert.match(receipt.runId,/^[a-f0-9-]{36}$/);assert(Number.isSafeInteger(receipt.controllerPid)&&receipt.controllerPid>1);
 assert.deepEqual(receipt.projectIds.slice().sort(),Object.keys(TARGETS).sort());
 for(const name of ['allApiInstancesStopped','powerPaused','nudgePaused','webPaused','externalWritersFrozen','directApiCallersFrozen','backupIndependentlyRetained'])assert.equal(receipt[name],true,'Missing window fence: '+name);
 const services=['komondor-api','komondor-power','komondor-nudge','komondor-web'];assert.equal(receipt.services.length,4);
 assert.deepEqual(receipt.services.map(s=>s.name).sort(),services.sort());for(const s of receipt.services){assert.equal(s.status,'stopped');assert(!s.pid);}
 const lockPath=path.join(pack,'mutation.lock'),reopenPath=path.join(pack,'window-reopen.lock'),manifestPath=path.join(pack,'retirement-execution.json');
 const token={kind:'kamoun-retirement-mutation-lock-v1',runId:receipt.runId,pid,controllerPid:receipt.controllerPid,planSha256:digest};let claimed=false,lockStat;
 const assertOpen=()=>{assert(!fs.existsSync(reopenPath),'Controller has begun reopening');assert(isAlive(receipt.controllerPid),'Service-window controller is not alive');assert(read(receiptPath).equals(receiptBytes),'Paused receipt changed');assert(Date.now()<Date.parse(receipt.expiresAt),'Service window expired');};
 const writeExclusive=(filename,value,mode)=>{const fd=fs.openSync(filename,'wx',mode);let stat;try{fs.fchmodSync(fd,mode);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);stat=fs.fstatSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(filename));return stat;};
 const release=()=>{if(!claimed)return;const stat=fs.lstatSync(lockPath);assert(!stat.isSymbolicLink()&&stat.ino===lockStat.ino&&stat.dev===lockStat.dev,'Mutation lock changed');assert.deepEqual(JSON.parse(read(lockPath)),token,'Mutation lock ownership changed');fs.unlinkSync(lockPath);syncDirectory(pack);claimed=false;};
 const claim=()=>{assertOpen();assert(!fs.existsSync(manifestPath),'Prior retirement execution requires a new inspected window');lockStat=writeExclusive(lockPath,token,0o644);claimed=true;try{assertOpen();writeExclusive(manifestPath,{kind:'kamoun-retirement-execution-v1',runId:receipt.runId,pid,controllerPid:receipt.controllerPid,executionAt,planSha256:digest,apiHead,outputDir},0o644);assertOpen();}catch(e){release();throw e;}};
 const check=()=>{assert(claimed,'Mutation lock not held');assertOpen();assert.deepEqual(JSON.parse(read(lockPath)),token,'Mutation lock changed');};
 return{claim,check,release,receipt};
}
function validatePlan(plan,now=Date.now()){
 assert.equal(plan.kind,'kamoun-direct-disposal-retirement-v1');assert.equal(plan.version,1);assert.equal(plan.actor,'deeks');assert.equal(plan.datastoreRoot,ROOT);assert.match(plan.apiHead,/^[a-f0-9]{40}$/);
 const prepared=Date.parse(plan.preparedAt),expires=Date.parse(plan.expiresAt);assert(Number.isFinite(prepared)&&Number.isFinite(expires)&&prepared<=now&&now<expires&&expires-prepared<=21600000,'Stale/invalid retirement plan');
 assert.equal(plan.targets.length,6);assert.deepEqual(Object.fromEntries(plan.targets.map(t=>[t.projectId,[t.entryId,t.relativeRoot]])),TARGETS);
 assert(plan.databaseIdentity&&plan.databaseIdentity.name==='komondor'&&plan.databaseIdentity.collectionUuid,'Missing database identity');
 assert.deepEqual(Object.keys(plan.graph.collections).sort(),COLLECTIONS.slice().sort());
 assert.equal(plan.noS3Copy,true);assert.equal(plan.manualFilesystemDeletionRequired,true);assert.equal(plan.retainHistory,true);
 assert(plan.decisionAuthority&&typeof plan.decisionAuthority==='string');
 assert(plan.inventory?.success&&plan.inventory.kind==='kamoun-direct-disposal-inventory-v1');assert.equal(plan.inventory.projects.length,6);assert.equal(plan.inventory.regularFiles,1217);assert.equal(plan.inventory.regularBytes,790004575062);assert.equal(plan.inventory.symlinks,1);
 for(const field of ['inventoryToolSha256','baselineSha256','heldPathsSha256'])assert.match(plan[field],/^[a-f0-9]{64}$/);
 assert(plan.graph.protectedCollections?.projects?.length===13,'Missing protected Project snapshots');
 for(const t of plan.targets){assert(Number.isSafeInteger(t.expectedFiles)&&t.expectedFiles>0);assert(Number.isSafeInteger(t.expectedBytes)&&t.expectedBytes>0);const observed=plan.inventory.projects.find(p=>p.projectId===t.projectId);assert(observed?.rootMetadata&&Array.isArray(observed.entries));assert.equal(observed.relativeRoot,t.relativeRoot);assert.equal(observed.entries.filter(e=>e.type==='file').length,t.expectedFiles);assert.equal(observed.entries.filter(e=>e.type==='file').reduce((n,e)=>n+e.size,0),t.expectedBytes);}
}
function makeEngine({bson,ObjectId}){
 const unpack=b=>bson.deserialize(Buffer.from(b,'base64'),TYPED),pack=d=>bson.serialize(d).toString('base64');
 const equal=(a,b)=>bson.serialize({value:canonical(a)}).equals(bson.serialize({value:canonical(b)}));
 const decode=graph=>Object.fromEntries(COLLECTIONS.map(c=>{const seen=new Set();return[c,graph.collections[c].map(r=>{assert.match(r.id,/^[a-f0-9]{24}$/);assert(!seen.has(r.id),'Duplicate scoped ID');seen.add(r.id);const d=unpack(r.bson);assert.equal(id(d),r.id);return d;})];}));
 const encode=data=>({collections:Object.fromEntries(COLLECTIONS.map(c=>[c,data[c].map(d=>({id:id(d),bson:pack(d)}))]))});
 function ownership(data,plan){
  const targets=new Map(plan.targets.map(t=>[t.projectId,t]));assert.equal(data.projects.length,6);assert.deepEqual(data.projects.map(id).sort(),[...targets.keys()].sort());
  const owners=new Map();const put=(c,d,p)=>{assert(targets.has(p),'Foreign/orphan closure document');owners.set(c+':'+id(d),p);return p;};
  const owner=(c,key)=>{const p=owners.get(c+':'+id(key));assert(p,'Missing parent in closure');return p;};
  for(const p of data.projects){const target=targets.get(id(p));assert.equal(p.path,'/'+target.relativeRoot);put('projects',p,id(p));}
  for(const s of data.samples){const p=owner('projects',s.project);assert(typeof s.path==='string'&&s.path.startsWith('/'+targets.get(p).relativeRoot+'/'),'Sample path outside its Project');put('samples',s,p);}
  for(const r of data.runs){const p=owner('samples',r.sample);assert(typeof r.path==='string'&&r.path.startsWith('/'+targets.get(p).relativeRoot+'/'),'Run path outside its Project');put('runs',r,p);}
  for(const r of data.reads)put('reads',r,owner('runs',r.run));
  for(const a of data.additionalfiles){const roots=['project','sample','run'].filter(k=>a[k]).map(k=>owner(k==='project'?'projects':k==='sample'?'samples':'runs',a[k]));assert(roots.length>0&&new Set(roots).size===1,'Cross-parent AdditionalFile');put('additionalfiles',a,roots[0]);}
  const fileOwners=new Map();for(const c of ['reads','additionalfiles'])for(const d of data[c]){assert(d.file,'Reference missing File');const list=fileOwners.get(id(d.file))||[];list.push(owner(c,d));fileOwners.set(id(d.file),list);}
  const fileIds=new Set(data.files.map(id));for(const f of fileOwners.keys())assert(fileIds.has(f),'Referenced File missing');
  const observed=new Map(plan.inventory.projects.flatMap(t=>t.entries.filter(e=>e.type==='file').map(e=>['/'+t.relativeRoot+'/'+e.path,{projectId:t.projectId,size:e.size}])));
  const seenPaths=new Set();
  for(const f of data.files){const observedFile=observed.get(f.path);assert(observedFile,'File is outside exact physical inventory');assert(!seenPaths.has(f.path),'Duplicate File path');seenPaths.add(f.path);const refs=fileOwners.get(id(f))||[];assert(refs.every(p=>p===observedFile.projectId),'Shared/cross-project File');put('files',f,observedFile.projectId);}
  assert.equal(seenPaths.size,observed.size,'Physical inventory has uncatalogued files');
  for(const r of data.reads)if(r.sibling){assert.equal(owner('reads',r.sibling),owner('reads',r),'Read sibling crosses project');}
  for(const j of data.ingestjobs){const roots=[['runId','runs'],['run','runs'],['sample','samples'],['project','projects']].filter(([k])=>j[k]).map(([k,c])=>owner(c,j[k]));assert(roots.length&&new Set(roots).size===1,'Cross-parent/orphan IngestJob');put('ingestjobs',j,roots[0]);assert(['done','failed'].includes(j.status),'Active ingest job');}
  for(const n of data.newsitems){const key=id(n.typeId),roots=['projects','samples','runs'].map(c=>owners.get(c+':'+key)).filter(Boolean);assert.equal(roots.length,1,'NewsItem parent differs');put('newsitems',n,roots[0]);}
  for(const r of data.runs)assert(!['pending','processing','moving','queued','running','verifying'].includes(r.status)&&!['pending','processing','running','queued','verifying','in_progress'].includes(r.md5VerificationStatus),'Active run/MD5 work');
  return owners;
 }
 async function collect(db,plan){
  const O=values=>values.map(x=>new ObjectId(id(x))),query=async(c,q)=>db.collection(c).find(q,TYPED).sort({_id:1}).toArray();
  const paths=plan.targets.map(t=>new RegExp('^/?'+t.relativeRoot.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)'));
  const data={};data.projects=await query('projects',{_id:{$in:O(plan.targets.map(t=>t.projectId))}});
  data.samples=await query('samples',{$or:[{project:{$in:O(data.projects)}},{path:{$in:paths}}]});
  data.runs=await query('runs',{$or:[{sample:{$in:O(data.samples)}},{path:{$in:paths}}]});
  data.reads=await query('reads',{run:{$in:O(data.runs)}});
  data.additionalfiles=await query('additionalfiles',{$or:[{project:{$in:O(data.projects)}},{sample:{$in:O(data.samples)}},{run:{$in:O(data.runs)}}]});
  const referenced=[...new Set([...data.reads,...data.additionalfiles].map(d=>id(d.file)))];
  data.files=await query('files',{$or:[{_id:{$in:O(referenced)}},{path:{$in:paths}}]});
  data.ingestjobs=await query('ingestjobs',{$or:[{runId:{$in:O(data.runs)}},{run:{$in:O(data.runs)}},{sample:{$in:O(data.samples)}},{project:{$in:O(data.projects)}}]});
  const newsIds=[...data.projects,...data.samples,...data.runs];
  data.newsitems=await query('newsitems',{typeId:{$in:[...O(newsIds),...newsIds.map(id)]}});
  const readSet=new Set(data.reads.map(id)),additionalSet=new Set(data.additionalfiles.map(id));
  for(const r of await query('reads',{$or:[{file:{$in:O(data.files)}},{sibling:{$in:O(data.reads)}}]}))assert(readSet.has(id(r)),'Outside Read references scoped File/sibling');
  for(const a of await query('additionalfiles',{file:{$in:O(data.files)}}))assert(additionalSet.has(id(a)),'Outside AdditionalFile shares scoped File');
  const targetIds=new Set(Object.keys(TARGETS));
  for(const p of await query('projects',{path:{$in:paths}}))assert(targetIds.has(id(p)),'Outside Project claims target subtree');
  ownership(data,plan);return data;
 }
 async function checkProtected(db,plan){
  const scoped=new Set(COLLECTIONS.flatMap(c=>plan.graph.collections[c].map(r=>c+':'+r.id)));
  for(const [collection,rows] of Object.entries(plan.graph.protectedCollections)){
   assert(COLLECTIONS.includes(collection),'Unapproved protected collection');assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
   for(const row of rows){assert(!scoped.has(collection+':'+row.id),'Retired/protected overlap');const before=unpack(row.bson);assert.equal(id(before),row.id);const actual=await db.collection(collection).findOne({_id:new ObjectId(row.id)},TYPED);assert(equal(actual,before),'Protected record changed: '+collection+'/'+row.id);}
  }
 }
 function buildOperations(plan,digest,executionAt){
  const data=decode(plan.graph),owners=ownership(data,plan),at=new Date(executionAt);assert(Number.isFinite(+at));const operations=[];
  const targets=new Map(plan.targets.map(t=>[t.projectId,t]));
  for(const collection of COLLECTIONS)for(const before of data[collection]){
   assert(!before.reconciliation?.retiredAt,'Plan contains an already-retired record');assert(before.reconciliationHistory===undefined||Array.isArray(before.reconciliationHistory),'Malformed existing history');
   if(before.reconciliation)assert.equal(before.reconciliation.version.valueOf(),1);assert(!before.reconciliation||before.reconciliation.operationId,'Malformed existing reconciliation');
   if(collection==='projects'){
    assert(!before.storage?.state||before.storage.state==='hpc','Project already archived/migrating');
    assert(!before.archiveMigration||Object.keys(before.archiveMigration).length===0,'Unexpected archive migration');
    for(const field of ['s3Uri','s3VerifiedAt','hpcVerifiedAbsentAt','archivedAt'])assert(before.storage?.[field]===undefined||before.storage[field]===null||before.storage[field]==='','Unexpected S3/archive evidence');
    if(before.preserveOnHpcUntil!==undefined&&before.preserveOnHpcUntil!==null)assert(before.preserveOnHpcUntil instanceof Date&&+before.preserveOnHpcUntil<=+at,'Active/invalid HPC preservation');
   }
   const owner=owners.get(collection+':'+id(before)),target=targets.get(owner),operationId=sha(Buffer.from(digest+':'+collection+':'+id(before)));
   const after=unpack(pack(before));const identity=Object.fromEntries(['path','name','safeName','owner','group','project','sample','run','file','originalName'].filter(k=>after[k]!==undefined).map(k=>[k,after[k]]));
   after.reconciliation=before.reconciliation?{...after.reconciliation,retiredAt:at}:{version:1,operationId,batchId:plan.batchId||'kamoun-direct-disposal-2026-11-27',entryId:target.entryId,identity,planSha256:digest,retiredAt:at};
   after.reconciliationHistory=[...(after.reconciliationHistory||[]),{version:1,kind:'administrative-retirement',operationId,batchId:plan.batchId||'kamoun-direct-disposal-2026-11-27',entryId:target.entryId,at,actor:plan.actor,reason:'Approved direct disposal without an S3 copy; retain all documents and prior history; physical deletion requires the separate manual job.',decisionAuthority:plan.decisionAuthority,beforeExists:true,beforeBsonSha256:sha(Buffer.from(pack(before),'base64')),planSha256:digest,toolVersion:plan.apiHead,physicalDeletionPerformed:false}];
   after.updatedAt=at;if(collection==='projects'){after.nudgeable=false;after.doNotSendToEna=true;after.doNotSendToEnaReason='Retired for approved direct disposal without S3 copy; history retained.';}
   assert(equal(before.storage,after.storage)&&equal(before.archiveMigration,after.archiveMigration),'Storage/archive fields changed');
   operations.push({collection,id:id(before),projectId:owner,operationId,before,after});
  }
  return operations;
 }
 async function apply({db,plan,digest,executionAt,resume=false,checkQuiescence,checkInventory,checkNormalVisibility,loadGraph=collect,save,afterWrite}){
  validatePlan(plan);const operations=buildOperations(plan,digest,executionAt);await checkQuiescence();await checkInventory();await checkProtected(db,plan);
  const current=await loadGraph(db,plan),byKey=new Map(COLLECTIONS.flatMap(c=>current[c].map(d=>[c+':'+id(d),d])));assert.equal(byKey.size,operations.length,'Closure changed');
  for(const op of operations){const actual=byKey.get(op.collection+':'+op.id);assert(actual,'Closure missing record');assert(equal(actual,op.before)||(resume&&equal(actual,op.after)),'Record differs from reviewed before/after state');}
  await save('all-before-checked.json',{at:new Date().toISOString(),records:operations.length,resume});let written=0,adopted=0;
  for(const op of operations){
   if((written+adopted)%50===0){validatePlan(plan);await checkQuiescence();}
   const collection=db.collection(op.collection),actual=await collection.findOne({_id:new ObjectId(op.id)},TYPED);
   if(resume&&equal(actual,op.after)){adopted++;continue;}assert(equal(actual,op.before),'Concurrent document change');
   const fields=['reconciliation','reconciliationHistory','updatedAt',...(op.collection==='projects'?['nudgeable','doNotSendToEna','doNotSendToEnaReason']:[])];
   const update={$set:Object.fromEntries(fields.map(k=>[k,op.after[k]]))};
   const result=await collection.updateOne({_id:op.before._id,$expr:{$eq:['$$ROOT',{$literal:op.before}]}},update,{writeConcern:{w:'majority',j:true}});
   assert.equal(result.matchedCount??result.result?.n,1,'Exact before-image CAS failed');written++;
   await save('write-'+op.collection+'-'+op.id+'.json',{at:new Date().toISOString(),collection:op.collection,id:op.id,operationId:op.operationId,beforeSha256:sha(Buffer.from(pack(op.before),'base64')),afterSha256:sha(Buffer.from(pack(op.after),'base64'))});
   if(afterWrite)await afterWrite(op,written);
   assert(equal(await collection.findOne({_id:new ObjectId(op.id)},TYPED),op.after),'Written result differs');
  }
  await checkQuiescence();await checkInventory();const final=await loadGraph(db,plan),finalMap=new Map(COLLECTIONS.flatMap(c=>final[c].map(d=>[c+':'+id(d),d])));assert.equal(finalMap.size,operations.length);
  for(const op of operations)assert(equal(finalMap.get(op.collection+':'+op.id),op.after),'Final state differs');
  await checkProtected(db,plan);await checkNormalVisibility(operations);await save('after-graph.json',encode(final));
  const counts=Object.fromEntries(COLLECTIONS.map(c=>[c,operations.filter(o=>o.collection===c).length]));
  return{kind:'komondor-direct-disposal-retirement-v1',success:true,operator:'deeks',projectIds:Object.keys(TARGETS).sort(),retiredProjects:6,retiredRecords:operations.length,counts,written,adopted,planSha256:digest,executionAt,at:new Date().toISOString(),apiHead:plan.apiHead,dependentRecordsRetained:true,beforeImagesVerified:true,writesBlocked:true,externalWritersFrozen:true,noS3Copy:true,manualFilesystemDeletionRequired:true,sourceInventoryUnchanged:true,storageAndArchiveFieldsUnchanged:true,priorHistoryPreserved:true,physicalDeletionPerformed:false};
 }
 return{pack,unpack,equal,decode,encode,ownership,collect,checkProtected,buildOperations,apply};
}
async function main(){
 const args=process.argv.slice(2),options={};const allowed=new Set(['execute','plan','plan-sha256','backup-plan','quiescence-receipt','output-dir','resume-execution','resume-sha256','window-dir']);
 while(args.length){const flag=args.shift();assert(flag.startsWith('--')&&allowed.has(flag.slice(2))&&!Object.hasOwn(options,flag.slice(2)),'Unexpected argument');options[flag.slice(2)]=flag==='--execute'?true:args.shift();}
 for(const name of ['execute','plan','plan-sha256','backup-plan','quiescence-receipt','output-dir','window-dir'])assert(options[name],'Missing '+name);assert.equal(!!options['resume-execution'],!!options['resume-sha256']);assert.match(options['plan-sha256'],/^[a-f0-9]{64}$/);
 assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'deeks');process.umask(0o077);
 const raw=read(options.plan),digest=sha(raw);assert.equal(digest,options['plan-sha256']);const plan=JSON.parse(raw);validatePlan(plan);
 const backup=path.resolve(options['backup-plan']),source=path.resolve(options.plan);assert(read(backup).equals(raw),'Independent plan differs');assert(backup!==source&&!backup.startsWith(path.dirname(source)+'/')&&!backup.startsWith(ROOT+'/')&&!backup.startsWith(API+'/'),'Independent backup location');const a=fs.statSync(source),b=fs.statSync(backup);assert(a.dev!==b.dev||a.ino!==b.ino,'Backup is same inode');
 const receiptBytes=read(options['quiescence-receipt']),receipt=JSON.parse(receiptBytes);assert.equal(path.resolve(options['quiescence-receipt']),path.join(path.resolve(options['window-dir']),'window/paused.json'));assert.equal(receipt.nudgePaused,true);assert.equal(path.resolve(options['window-dir']),receipt.windowDirectory);assert(receipt.runId&&Number.isSafeInteger(receipt.controllerPid));assert.deepEqual((receipt.projectIds||[]).slice().sort(),Object.keys(TARGETS).sort());
 const version=()=>cp.execFileSync('git',['-C',API,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(version(),plan.apiHead);
 assert.equal(cp.execFileSync('git',['-C',API,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','API worktree changed');
 const bsonModule=require(API+'/node_modules/bson'),engine=makeEngine({bson:new(bsonModule.BSON||bsonModule)(),ObjectId:bsonModule.ObjectId||bsonModule.ObjectID});
 let executionAt=new Date().toISOString(),resumedFrom=null;
 if(options['resume-execution']){const r=read(options['resume-execution']);assert.equal(sha(r),options['resume-sha256']);const old=JSON.parse(r);assert.equal(old.kind,'kamoun-retirement-execution-v1');assert.equal(old.planSha256,digest);assert.equal(old.apiHead,plan.apiHead);assert.equal(old.actor,'deeks');executionAt=old.executionAt;resumedFrom={path:path.resolve(options['resume-execution']),sha256:sha(r)};}
 const output=path.resolve(options['output-dir']);assert(output.startsWith('/storage/')&&!output.startsWith(API+'/'));fs.mkdirSync(output,{mode:0o700});syncDirectory(path.dirname(output));
 const save=async(name,value)=>{assert.equal(path.basename(name),name);const fd=fs.openSync(path.join(output,name),'wx',0o600);try{fs.writeFileSync(fd,Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n'));fs.fchmodSync(fd,0o400);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(output);};
 await save('plan.json',raw);await save('retirement.cjs',read(__filename));await save('quiescence-receipt.json',receipt);await save('execution.json',{kind:'kamoun-retirement-execution-v1',planSha256:digest,apiHead:plan.apiHead,actor:'deeks',executionAt,resumedFrom,runId:receipt.runId,controllerPid:receipt.controllerPid,pid:process.pid});
 require(API+'/node_modules/dotenv').config({path:API+'/.env'});assert.equal(process.env.DATASTORE_ROOT,ROOT,'Incorrect DATASTORE_ROOT');const uri=require(API+'/lib/utils/validateEnv').resolveMongoUri(process.env);
 const window=mutationWindow({directory:options['window-dir'],receiptBytes,digest,executionAt,apiHead:plan.apiHead,outputDir:output});
 const mongoose=require(API+'/node_modules/mongoose');mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
 try{
  await mongoose.connect(uri,{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});const db=mongoose.connection.db;const [info]=await db.listCollections({name:'projects'}).toArray();const dbIdentity={name:db.databaseName,host:mongoose.connection.host,port:mongoose.connection.port,collectionUuid:info?.info?.uuid?.toString('hex')};assert.deepEqual(dbIdentity,plan.databaseIdentity);
  const {quiescence}=require(API+'/lib/archive-registration');
  const checkQuiescence=async()=>{window.check();assert.equal(version(),plan.apiHead);await quiescence(db,receipt,digest,'deeks');assert.equal(receipt.nudgePaused,true);};
  const checkInventory=async()=>{
   const directory=path.dirname(source),tool=path.join(directory,'inventory_direct_disposal.py'),baseline=path.join(directory,'sealed-source-baseline.json'),held=path.join(directory,'held-paths.json');
   for(const [file,digest] of [[tool,plan.inventoryToolSha256],[baseline,plan.baselineSha256],[held,plan.heldPathsSha256]])assert.equal(sha(read(file)),digest,'Inventory input/tool changed');
   const fresh=JSON.parse(cp.execFileSync('python3',[tool,'--baseline',baseline,'--held-paths',held,'--reads-root',ROOT],{encoding:'utf8',maxBuffer:20*1024*1024}));
   assert(fresh.success);assert.deepEqual(fresh.mount,plan.inventory.mount);assert.deepEqual(fresh.projects,plan.inventory.projects);assert.deepEqual(fresh.heldPaths,plan.inventory.heldPaths);assert.deepEqual(fresh.heldObservations,plan.inventory.heldObservations);
  };
  const modelNames={projects:'Project',samples:'Sample',runs:'Run',reads:'Read',additionalfiles:'AdditionalFile',files:'File',ingestjobs:'IngestJob',newsitems:'NewsItem'};
  const checkNormalVisibility=async operations=>{for(const [collection,name] of Object.entries(modelNames)){const ids=operations.filter(o=>o.collection===collection).map(o=>o.id);if(ids.length){const Model=require(API+'/models/'+name);assert.equal(await Model.countDocuments({_id:{$in:ids}}),0,'Retired records remain visible through guarded model: '+collection);}}};
  window.claim();const result=await engine.apply({db,plan,digest,executionAt,resume:!!resumedFrom,checkQuiescence,checkInventory,checkNormalVisibility,save});await save('completed.json',result);console.log(JSON.stringify({success:true,retiredProjects:6,retiredRecords:result.retiredRecords,serverEvidence:output}));
 }catch(error){await save('failure.json',{at:new Date().toISOString(),error:error.stack,planSha256:digest,executionAt,partialExecutionRequiresInspection:true,rollbackPerformed:false});throw error;}finally{try{await mongoose.disconnect();}finally{window.release();}}
}
if(require.main===module)main().catch(error=>{console.error(String(error.stack||error).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g,'[redacted]'));process.exitCode=1;});
module.exports={makeEngine,validatePlan,mutationWindow,TARGETS,COLLECTIONS,TYPED};
