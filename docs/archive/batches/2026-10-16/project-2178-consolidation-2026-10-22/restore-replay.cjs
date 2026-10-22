'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const api='/Users/deeks/Local_Documents/Local_GitHub/komondor-api',m=require(api+'/node_modules/mongoose'),{BSON}=require(api+'/node_modules/bson'),bson=new BSON();
const mig=require(api+'/lib/archive-reconciliation');m.set('autoIndex',false);m.set('autoCreate',false);
const base=__dirname,plan=JSON.parse(fs.readFileSync(base+'/plan.json')),digest=crypto.createHash('sha256').update(fs.readFileSync(base+'/plan.json')).digest('hex');
(async()=>{
 assert.equal(digest,'f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b');
 await m.connect('mongodb://127.0.0.1:60325/komondor-project2178-preview-final',{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true});
 const db=m.connection.db;assert.equal(db.databaseName,'komondor-project2178-preview-final');assert.equal((await db.listCollections().toArray()).length,0,'Scratch restore is not empty');
 const receipt=JSON.parse(fs.readFileSync(base+'/baseline/receipt.json'));let count=0;
 for(const [name,info]of Object.entries(receipt.collections)){
  const bytes=fs.readFileSync(base+'/baseline/'+name+'.bson');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),info.sha256);
  const docs=[];let offset=0;while(offset<bytes.length){const length=bytes.readInt32LE(offset);assert(length>4&&offset+length<=bytes.length);docs.push(bson.deserialize(bytes.subarray(offset,offset+length)));offset+=length;}assert.equal(docs.length,info.count);
  await db.createCollection(name);for(let start=0;start<docs.length;start+=1000)await db.collection(name).insertMany(docs.slice(start,start+1000));
  for(const index of info.indexes)if(index.name!=='_id_'){const {ns,v,...spec}=index;await db.collection(name).createIndexes([spec]);}count+=docs.length;
 }
 const before=await mig.databaseSnapshot(db);for(const [name,state]of Object.entries(plan.databaseBefore)){assert.equal(before[name].sha256,state.sha256,'Restored documents differ '+name);assert.equal(before[name].indexesSha256,state.indexesSha256,'Restored indexes differ '+name);}
 const at=new Date();for(const op of plan.operations){const current=await db.collection(op.collection).findOne({_id:new m.Types.ObjectId(op.id)});assert(mig.equal(current,op.beforeBson?mig.unpack(op.beforeBson):null));const next=mig.materialize(plan,op,at,digest);if(current)await db.collection(op.collection).replaceOne({_id:next._id},next);else await db.collection(op.collection).insertOne(next);}
 for(const op of plan.operations)assert(mig.equal(await db.collection(op.collection).findOne({_id:new m.Types.ObjectId(op.id)}),mig.materialize(plan,op,at,digest)));
 await mig.verifyUnchangedDatabase(db,plan);
 for(const model of ['Project','Sample','Run','Read','AdditionalFile','File','IngestJob'])require(api+'/models/'+model);
 const project=await m.model('Project').findById(plan.projectId),preflight=require(api+'/lib/s3-archive/preflight'),database=await preflight.collectProjectDatabase(m.models,project._id);
 assert.equal(database.samples.length,3);assert.equal(database.runs.length,3);assert.equal(database.reads.length,0);assert.equal(database.additionalFiles.length,39);
 for(const s of database.samples)assert(s.path.startsWith(project.path+'/'));for(const r of database.runs)assert(r.path.startsWith(project.path+'/'));
 const inventory={entries:[...plan.target.entries,...plan.source.entries.map(e=>({...e,relPath:'legacy_project_2178/'+e.relPath}))]};
 const overlay=preflight.overlayDatabase(inventory,database,project.path.slice(1));assert.equal(overlay.anomalies.filter(a=>a.serious).length,0);assert.equal(overlay.anomalies.filter(a=>a.kind==='db-file-missing').length,0);
 for(const item of database.additionalFiles)assert(item.file&&item.file.path.startsWith(project.path+'/'));
 const result={at:new Date(),planSha256:digest,restoredDocuments:count,restoredCollections:Object.keys(receipt.collections).length,allBackupDigestsPassed:true,restoredIndexesMatch:true,operationsReplayed:plan.operations.length,unplannedDatabaseChanges:false,projectSamples:3,projectRuns:3,cataloguedFiles:39,scientificReadsUnchanged:0,allParentsAndFilesInsideProject:true,archiveOverlaySeriousAnomalies:0,archiveOverlayMissing:0,note:'Exact production records and original indexes restored into an isolated database; exact planned results replayed. Real filesystem rename/recovery covered by nine separate fault tests.'};
 fs.writeFileSync(base+'/restore-replay.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>m.disconnect());
