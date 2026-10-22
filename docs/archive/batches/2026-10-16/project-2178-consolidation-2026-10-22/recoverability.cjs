'use strict';
// Read-only recovery gate used by the tsldata service controller.
const fs=require('fs'),assert=require('assert/strict');
const api=process.env.KOMONDOR_API_ROOT||'/storage/www/komondor-api';
const op=require('./operation.cjs'),mig=require(api+'/lib/archive-reconciliation'),reg=require(api+'/lib/archive-registration'),{ObjectId}=require(api+'/node_modules/bson');
async function check(db){
 const raw=fs.readFileSync('/storage/komondor-project2178-20261022/approved-plan.json'),digest=reg.sha256(raw),plan=JSON.parse(raw);
 assert.equal(digest,'f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b');
 return checkPlan(db,plan,digest);
}
async function checkPlan(db,plan,digest){
 assert.equal(plan.toolVersion,op.toolVersion());
 const state=await op.filesystemState(plan);
 if(state==='before'){
  for(const item of plan.operations){const d=await db.collection(item.collection).findOne({_id:new ObjectId(item.id)});assert(mig.equal(d,item.beforeBson?mig.unpack(item.beforeBson):null),'Database changed while physical tree remains at original path');}
  await mig.verifyUnchangedDatabase(db,plan);return {state,safe:true,reason:'No consolidation mutations occurred'};
 }
 const project=await db.collection('projects').findOne({_id:new ObjectId(plan.projectId)});
 const event=project?.reconciliationHistory?.find(e=>e.planSha256===digest);
 assert(event,'Directory moved but database consolidation has not completed; keep services paused');
 await op.validateResults(db,plan,event.at,digest);
 return {state,safe:true,operations:69,files:39,reason:'All moved-file metadata and database operations verified'};
}
module.exports={check,checkPlan};
