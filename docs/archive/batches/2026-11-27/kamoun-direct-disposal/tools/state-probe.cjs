'use strict';
// Independent read-only restart admission; the controller calls this while it
// holds window-reopen.lock. A partial graph never permits a service restart.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {makeEngine,validatePlan,COLLECTIONS,TYPED}=require('./retirement.cjs');
const {readRegular}=require('./window.cjs');
const API='/storage/www/komondor-api',PACK='/storage/komondor-kamoun-disposal-20261127-01';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),id=x=>String(x?._id||x);
function alive(pid,kill=process.kill){
 assert(Number.isInteger(pid)&&pid>1,'Invalid mutator PID');
 try{kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;}
}
function classify(operations,current,equal,hasExecution){
 const expected=new Set(operations.map(o=>o.collection+':'+o.id)),observed=new Map(COLLECTIONS.flatMap(c=>current[c].map(d=>[c+':'+id(d),d])));
 let before=0,applied=0,diverged=0;
 for(const op of operations){const d=observed.get(op.collection+':'+op.id);if(equal(d,op.before))before++;else if(hasExecution&&equal(d,op.after))applied++;else diverged++;}
 for(const key of observed.keys())if(!expected.has(key))diverged++;
 const state=diverged?'diverged':before===operations.length?'before':applied===operations.length?'applied':'partial';
 return{state,counts:{before,applied,diverged},records:operations.length};
}
async function main(argv=process.argv.slice(2)){
 assert.equal(argv.length,8);const options={};for(let i=0;i<argv.length;i+=2){assert(['--plan','--plan-sha256','--window-dir','--run-id'].includes(argv[i]));assert(!options[argv[i]]);options[argv[i]]=argv[i+1];}
 assert.equal(options['--window-dir'],PACK);assert.match(options['--plan-sha256'],/^[a-f0-9]{64}$/);assert.match(options['--run-id'],/^[a-zA-Z0-9_-]{8,100}$/);
 const raw=readRegular(path.resolve(options['--plan']),PACK),digest=sha(raw);assert.equal(digest,options['--plan-sha256']);const plan=JSON.parse(raw);
 // A stale plan must never authorize mutation. Restart admission only checks
 // an existing exact before/after state, and remains usable after expiry.
 validatePlan(plan,Date.parse(plan.preparedAt));
 assert.equal(cp.execFileSync('git',['-C',API,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),plan.apiHead,'Code changed');
 const executionPath=path.join(PACK,'retirement-execution.json');let execution=null;
 if(fs.existsSync(executionPath)){execution=JSON.parse(readRegular(executionPath,PACK));assert.equal(execution.planSha256,digest);assert.equal(execution.apiHead,plan.apiHead);assert.equal(execution.runId,options['--run-id']);assert(Number.isFinite(Date.parse(execution.executionAt)));}
 const bsonModule=require(API+'/node_modules/bson'),{MongoClient,ObjectId}=require(API+'/node_modules/mongodb'),bson=new(bsonModule.BSON||bsonModule)();
 const engine=makeEngine({bson,ObjectId});let client;
 try{
  client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});const db=client.db('komondor');
  const [info]=await db.listCollections({name:'projects'}).toArray();assert.equal(plan.databaseIdentity.name,'komondor');assert.equal(plan.databaseIdentity.port,28015);assert(['127.0.0.1','localhost'].includes(plan.databaseIdentity.host));assert.equal(info?.info?.uuid?.toString('hex'),plan.databaseIdentity.collectionUuid,'Database identity changed');
  const operations=engine.buildOperations(plan,digest,execution?.executionAt||plan.preparedAt),current=await engine.collect(db,plan);
  const result=classify(operations,current,engine.equal,!!execution);
  const protectedRows=plan.graph.protectedCollections?.projects;assert(Array.isArray(protectedRows)&&protectedRows.length===13,'Protected before-images missing');
  const actual=await db.collection('projects').find({_id:{$in:protectedRows.map(r=>new ObjectId(r.id))}},TYPED).toArray();assert.equal(actual.length,protectedRows.length);
  for(const row of protectedRows)assert(engine.equal(actual.find(d=>id(d)===row.id),engine.unpack(row.bson)),'Protected Project changed');
  const mutationInProgress=fs.existsSync(path.join(PACK,'mutation.lock'))||!!(execution&&alive(execution.pid));
  console.log(JSON.stringify({at:new Date().toISOString(),runId:options['--run-id'],planSha256:digest,apiHead:plan.apiHead,...result,protectedProjectsUnchanged:true,mutationInProgress,safeToReopen:!mutationInProgress&&['before','applied'].includes(result.state)}));
 }finally{if(client)await client.close();}
}
module.exports={classify,alive,main};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
