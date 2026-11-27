'use strict';
// Exercise the exact typed graph and Mongo conditional writes in a unique,
// isolated scratch database. Production is never selected by this script.
const assert=require('assert/strict'),fs=require('fs'),crypto=require('crypto');
const API='/storage/www/komondor-api',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const {makeEngine,COLLECTIONS,TYPED}=require('./retirement.cjs');
const bsonModule=require(API+'/node_modules/bson'),bson=new(bsonModule.BSON||bsonModule)();
const {ObjectId}=require(API+'/node_modules/mongodb');
const mongoose=require(API+'/node_modules/mongoose');mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
async function main(){
 const raw=fs.readFileSync(process.argv[2]),plan=JSON.parse(raw),digest=sha(raw),engine=makeEngine({bson,ObjectId});
 const token=crypto.randomUUID(),name='komondor_disposal_rehearsal_'+token.replaceAll('-','');
 assert(name.startsWith('komondor_disposal_rehearsal_')&&name!=='komondor');
 let owned=false,result;
 await mongoose.connect('mongodb://127.0.0.1:28015/'+name,{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});const db=mongoose.connection.db;
 try{
  assert.equal(db.databaseName,name);assert.equal((await db.listCollections().toArray()).length,0);
  await db.collection('rehearsal_owner').insertOne({_id:token,kind:'isolated-retirement-rehearsal'});owned=true;
  const before=engine.decode(plan.graph);
  for(const c of COLLECTIONS){const rows=[...before[c],...(plan.graph.protectedCollections[c]||[]).map(r=>engine.unpack(r.bson))];if(rows.length)await db.collection(c).insertMany(rows,{writeConcern:{w:'majority',j:true}});}
  const loaded=await engine.collect(db,plan);for(const c of COLLECTIONS){assert.equal(loaded[c].length,before[c].length);for(const d of before[c])assert(engine.equal(d,loaded[c].find(x=>String(x._id)===String(d._id))));}
  const executionAt=new Date().toISOString(),start=Date.now(),journal=[];
  const checkNormalVisibility=async operations=>{const names={projects:'Project',samples:'Sample',runs:'Run',reads:'Read',additionalfiles:'AdditionalFile',files:'File',ingestjobs:'IngestJob',newsitems:'NewsItem'};for(const[c,n]of Object.entries(names)){const ids=operations.filter(o=>o.collection===c).map(o=>o.id);if(ids.length){const Model=require(API+'/models/'+n);assert.equal(await Model.countDocuments({_id:{$in:ids}}),0);}}};
  result=await engine.apply({db,plan,digest,executionAt,checkQuiescence:async()=>{assert.equal(db.databaseName,name);},checkInventory:async()=>{},checkNormalVisibility,save:async(n,v)=>journal.push({name:n,sha256:sha(Buffer.from(JSON.stringify(v)))})});
  assert.equal(result.retiredRecords,2459);assert.equal(result.retiredProjects,6);
  for(const c of COLLECTIONS)assert.equal(await db.collection(c).countDocuments({'reconciliation.retiredAt':{$exists:true}}),before[c].length);
  let refused=false;try{await engine.apply({db,plan,digest,executionAt,checkQuiescence:async()=>{},checkInventory:async()=>{},checkNormalVisibility,save:async()=>{}});}catch(e){refused=/before\/after|differs|Record/.test(e.message);}assert(refused,'Uninspected repeat did not refuse');
  const resumed=await engine.apply({db,plan,digest,executionAt,resume:true,checkQuiescence:async()=>{},checkInventory:async()=>{},checkNormalVisibility,save:async()=>{}});assert.equal(resumed.adopted,2459);assert.equal(resumed.written,0);
  result={at:new Date().toISOString(),success:true,planSha256:digest,helperSha256:sha(fs.readFileSync(require.resolve('./retirement.cjs'))),scratchDatabase:name,records:2459,exactTypedBsonRoundTrip:true,allConditionalWritesPassed:true,allNormalModelsExcludeRetired:true,protectedProjectsUnchanged:true,uninspectedRepeatRefused:true,inspectedResumeAdoptedWithoutWrites:true,journalEntries:journal.length,durationMs:Date.now()-start,productionWrites:0,payloadWrites:0,servicesChanged:false,nativeQuiescenceAndInventoryExercised:false};
 }finally{
  if(owned){assert.equal(db.databaseName,name);assert(await db.collection('rehearsal_owner').findOne({_id:token,kind:'isolated-retirement-rehearsal'}));await db.dropDatabase();if(result)result.scratchDatabaseRemoved=true;}
  await mongoose.disconnect();
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
