'use strict';
const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const pack='/storage/komondor-reconciliation-20261022',work='/storage/komondor-reconciliation-final-20261022';
const api='/storage/www/komondor-api',web='/storage/www/komondor-web',node='/storage/.nvm/versions/node/v24.11.1/bin/node';
const digest='6ba8c00fddf137fe36f2288fd7c1d151ee589edc852903fc66e2e9e0a8b3e303';
const apiHead='27b98035dccf1b33e2f449be972e2003b4114b24',webHead='e9e183cc6968da46a4b0eada76471b750745a771';
const git=(repo,args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:30000}).trim();
const save=(name,value)=>fs.writeFileSync(pack+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
(async()=>{
 assert(process.argv.includes('--execute'),'Explicit execute required');
 const paused=JSON.parse(fs.readFileSync('/storage/komondor-reconciliation-window-20261022/paused.json'));
 assert.equal(paused.planSha256,digest);assert(Date.parse(paused.expiresAt)>Date.now()+8*60*1000,'Insufficient window remaining');
 assert(paused.allApiInstancesStopped&&paused.powerPaused&&paused.nudgePaused&&paused.webPaused&&paused.externalWritersFrozen);
 const approved=JSON.parse(fs.readFileSync(pack+'/execution-ready.json'));
 assert.equal(approved.planSha256,digest);assert(approved.independentBackupRestored&&approved.shadowReplayPassed&&approved.webBuildSucceeded);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(work+'/plan.json')).digest('hex'),digest);
 assert(fs.readFileSync(work+'/plan.json').equals(fs.readFileSync(pack+'/approved-plan.json')));
 const staged='/storage/komondor-reconciliation-web-build-20261022/.nuxt';
 assert.equal(JSON.parse(fs.readFileSync(staged+'/reconciliation-release.json')).head,webHead);
 for(const [repo,oldHead,newHead,branch]of [[api,'4cd738e6c2d9d508b2248ff4298061e576109c19',apiHead,'codex/reconcile-archive-catalogue'],[web,'beb0b95e4df5ef630b4847f84c3e45f637b7888a',webHead,'codex/reconcile-archive-locations']]){
  assert.equal(git(repo,['status','--porcelain']),'');const current=git(repo,['rev-parse','HEAD']);assert([oldHead,newHead].includes(current));
  if(current!==newHead)git(repo,['checkout','-b',branch,'reconciliation/approved']);
  assert.equal(git(repo,['rev-parse','HEAD']),newHead);
 }
 if(!fs.existsSync(pack+'/web-build-before'))fs.renameSync(web+'/.nuxt',pack+'/web-build-before');
 assert(!fs.existsSync(web+'/.nuxt'),'Do not overwrite an existing replacement build');
 fs.cpSync(staged,web+'/.nuxt',{recursive:true,errorOnExist:true,force:false});
 cp.execFileSync('chmod',['-R','a+rX',web+'/.nuxt']);
 const receipt={recordedAt:paused.at,expiresAt:paused.expiresAt,actor:'deeks',planSha256:digest,windowRunId:paused.runId,
  allApiInstancesStopped:true,powerPaused:true,nudgePaused:true,webPaused:true,externalWritersFrozen:true,backupIndependentlyRetained:true,apiReadyUrls:['http://127.0.0.1:3061/ready']};
 save('quiescence.json',receipt);
 const wrapper='require("dotenv").config();process.env.MONGODB_URI=require("./lib/utils/validateEnv").resolveMongoUri();require("./scripts/reconcile-archive-database").main(process.argv.slice(1)).catch(e=>{console.error(e.message);process.exitCode=1})';
 const log=fs.openSync(pack+'/apply.log','wx',0o600);
 try{cp.execFileSync(node,['-e',wrapper,'apply','--work-dir',work,'--database','komondor','--actor','deeks','--backup-plan',pack+'/approved-plan.json','--plan-sha256',digest,'--quiescence-receipt',pack+'/quiescence.json','--execute'],{cwd:api,stdio:['ignore',log,log],timeout:12*60*1000});}finally{fs.closeSync(log);}
 const m=require(api+'/node_modules/mongoose'),mig=require(api+'/lib/archive-reconciliation'),{BSON}=require(api+'/node_modules/bson'),bson=new BSON();
 m.set('autoIndex',false);m.set('autoCreate',false);require(api+'/node_modules/dotenv').config({path:api+'/.env'});
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 try{
  const plan=JSON.parse(fs.readFileSync(work+'/plan.json')),execution=JSON.parse(fs.readFileSync(work+'/execution.json')),db=m.connection.db;
  await mig.verifyUnchangedDatabase(db,plan);
  const after=[];
  for(const op of plan.operations){const doc=await db.collection(op.collection).findOne({_id:new m.Types.ObjectId(op.id)});assert(mig.equal(doc,mig.materialize(plan,op,new Date(execution.at),digest)),'Operation mismatch '+op.collection+':'+op.id);after.push(bson.serialize(doc));}
  const bytes=Buffer.concat(after);fs.writeFileSync(pack+'/after-documents.bson',bytes,{flag:'wx',mode:0o600});
  for(const o of plan.observations){const fresh=await mig.observe(plan.datastoreRoot,o.target);assert(mig.equal(fresh.rootStat,o.rootStat)&&mig.equal(fresh.entries,o.entries),'Physical inventory changed '+o.entryId);}
  const result={at:new Date(),windowRunId:paused.runId,planSha256:digest,releaseHead:apiHead,webReleaseHead:webHead,operations:plan.operations.length,
   exactOperationsVerified:true,unplannedDatabaseChanges:false,originalIndexesUnchanged:true,physicalMetadataUnchanged:true,
   afterDocumentsSha256:crypto.createHash('sha256').update(bytes).digest('hex'),afterDocumentsBytes:bytes.length,
   holds:plan.holds,counts:{projects:await db.collection('projects').countDocuments(),files:await db.collection('files').countDocuments(),additionalfiles:await db.collection('additionalfiles').countDocuments(),reads:await db.collection('reads').countDocuments()},
   note:'Await independent copy verification before requesting service recovery.'};
  save('applied-verified.json',result);console.log(JSON.stringify(result));
 }finally{await m.disconnect();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
