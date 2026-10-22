'use strict';
// Detached deeks runner. The tsldata controller alone restores services.
const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const pack='/storage/komondor-project2178-20261022',work=pack+'/execution',api='/storage/www/komondor-api',node='/storage/.nvm/versions/node/v24.11.1/bin/node';
process.env.KOMONDOR_API_ROOT=api;
const digest='f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b';
const save=(name,value)=>fs.writeFileSync(pack+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
(async()=>{
 assert(process.argv.includes('--execute'));
 const paused=JSON.parse(fs.readFileSync('/storage/komondor-project2178-window-20261022/paused.json'));
 assert.equal(paused.planSha256,digest);assert(Date.parse(paused.expiresAt)>Date.now()+8*60*1000,'Insufficient frozen window remaining');
 assert(paused.allApiInstancesStopped&&paused.powerPaused&&paused.nudgePaused&&paused.webPaused&&paused.externalWritersFrozen);
 const approval=JSON.parse(fs.readFileSync(pack+'/execution-ready.json'));assert(approval.independentBackupRestored&&approval.shadowReplayPassed);assert.equal(approval.planSha256,digest);
 for(const [name,head]of [['komondor-api','27b98035dccf1b33e2f449be972e2003b4114b24'],['komondor-web','e9e183cc6968da46a4b0eada76471b750745a771']]){
  assert.equal(cp.execFileSync('git',['-C','/storage/www/'+name,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);assert.equal(cp.execFileSync('git',['-C','/storage/www/'+name,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
 }
 save('runner-started.json',{at:new Date(),runId:paused.runId,planSha256:digest});
 save('quiescence.json',{recordedAt:paused.at,expiresAt:paused.expiresAt,actor:'deeks',planSha256:digest,windowRunId:paused.runId,allApiInstancesStopped:true,powerPaused:true,nudgePaused:true,webPaused:true,externalWritersFrozen:true,backupIndependentlyRetained:true,apiReadyUrls:['http://127.0.0.1:3061/ready']});
 const log=fs.openSync(pack+'/apply.log','wx',0o600);
 try{cp.execFileSync(node,[pack+'/operation.cjs','apply','--database','komondor','--work-dir',work,'--backup-plan',pack+'/approved-plan.json','--plan-sha256',digest,'--quiescence-receipt',pack+'/quiescence.json','--execute'],{env:process.env,stdio:['ignore',log,log],timeout:10*60*1000});}finally{fs.closeSync(log);}
 const m=require(api+'/node_modules/mongoose'),mig=require(api+'/lib/archive-reconciliation'),{BSON}=require(api+'/node_modules/bson'),bson=new BSON();m.set('autoIndex',false);m.set('autoCreate',false);require(api+'/node_modules/dotenv').config({path:api+'/.env'});
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true});
 try{
  const plan=JSON.parse(fs.readFileSync(work+'/plan.json')),execution=JSON.parse(fs.readFileSync(work+'/execution.json'));
  const verification=await require(pack+'/operation.cjs').validateResults(m.connection.db,plan,execution.at,digest),docs=[];
  for(const op of plan.operations){const d=await m.connection.db.collection(op.collection).findOne({_id:new m.Types.ObjectId(op.id)});assert(mig.equal(d,mig.materialize(plan,op,new Date(execution.at),digest)));docs.push(bson.serialize(d));}
  const bytes=Buffer.concat(docs);fs.writeFileSync(pack+'/after-documents.bson',bytes,{flag:'wx',mode:0o600});
  const result={at:new Date(),runId:paused.runId,planSha256:digest,...verification,afterDocumentsBytes:bytes.length,afterDocumentsSha256:crypto.createHash('sha256').update(bytes).digest('hex'),note:'Wait for independent after-image verification before asking the service controller to restore.'};save('applied-verified.json',result);console.log(JSON.stringify(result));
 }finally{await m.disconnect();}
})().catch(e=>{console.error(e.stack);try{save('runner-failed.json',{at:new Date(),error:e.message});}catch(_){}process.exitCode=1;});
