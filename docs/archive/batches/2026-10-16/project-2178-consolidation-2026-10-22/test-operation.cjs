'use strict';
// Destructive only to the explicitly named disposable local test database/tree.
const fs=require('fs').promises,path=require('path'),os=require('os'),http=require('http'),assert=require('assert/strict');
const api=path.resolve(__dirname,'../../../../..'),m=require(api+'/node_modules/mongoose');
process.env.KOMONDOR_API_ROOT=api;
const recovery=require('./recoverability.cjs');
const op=require('./operation.cjs'),mig=require(api+'/lib/archive-reconciliation'),reg=require(api+'/lib/archive-registration');
m.set('autoIndex',false);m.set('autoCreate',false);
const uri=process.env.MONGODB_URI;assert(/^mongodb:\/\/127\.0\.0\.1:60325\/komondor-project2178-test$/.test(uri||''),'Explicit isolated test database required');
let base,db,stoppedUrl;
const oid=s=>new m.Types.ObjectId(s);
async function fixture(){
 await db.dropDatabase();if(base)await fs.rm(base,{recursive:true,force:true});base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'project2178-test-')));
 const root=path.join(base,'data'),work=path.join(base,'evidence'),backup=path.join(base,'independent','plan.json');await fs.mkdir(path.dirname(backup));
 const sourceDirs=['magnaporthe_oryzae/additional','magnaporthe_oryzae/magnaporthe_oryzae/processed','rice/additional','rice/rice/processed'];
 for(const s of sourceDirs)await fs.mkdir(path.join(root,op.SOURCE,s),{recursive:true});await fs.mkdir(path.join(root,op.ROOT,'appressorium_development/r/raw'),{recursive:true});
 for(let i=0;i<31;i++){const file=path.join(root,op.SOURCE,sourceDirs[i%4],'file'+i+'.bam');await fs.writeFile(file,'x');if(i===30)await fs.truncate(file,18228463024-30);}
 for(let i=0;i<8;i++){const file=path.join(root,op.ROOT,'appressorium_development/r/raw','read'+i+'.fq.gz');await fs.writeFile(file,'r');if(i===7)await fs.truncate(file,23621445468-7);}
 const project={_id:oid(op.PROJECT),path:op.ROOT,owner:'talbotn',secondaryOwner:'talbotn',name:'Existing scientific project',safeName:'existing'};
 await db.collection('projects').insertOne(project);
 const thirdSample=oid('111111111111111111111111'),thirdRun=oid('222222222222222222222222');
 await db.collection('samples').insertMany([{_id:oid(op.ids.samples[0]),project:project._id,path:op.ROOT+'/magnaporthe_oryzae',name:'fungus',owner:'talbotn'},{_id:oid(op.ids.samples[1]),project:project._id,path:op.ROOT+'/rice',name:'rice',owner:'talbotn'},{_id:thirdSample,project:project._id,path:op.ROOT+'/appressorium_development',owner:'talbotn'}]);
 await db.collection('runs').insertMany([{_id:oid(op.ids.runs[0]),sample:oid(op.ids.samples[0]),path:op.SOURCE+'/magnaporthe_oryzae/magnaporthe_oryzae',name:'fungus',owner:'talbotn',libraryStrategy:'WGS'},{_id:oid(op.ids.runs[1]),sample:oid(op.ids.samples[1]),path:op.SOURCE+'/rice/rice',name:'rice',owner:'talbotn',libraryStrategy:'WGS'},{_id:thirdRun,sample:thirdSample,path:op.ROOT+'/appressorium_development/r',owner:'talbotn',libraryStrategy:'RNA-Seq'}]);
 for(let i=0;i<8;i++){const fid=new m.Types.ObjectId();await db.collection('files').insertOne({_id:fid,path:op.ROOT+'/appressorium_development/r/raw/read'+i+'.fq.gz',originalName:'read'+i+'.fq.gz'});await db.collection('additionalfiles').insertOne({_id:new m.Types.ObjectId(),run:thirdRun,file:fid});}
 for(const [entryId,p,status]of [['ntalbot-031',op.SOURCE,'technical-hold'],['ntalbot-026',op.ROOT,'reconciled']]){const t=await op.tree(root,p);await db.collection('archiveReconciliations').insertOne({_id:new m.Types.ObjectId(),batchId:'2026-10-16',entryId,physicalRoot:p,executionStatus:status,project:p===op.ROOT?project._id:null,inventory:t.entries.filter(e=>e.type==='file').map(f=>({path:f.relPath,bytes:f.size})),reconciliation:{version:1,operationId:'original',planSha256:'old'},reconciliationHistory:[{kind:'original',at:new Date('2026-10-22')}]});}
 await db.collection('users').insertOne({_id:new m.Types.ObjectId(),username:'unaffected'});
 const context={db,databaseIdentity:{name:db.databaseName,uuid:'scratch'},datastoreRoot:root,workDir:work,actor:'deeks'};
 const before=await mig.databaseSnapshot(db),result=await op.prepare(context);assert(mig.equal(before,await mig.databaseSnapshot(db)),'Prepare wrote to database');await fs.copyFile(path.join(work,'plan.json'),backup);
 const receipt={planSha256:result.planSha256,actor:'deeks',recordedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),allApiInstancesStopped:true,powerPaused:true,nudgePaused:true,webPaused:true,externalWritersFrozen:true,backupIndependentlyRetained:true,apiReadyUrls:[stoppedUrl]};
 return {...context,expectedSha256:result.planSha256,backupPlan:backup,receipt,execute:true,plan:JSON.parse(await fs.readFile(path.join(work,'plan.json')))};
}
const tests=[];const test=(name,fn)=>tests.push({name,fn});
test('read-only preparation; intact move; 69 exact writes; append-only history; idempotent repeat',async c=>{
 assert.equal((await recovery.checkPlan(db,c.plan,c.expectedSha256)).state,'before');
 const r=await op.apply(c);assert.equal(r.completed,69);assert.equal(await op.filesystemState(c.plan),'after');
 assert.equal((await recovery.checkPlan(db,c.plan,c.expectedSha256)).state,'after');
 assert.equal(await db.collection('files').countDocuments(),39);assert.equal(await db.collection('additionalfiles').countDocuments(),39);
 for(const coll of ['samples','runs'])assert.equal(await db.collection(coll).countDocuments(),3);
 assert.equal(await db.collection('reads').countDocuments(),0);
 for(const d of await db.collection('archiveReconciliations').find({}).toArray()){assert.equal(d.reconciliationHistory.length,2);assert.equal(d.reconciliationHistory[0].kind,'original');}
 assert.equal((await db.collection('runs').findOne({_id:oid(op.ids.runs[0])})).libraryStrategy,'WGS');
 await op.apply(c);for(const d of await db.collection('archiveReconciliations').find({}).toArray())assert.equal(d.reconciliationHistory.length,2);
});
test('resume after rename before any database write',async c=>{await assert.rejects(op.apply({...c,afterRename:()=>{throw Error('injected crash');}}),/injected crash/);assert.equal(await op.filesystemState(c.plan),'after');assert.equal(await db.collection('files').countDocuments(),8);await assert.rejects(recovery.checkPlan(db,c.plan,c.expectedSha256),/keep services paused/);await op.apply(c);});
test('resume after partial database correction/cataloguing without duplicate history',async c=>{await assert.rejects(op.apply({...c,afterWrite:(_o,n)=>{if(n===12)throw Error('injected crash');}}),/injected crash/);await assert.rejects(recovery.checkPlan(db,c.plan,c.expectedSha256),/Result differs/);await op.apply(c);assert.equal(await db.collection('files').countDocuments(),39);});
test('refuse later edits during recovery',async c=>{await assert.rejects(op.apply({...c,afterRename:()=>{throw Error('crash');}}));await db.collection('projects').updateOne({_id:oid(op.PROJECT)},{$set:{newUserData:true}});await assert.rejects(op.apply(c),/Record changed/);assert.equal(await db.collection('files').countDocuments(),8);});
test('refuse destination collision without moving or overwriting it',async c=>{await fs.mkdir(path.join(c.datastoreRoot,op.DEST));await fs.writeFile(path.join(c.datastoreRoot,op.DEST,'preserve'),'user data');await assert.rejects(op.apply(c),/ambiguous/);assert.equal(await fs.readFile(path.join(c.datastoreRoot,op.DEST,'preserve'),'utf8'),'user data');});
test('refuse changed source bytes/metadata before rename',async c=>{await fs.writeFile(path.join(c.datastoreRoot,op.SOURCE,'rice/additional/file2.bam'),'changed');await assert.rejects(op.apply(c),/inventory changed/);assert.equal(await db.collection('files').countDocuments(),8);});
test('refuse unrelated database changes before rename',async c=>{await db.collection('users').updateOne({username:'unaffected'},{$set:{later:true}});await assert.rejects(op.apply(c),/Unplanned original/);assert.equal(await op.filesystemState(c.plan),'before');});
test('refuse missing freeze or independent backup',async c=>{await assert.rejects(op.apply({...c,receipt:{...c.receipt,externalWritersFrozen:false}}),/receipt/);await assert.rejects(op.apply({...c,backupPlan:path.join(c.workDir,'plan.json')}),/independent/);assert.equal(await op.filesystemState(c.plan),'before');});
test('refuse replacing or altering moved files during interrupted recovery',async c=>{await assert.rejects(op.apply({...c,afterRename:()=>{throw Error('crash');}}));await fs.writeFile(path.join(c.datastoreRoot,op.DEST,'rice/additional/file2.bam'),'changed');await assert.rejects(op.apply(c),/metadata differs/);});
(async()=>{await m.connect(uri,{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true});db=m.connection.db;assert.equal(db.databaseName,'komondor-project2178-test');const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));stoppedUrl='http://127.0.0.1:'+s.address().port+'/ready';await new Promise(r=>s.close(r));for(const t of tests){await t.fn(await fixture());console.log('PASS '+t.name);}console.log(JSON.stringify({passed:tests.length,database:db.databaseName}));})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await m.disconnect();if(base)await fs.rm(base,{recursive:true,force:true});});
