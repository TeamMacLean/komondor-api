'use strict';
// One reviewed administrative operation, deliberately outside the application runtime.
// No payload hashing, copying, deletion, scientific reclassification or S3 calls.
const fs=require('fs').promises,path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const api=process.env.KOMONDOR_API_ROOT||path.resolve(__dirname,'../../../../..');
const mig=require(api+'/lib/archive-reconciliation'),reg=require(api+'/lib/archive-registration');
const {walkTree}=require(api+'/lib/s3-archive/inventory');
const {ObjectId,BSON}=require(api+'/node_modules/bson'),bson=new BSON();
const SOURCE='/ntalbot/project_2178';
const ROOT='/ntalbot/study_of_pmk1as_mutant_in_presence_and_absence_of_an_inhibitor';
const CHILD='legacy_project_2178',DEST=ROOT+'/'+CHILD,PROJECT='5fc012bda3efcb29338b7cf7';
const sourceEntry='ntalbot-031',targetEntry='ntalbot-026';
const ids={samples:['5fc012bfa3efcb29338b8042','5fc012bfa3efcb29338b8094'],runs:['5fc012c3a3efcb29338b8388','5fc012c3a3efcb29338b85c0']};
const toolVersion=()=>reg.sha256(Buffer.concat([require('fs').readFileSync(__filename),Buffer.from(require(api+'/scripts/reconcile-archive-database').toolVersion())]));
const abs=(root,relative)=>path.join(root,relative);
const id=d=>String(d?._id||d);
const fail=s=>{throw Error(s);};
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function tree(root,relative){
 const absolute=abs(root,relative);
 assert.equal(await fs.realpath(root),root,'Noncanonical datastore');
 assert.equal(await fs.realpath(absolute),absolute,'Noncanonical tree');
 const before=await fs.lstat(absolute);assert(before.isDirectory());
 const inventory=await walkTree(absolute),after=await fs.lstat(absolute);
 assert(mig.equal(reg.statFields(before),reg.statFields(after)),'Tree changed while observing');
 assert(inventory.entries.every(e=>['file','dir'].includes(e.type)),'Symlink/special entry is not approved');
 return {relativeRoot:relative,rootStat:reg.statFields(after),entries:inventory.entries};
}
const summary=s=>Object.fromEntries(Object.entries(s).map(([name,v])=>[name,{sha256:v.sha256,indexesSha256:v.indexesSha256,count:v.documents.length}]));
const files=t=>t.entries.filter(e=>e.type==='file');
const size=t=>files(t).reduce((n,f)=>n+f.size,0);
async function prepare({db,databaseIdentity,datastoreRoot,workDir,actor,checksums=[]}){
 assert.equal(actor,'deeks');
 const dir=await reg.evidenceDirectory(workDir,datastoreRoot);
 const snapshot=await mig.databaseSnapshot(db),data=Object.fromEntries(Object.entries(snapshot).map(([n,s])=>[n,s.documents]));
 for(const name of ['projects','samples','runs','reads','additionalfiles','files','ingestjobs','newsitems'])data[name]||=[];
 const project=data.projects.find(p=>id(p)===PROJECT);assert(project&&project.path===ROOT&&project.owner==='talbotn'&&project.secondaryOwner==='talbotn');
 assert(!project.reconciliation&&!project.archiveMigration&&(!project.storage?.state||project.storage.state==='hpc'),'Project no longer an unreconciled HPC project');
 assert.equal(data.projects.filter(p=>p.path===ROOT||p.path===SOURCE||p.path===DEST).length,1,'Competing Project claim');
 const children=mig.descendants(data,PROJECT);assert.equal(children.samples.length,3);assert.equal(children.runs.length,3);assert.equal(children.reads.length,0);assert.equal(children.additionalfiles.length,8);
 const source=await tree(datastoreRoot,SOURCE),target=await tree(datastoreRoot,ROOT);
 assert.equal(files(source).length,31);assert.equal(size(source),18228463024);assert.equal(files(target).length,8);assert.equal(size(target),23621445468);
 assert.equal(source.rootStat.dev,target.rootStat.dev,'Move must remain on one filesystem');
 assert(!await exists(abs(datastoreRoot,DEST)),'Destination already exists');
 assert(!data.files.some(f=>typeof f.path==='string'&&(f.path.startsWith(SOURCE+'/')||f.path.startsWith(DEST+'/'))),'Source files already have catalogue claims');
 assert.equal(data.runs.filter(r=>r.path?.startsWith(SOURCE+'/')).length,2);
 const sourceLedger=(data.archiveReconciliations||[]).filter(l=>l.batchId==='2026-10-16'&&l.entryId===sourceEntry);
 const targetLedger=(data.archiveReconciliations||[]).filter(l=>l.batchId==='2026-10-16'&&l.entryId===targetEntry);
 assert.equal(sourceLedger.length,1);assert.equal(targetLedger.length,1);
 assert.equal(sourceLedger[0].executionStatus,'technical-hold');assert.equal(targetLedger[0].executionStatus,'reconciled');
 assert(mig.equal(sourceLedger[0].inventory,files(source).map(f=>({path:f.relPath,bytes:f.size}))));
 assert(mig.equal(targetLedger[0].inventory,files(target).map(f=>({path:f.relPath,bytes:f.size}))));
 const operations=[];
 const correct=(collection,before,set,reason)=>operations.push({collection,id:id(before),entryId:sourceEntry,operationId:crypto.randomUUID(),beforeBson:mig.pack(before),setBson:mig.pack(set),options:{},reasons:[reason]});
 const authority='George explicitly approved preserving both datasets under the existing talbotn Project, moving project_2178 intact to legacy_project_2178, retaining prior paths/history, cataloguing all 31 files and then preparing a fresh archive plan. No deletion, S3 upload, bulk checksum sweep or scientific metadata changes.';
 correct('projects',project,{},'Retain existing project identity and owner; record the approved consolidation of two source entries');
 const corrected=[];
 for(const [collection,keys]of Object.entries(ids))for(const key of keys){
  const d=children[collection].find(x=>id(x)===key);assert(d&&!d.reconciliation&&d.owner==='talbotn');
  const oldPrefix=collection==='samples'?ROOT:SOURCE;
  assert(d.path.startsWith(oldPrefix+'/'));
  const suffix=d.path.slice(oldPrefix.length),newPath=DEST+suffix;
  assert(source.entries.some(e=>e.type==='dir'&&e.relPath===suffix.slice(1)),'Missing physical child');
  correct(collection,d,{path:newPath},'Consolidate existing sample/run under its existing Project; preserve the original path in history');
  corrected.push({collection:collection==='samples'?'sample':'run',doc:{...d,path:newPath}});
 }
 let linkedObservations=0;
 for(const f of files(source)){
  const stored=DEST+'/'+f.relPath,parents=corrected.filter(p=>stored.startsWith(p.doc.path+'/')).sort((a,b)=>b.doc.path.length-a.doc.path.length);
  assert(parents.length&&!(parents[1]&&parents[0].doc.path.length===parents[1].doc.path.length),'Missing/ambiguous parent');
  const parent=parents[0],fileId=new ObjectId(),additionalId=new ObjectId(),name=path.posix.basename(f.relPath);
  const observation=checksums.find(c=>c.canonicalPath===abs(datastoreRoot,SOURCE+'/'+f.relPath));
  const current=observation&&observation.stable&&observation.bytes===f.size&&Object.keys(observation.identity).every(k=>observation.identity[k]===f[k])?observation:null;
  if(current)linkedObservations++;
  const file={_id:fileId,name:'reconciled-'+fileId,type:'application/octet-stream',uploadName:name,originalName:name,path:stored,uploadMethod:'administrative-catalogue',createFileDocumentId:'reconcile-'+fileId,description:'Preserved legacy analysis/supporting file; scientific metadata and historical upload verification unconfirmed.',__v:0};
  const additional={_id:additionalId,[parent.collection]:parent.doc._id,file:fileId,skipPostSave:true,__v:0};
  for(const [collection,doc]of [['files',file],['additionalfiles',additional]])operations.push({collection,id:id(doc),entryId:sourceEntry,operationId:crypto.randomUUID(),beforeBson:null,insertBson:mig.pack(doc),reasons:['Catalogue existing analysis/supporting bytes under their existing sample/run after approved directory relocation'],options:{classification:'unclassified-preserve',classificationBasis:'existing analysis/supporting directory; scientific role remains unconfirmed',...(collection==='files'?{previousPhysicalPath:SOURCE+'/'+f.relPath,...(current?{currentObservation:current,observationPathNote:'Dated observation at the original path before a metadata-verified same-filesystem rename; not historical upload verification.'}:{})}:{})}});
 }
 correct('archiveReconciliations',sourceLedger[0],{executionStatus:'consolidated-under-existing-project',project:project._id,physicalRoot:DEST,previousPhysicalRoot:SOURCE,consolidatedIntoEntryId:targetEntry,newFiles:31,currentObservations:linkedObservations,holdResolved:{reason:'Approved intact relocation under the existing Project root',previousHold:sourceLedger[0].hold}},'Resolve the association hold while retaining the original decision entry, inventory and prior hold');
 correct('archiveReconciliations',targetLedger[0],{fileCount:39,bytes:size(source)+size(target),inventory:[...targetLedger[0].inventory,...sourceLedger[0].inventory.map(f=>({...f,path:CHILD+'/'+f.path}))],consolidatedEntries:[sourceEntry],archivePlanRequiredAfterConsolidation:true},'Record complete 39-file physical scope for the existing Project; retain both source entry identities');
 assert.equal(operations.length,69);
 const plan={version:1,kind:'project-2178-consolidation',batchId:'2026-10-16',actor,preparedAt:new Date().toISOString(),decisionAuthority:authority,toolVersion:toolVersion(),databaseIdentity,datastoreRoot,source,target,sourceEntry,targetEntry,sourceRoot:SOURCE,targetRoot:ROOT,destinationRoot:DEST,projectId:PROJECT,operations,databaseBefore:summary(snapshot),counts:{files:39,bytes:size(source)+size(target),newFilePairs:31,existingCorrections:7,currentObservations:linkedObservations}};
 await fs.mkdir(path.join(dir,'baseline'),{mode:0o700});const backup={at:new Date(),collections:{}};
 for(const [name,state]of Object.entries(snapshot)){assert(/^[a-zA-Z0-9_-]+$/.test(name));const bytes=Buffer.concat(state.documents.map(d=>bson.serialize(d)));await reg.writeOnce(path.join(dir,'baseline',name+'.bson'),bytes);backup.collections[name]={count:state.documents.length,sha256:reg.sha256(bytes),bytes:bytes.length,indexes:state.indexes};}
 await reg.writeOnce(path.join(dir,'baseline','receipt.json'),reg.encode(backup));
 const bytes=reg.encode(plan);await reg.writeOnce(path.join(dir,'plan.json'),bytes);
 return {planSha256:reg.sha256(bytes),operations:69,counts:plan.counts,toolVersion:plan.toolVersion,productionWrites:false};
}
function stableRoot(before,after,fields){for(const k of fields)assert.equal(after[k],before[k],'Root identity changed: '+k);}
async function filesystemState(plan){
 const root=plan.datastoreRoot,oldExists=await exists(abs(root,SOURCE)),newExists=await exists(abs(root,DEST));
 assert(oldExists!==newExists,'Source/destination state is ambiguous');
 if(oldExists){
  const s=await tree(root,SOURCE),t=await tree(root,ROOT);assert(mig.equal(s,plan.source)&&mig.equal(t,plan.target),'Original physical inventory changed');return 'before';
 }
 const s=await tree(root,DEST),t=await tree(root,ROOT);
 // A directory rename changes the moved root ctime and its parents' metadata.
 // Every descendant and every existing target entry must remain byte-for-byte
 // identical in its inventory metadata, including inode, length and timestamps.
 stableRoot(plan.source.rootStat,s.rootStat,['dev','ino','mode','uid','gid','size','mtimeMs']);
 stableRoot(plan.target.rootStat,t.rootStat,['dev','ino','mode','uid','gid']);
 assert(mig.equal(s.entries,plan.source.entries),'Moved descendant metadata differs');
 const existing=t.entries.filter(e=>e.relPath!==CHILD&&!e.relPath.startsWith(CHILD+'/'));
 assert(mig.equal(existing,plan.target.entries),'Original target descendants differ');
 assert.equal(t.entries.length,plan.target.entries.length+plan.source.entries.length+1,'Unexpected combined entry count');
 assert.equal(files(t).length,39);assert.equal(size(t),plan.counts.bytes);return 'after';
}
async function validateResults(db,plan,at,digest){
 for(const op of plan.operations){const d=await db.collection(op.collection).findOne({_id:new ObjectId(op.id)});assert(mig.equal(d,mig.materialize(plan,op,new Date(at),digest)),'Result differs: '+op.collection+':'+op.id);}
 await mig.verifyUnchangedDatabase(db,plan);assert.equal(await filesystemState(plan),'after');
 return {operations:plan.operations.length,exactResults:true,unplannedDatabaseChanges:false,originalIndexesUnchanged:true,files:39,bytes:plan.counts.bytes,physicalDescendantsUnchanged:true};
}
async function apply({db,databaseIdentity,datastoreRoot,workDir,actor,expectedSha256,backupPlan,receipt,execute,afterRename,afterWrite}){
 assert(execute,'Explicit execution required');const dir=await reg.evidenceDirectory(workDir,datastoreRoot),bytes=await reg.readRegular(path.join(dir,'plan.json')),plan=JSON.parse(bytes),digest=reg.sha256(bytes);
 assert.equal(digest,expectedSha256);assert.equal(plan.kind,'project-2178-consolidation');assert.equal(plan.version,1);assert.equal(plan.actor,actor);assert.equal(actor,'deeks');assert.equal(plan.datastoreRoot,datastoreRoot);assert(mig.equal(plan.databaseIdentity,databaseIdentity));assert.equal(plan.toolVersion,toolVersion());
 const bp=path.resolve(backupPlan);assert(!bp.startsWith(dir+path.sep)&&!bp.startsWith(datastoreRoot+path.sep)&&!bp.startsWith(api+path.sep),'Backup must be independent');assert(bytes.equals(await reg.readRegular(bp)));const a=await fs.stat(path.join(dir,'plan.json')),b=await fs.stat(bp);assert(a.dev!==b.dev||a.ino!==b.ino,'Backup is the same file');
 assert(receipt.nudgePaused&&receipt.webPaused);await reg.quiescence(db,receipt,digest,actor);
 let execution;try{execution=JSON.parse(await reg.readRegular(path.join(dir,'execution.json')));}catch(e){if(e.code!=='ENOENT')throw e;execution={at:new Date().toISOString(),planSha256:digest};await reg.writeOnce(path.join(dir,'execution.json'),reg.encode(execution));}
 assert.equal(execution.planSha256,digest);const at=new Date(execution.at);assert(Number.isFinite(+at));
 let applied=0;
 for(const op of plan.operations){const d=await db.collection(op.collection).findOne({_id:new ObjectId(op.id)}),before=op.beforeBson?mig.unpack(op.beforeBson):null,after=mig.materialize(plan,op,at,digest);if(mig.equal(d,after))applied++;else assert(mig.equal(d,before),'Record changed before/resuming consolidation');}
 await mig.verifyUnchangedDatabase(db,plan);
 const state=await filesystemState(plan);
 if(state==='before'){
  assert.equal(applied,0,'Database changed but source tree was moved back');
  await reg.quiescence(db,receipt,digest,actor);
  // Exclusive writer freeze and destination absence were checked immediately
  // above. Never fall back to copy/remove on EXDEV or any permission failure.
  assert(!await exists(abs(datastoreRoot,DEST)),'Destination appeared');
  await fs.rename(abs(datastoreRoot,SOURCE),abs(datastoreRoot,DEST));
  if(afterRename)await afterRename();
 }
 assert.equal(await filesystemState(plan),'after');
 if(!await exists(path.join(dir,'moved.json')))await reg.writeOnce(path.join(dir,'moved.json'),reg.encode({at:new Date(),planSha256:digest,source:SOURCE,destination:DEST,method:'same-filesystem-rename',payloadsRehashed:false}));
 let completed=0;
 for(const op of plan.operations){
  await reg.quiescence(db,receipt,digest,actor);
  const collection=db.collection(op.collection),current=await collection.findOne({_id:new ObjectId(op.id)}),after=mig.materialize(plan,op,at,digest);
  if(!mig.equal(current,after)){
   if(!op.beforeBson){assert.equal(current,null);await collection.insertOne(after);}
   else{
    const before=mig.unpack(op.beforeBson);assert(mig.equal(current,before),'Concurrent edit');
    const filter={_id:before._id,$expr:{$setEquals:[{$objectToArray:'$$ROOT'},{$literal:Object.entries(before).map(([k,v])=>({k,v}))}]}};
    const set=op.setBson?mig.unpack(op.setBson):{};
    const r=await collection.updateOne(filter,{$set:{...set,reconciliation:after.reconciliation,updatedAt:at},$push:{reconciliationHistory:after.reconciliationHistory.at(-1)}});assert.equal(r.matchedCount,1,'Conditional correction lost comparison');
   }
   if(afterWrite)await afterWrite(op,completed);
  }
  assert(mig.equal(await collection.findOne({_id:after._id}),after));completed++;
 }
 const verified=await validateResults(db,plan,at,digest),result={at:new Date(),planSha256:digest,completed,...verified,counts:plan.counts};
 await reg.writeOnce(path.join(dir,'completed-'+crypto.randomUUID()+'.json'),reg.encode(result));return result;
}
function parseArgs(argv){
 const args=[...argv],command=args.shift(),opts={};
 assert(['prepare','apply','verify'].includes(command),'Expected prepare, apply or verify');
 const required=['--work-dir','--database'];
 if(command==='apply')required.push('--plan-sha256','--backup-plan','--quiescence-receipt','--execute');
 const allowed=new Set([...required,...(command==='prepare'?['--checksums']:[])]);
 while(args.length){
  const key=args.shift();assert(allowed.has(key)&&!Object.hasOwn(opts,key),'Unknown or repeated option: '+key);
  if(key==='--execute')opts[key]=true;
  else{const value=args.shift();assert(typeof value==='string'&&value.length&&!value.startsWith('--'),'Missing value: '+key);opts[key]=value;}
 }
 for(const key of required)assert(Object.hasOwn(opts,key),'Required option: '+key);
 return {command,opts};
}
async function main(args=process.argv.slice(2)){
 const {command,opts}=parseArgs(args);
 const m=require(api+'/node_modules/mongoose');m.set('autoIndex',false);m.set('autoCreate',false);require(api+'/node_modules/dotenv').config({path:api+'/.env'});
 const uri=process.env.MONGODB_URI||require(api+'/lib/utils/validateEnv').resolveMongoUri();
 await m.connect(uri,{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 try{
  const db=m.connection.db;assert.equal(db.databaseName,opts['--database']);const [info]=await db.listCollections({name:'projects'}).toArray();
  const databaseIdentity={name:db.databaseName,host:m.connection.host,port:m.connection.port,collectionUuid:info?.info?.uuid?.toString('hex')};assert(databaseIdentity.collectionUuid);
  const c={db,databaseIdentity,datastoreRoot:process.env.DATASTORE_ROOT,workDir:opts['--work-dir'],actor:'deeks'};assert(c.datastoreRoot);
  let result;if(command==='prepare')result=await prepare({...c,checksums:opts['--checksums']?JSON.parse(await reg.readRegular(opts['--checksums'])).checksums:[]});
  else if(command==='apply')result=await apply({...c,execute:opts['--execute'],expectedSha256:opts['--plan-sha256'],backupPlan:opts['--backup-plan'],receipt:JSON.parse(await reg.readRegular(opts['--quiescence-receipt']))});
  else{const bytes=await reg.readRegular(path.join(c.workDir,'plan.json')),plan=JSON.parse(bytes),execution=JSON.parse(await reg.readRegular(path.join(c.workDir,'execution.json')));assert.equal(plan.datastoreRoot,c.datastoreRoot);assert(mig.equal(plan.databaseIdentity,databaseIdentity));assert.equal(execution.planSha256,reg.sha256(bytes));result=await validateResults(db,plan,execution.at,execution.planSha256);}
  process.stdout.write(reg.encode(result));
 }finally{await m.disconnect();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack?.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g,'[redacted]'));process.exitCode=1;});
module.exports={prepare,apply,filesystemState,validateResults,toolVersion,tree,parseArgs,SOURCE,ROOT,DEST,PROJECT,ids};
