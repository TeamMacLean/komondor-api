'use strict';
// Read-only verification. Tokens stay in memory and expire after 5 minutes.
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const api='/storage/www/komondor-api',pack='/storage/komondor-reconciliation-20261022',work='/storage/komondor-reconciliation-final-20261022';
const m=require(api+'/node_modules/mongoose'),mig=require(api+'/lib/archive-reconciliation'),jwt=require(api+'/node_modules/jsonwebtoken');
m.set('autoIndex',false);m.set('autoCreate',false);
require(api+'/node_modules/dotenv').config({path:api+'/.env'});
const raw=fs.readFileSync(work+'/plan.json'),plan=JSON.parse(raw),digest=crypto.createHash('sha256').update(raw).digest('hex');
const execution=JSON.parse(fs.readFileSync(work+'/execution.json'));
const admin=jwt.sign({username:'deeks',isAdmin:true},process.env.JWT_SECRET,{expiresIn:'5m'});
const ordinary=jwt.sign({username:'reconciliation-read-only-access-check',isAdmin:false,groups:[]},process.env.JWT_SECRET,{expiresIn:'5m'});
const checks=[];
async function get(url,status=200,token=admin){
 const response=await fetch('http://127.0.0.1:3061'+url,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,status,url);const data=await response.json();checks.push({url,status});return data;
}
function publicOnly(doc){assert(!('reconciliation' in doc));assert(!('reconciliationHistory' in doc));}
(async()=>{
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 const db=m.connection.db;
 assert.equal((await get('/ready')).status,'ready');
 await mig.verifyUnchangedDatabase(db,plan);
 for(const op of plan.operations){const doc=await db.collection(op.collection).findOne({_id:new m.Types.ObjectId(op.id)});assert(mig.equal(doc,mig.materialize(plan,op,new Date(execution.at),digest)),'After restart mismatch '+op.collection+':'+op.id);}
 const active=(await get('/projects')).projects;assert.equal(active.length,359);active.forEach(publicOnly);
 let retired=0,correctedPaths=0;
 for(const op of plan.operations.filter(o=>['projects','samples','runs'].includes(o.collection))){
  const kind={projects:'project',samples:'sample',runs:'run'}[op.collection];
  const expected=mig.materialize(plan,op,new Date(execution.at),digest);
  if(expected.reconciliation.retiredAt){
   await get('/'+kind+'?id='+op.id,404);
   const audit=await get('/admin/reconciliation-record?collection='+op.collection+'&id='+op.id);
   assert(audit.record.reconciliation.retiredAt&&audit.record.reconciliationHistory.length>0);retired++;
  }else{
   const data=await get('/'+kind+'?id='+op.id);assert.equal(data[kind].path,expected.path);publicOnly(data[kind]);correctedPaths++;
  }
 }
 const adminPath='/admin/reconciliation-record?collection=projects&id=5fc012bda3efcb29338b7d6a';
 await get(adminPath,401,null);await get(adminPath,403,ordinary);
 // Both stored processed-read locations and newly catalogued entries are visible.
 const processed=await db.collection('files').find({path:/\/processed\//},{projection:{_id:1,path:1}}).toArray();
 const processedIds=processed.map(f=>f._id),reads=await db.collection('reads').find({file:{$in:processedIds}}).toArray();
 const runIds=[...new Set(reads.map(r=>String(r.run)).filter(id=>id!=='undefined'))];
 let processedLocations=0,additionalLocations=0;
 for(const id of runIds){
  const data=await get('/run?id='+id);
  for(const read of data.run.rawFiles||[])if(read.file?.path?.includes('/processed/')){
   assert(read.file.locationUri?.endsWith(read.file.path));publicOnly(read.file);processedLocations++;
  }
 }
 assert(processedLocations>0,'No processed-read locations checked');
 const additions=await db.collection('additionalfiles').find({'reconciliation.planSha256':digest,run:{$exists:true}}).limit(3).toArray();
 for(const id of [...new Set(additions.map(a=>String(a.run)))]){
  const data=await get('/run?id='+id);
  for(const item of data.run.additionalFiles||[])if(item.file?.catalogue?.retrospective){
   assert(item.file.locationUri?.endsWith(item.file.path));assert(item.file.catalogue.classification);publicOnly(item.file);publicOnly(item);additionalLocations++;
  }
 }
 assert(additionalLocations>0,'No new catalogue locations checked');
 await mig.verifyUnchangedDatabase(db,plan);
 const result={at:new Date(),planSha256:digest,exactOperationsVerifiedAfterRestart:plan.operations.length,unplannedDatabaseChanges:false,originalIndexesUnchanged:true,activeProjects:active.length,retiredDocumentsHiddenAndAdminHistoryAvailable:retired,correctedParentPathsVerified:correctedPaths,processedReadLocationsVerified:processedLocations,additionalFileLocationsVerified:additionalLocations,adminAccessControlsPassed:true,checks};
 fs.writeFileSync(pack+'/live-acceptance.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>m.disconnect());
