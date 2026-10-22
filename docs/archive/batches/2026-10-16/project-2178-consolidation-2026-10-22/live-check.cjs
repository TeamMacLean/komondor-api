'use strict';
const fs=require('fs'),assert=require('assert/strict');
const api='/storage/www/komondor-api',pack='/storage/komondor-project2178-20261022';process.env.KOMONDOR_API_ROOT=api;
const m=require(api+'/node_modules/mongoose'),jwt=require(api+'/node_modules/jsonwebtoken'),op=require('./operation.cjs'),mig=require(api+'/lib/archive-reconciliation');m.set('autoIndex',false);m.set('autoCreate',false);require(api+'/node_modules/dotenv').config({path:api+'/.env'});
const plan=JSON.parse(fs.readFileSync(pack+'/approved-plan.json')),execution=JSON.parse(fs.readFileSync(pack+'/execution/execution.json'));
const token=jwt.sign({username:'deeks',isAdmin:true},process.env.JWT_SECRET,{expiresIn:'5m'});let requests=0,visibleLocations=0;
async function get(url,status=200){const r=await fetch('http://127.0.0.1:3061'+url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});assert.equal(r.status,status,url);requests++;return r.json();}
(async()=>{
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true});
 const verify=await op.validateResults(m.connection.db,plan,execution.at,execution.planSha256);
 for(const name of ['Project','Sample','Run','Read','AdditionalFile','File','IngestJob'])require(api+'/models/'+name);
 assert.equal((await get('/ready')).status,'ready');
 const project=await m.model('Project').findById(op.PROJECT);assert.equal(project.owner,'talbotn');assert.equal(project.path,op.ROOT);
 const database=await require(api+'/lib/s3-archive/preflight').collectProjectDatabase(m.models,project._id);
 assert.equal(database.samples.length,3);assert.equal(database.runs.length,3);assert.equal(database.additionalFiles.length,39);assert.equal(database.reads.length,0);
 const physical=await op.tree(plan.datastoreRoot,op.ROOT),overlay=require(api+'/lib/s3-archive/preflight').overlayDatabase({entries:physical.entries},database,op.ROOT.slice(1));
 assert.equal(overlay.anomalies.filter(a=>a.serious).length,0);assert.equal(overlay.anomalies.filter(a=>a.kind==='disk-file-untracked').length,0);
 for(const [kind,docs]of [['project',[project]],['sample',database.samples],['run',database.runs]])for(const d of docs){
  const actual=(await get('/'+kind+'?id='+d._id))[kind];assert.equal(actual.path,d.path);assert(!actual.reconciliation&&!actual.reconciliationHistory);
  for(const item of actual.additionalFiles||[]){assert(item.file?.locationUri?.endsWith(item.file.path));assert(!item.file.reconciliation&&!item.file.reconciliationHistory);visibleLocations++;}
 }
 assert.equal(visibleLocations,39);
 for(const item of plan.operations.filter(o=>o.beforeBson)){
  const record=(await get('/admin/reconciliation-record?collection='+item.collection+'&id='+item.id)).record;const before=mig.unpack(item.beforeBson);assert.equal(record.reconciliationHistory.length,(before.reconciliationHistory||[]).length+1);assert.equal(record.reconciliationHistory.at(-1).planSha256,execution.planSha256);
 }
 await op.validateResults(m.connection.db,plan,execution.at,execution.planSha256);
 const result={at:new Date(),planSha256:execution.planSha256,...verify,requests,visibleFileLocations:visibleLocations,projectOwner:project.owner,samples:3,runs:3,scientificReads:0,archiveOverlaySeriousAnomalies:0,untrackedFiles:0,allPriorHistoriesRetained:true,knownAssociationHoldResolved:true,note:'Fresh live structural archive preflight; full AWS CLI plan recorded separately. No S3 writes or new payload checksum sweep.'};
 fs.writeFileSync(pack+'/live-check.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>m.disconnect());
