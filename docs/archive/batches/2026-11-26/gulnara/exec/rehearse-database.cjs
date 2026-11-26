'use strict';
// Actual MongoDB rehearsal, restricted to a disposable local database.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const modules=process.env.GULNARA_REHEARSAL_MODULES||'/Users/deeks/Local_Documents/Local_GitHub/komondor-api/node_modules';
const {MongoClient,ObjectId}=require(path.join(modules,'mongodb'));const BSON=require(path.join(modules,'bson'));const bson=new BSON();
const {createExecutor,TYPED}=require('./database.cjs');
const uri=process.env.GULNARA_REHEARSAL_URI;
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/komondor-gulnara-rehearsal-[a-f0-9]{8}$/.test(uri||''),'Disposable local URI required');
assert(!process.env.SSH_CONNECTION,'Never run this rehearsal through production SSH');
const base=path.dirname(__dirname),scope=JSON.parse(fs.readFileSync(path.resolve(base,'../../../evidence/release-planning-20261030/gulnara-scope.json')));
const plan=JSON.parse(fs.readFileSync(path.join(base,'change-plan.json'))),work=process.env.GULNARA_REHEARSAL_WORK;
assert(work&&fs.lstatSync(work).isDirectory());
const raw=JSON.parse(fs.readFileSync(process.env.GULNARA_REHEARSAL_BSON));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{const client=await MongoClient.connect(uri,{useNewUrlParser:true,useUnifiedTopology:true});
try{const db=client.db(uri.split('/').at(-1));
 const seed=async()=>{await db.dropDatabase();for(const [name,rows]of Object.entries(raw.collections))if(rows.length)await db.collection(name).insertMany(rows.map(x=>bson.deserialize(Buffer.from(x,'base64'),TYPED)));};
 const results=[];
 async function scenario(name,interruption,direction){
  await seed();let writes=0,triggered=false;const opts={db,ObjectId,bson,workDir:path.join(work,name),scope,reviewPlan:plan,actor:'deeks',toolVersion:'local-real-mongo-rehearsal',operationId:crypto.randomUUID(),reviewedPlanSha256:sha(fs.readFileSync(path.join(base,'change-plan.json'))),expectedCopyReceiptSha256:'a'.repeat(64),validateWindow:async()=>{},
   afterWrite:async()=>{if(interruption && ++writes===interruption&&!triggered){triggered=true;throw Error('rehearsal interruption after durable write');}}};
  const e=createExecutor(opts),prepared=await e.prepare(),arg={expectedPlanSha256:prepared.preparedPlanSha256};assert.equal((await e.recoverState(arg)).state,'before');
  if(interruption){await assert.rejects(()=>e.apply(arg),/rehearsal interruption/);const partial=await e.recoverState(arg);assert.equal(partial.state,'partial');assert.equal(partial.safeToReopen,false);}
  if(direction==='rollback'){
   const reverted=await e.rollback(arg);assert.equal(reverted.state,'reversed');assert.equal((await e.recoverState(arg)).safeToReopen,true);
  }else{
   const applied=await e.apply(arg);assert.equal(applied.counts.applied,64);assert.equal((await e.verify(arg)).state,'applied');
   assert.equal((await e.apply(arg)).counts.applied,64,'Exact successful state must be adopted');
   const reversed=await e.rollback(arg);assert.equal(reversed.counts.reversed,64);assert.equal(reversed.safeToReopen,true);
  }
  results.push({name,passed:true,interruptedAfter:interruption||null});
 }
 await scenario('complete-and-reverse',0,'apply');await scenario('interrupted-and-resume',5,'apply');await scenario('interrupted-and-reverse',17,'rollback');
 console.log(JSON.stringify({at:new Date().toISOString(),database:db.databaseName,sourceSnapshotAt:raw.at,results,allPassed:true},null,2));
 await db.dropDatabase();
}finally{await client.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
