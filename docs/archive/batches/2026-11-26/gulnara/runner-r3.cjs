'use strict';
// Executes only the reviewed Gulnara operation. PM2 is controlled separately
// by George's tsldata window controller, never by this runner.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),os=require('os');
const pack=__dirname,api='/storage/www/komondor-api';
const PREDECESSOR='/storage/komondor-gulnara-20261126';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const exists=n=>fs.existsSync(path.join(pack,n));
function readAt(root,name){assert(!path.isAbsolute(name)&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'));let at=root;assert(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink());for(const part of name.split('/')){at=path.join(at,part);assert(!fs.lstatSync(at).isSymbolicLink());}const fd=fs.openSync(at,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{assert(fs.fstatSync(fd).isFile());return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
const readBytes=name=>readAt(pack,name);
const read=name=>JSON.parse(readBytes(name));
function save(name,value){const fd=fs.openSync(path.join(pack,name),'wx',0o640);try{fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,json(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(x);
const validDigest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function parseFlags(args,required,optional=[]){
 assert.equal(args.length%2,0,'Flags require explicit values');const result={};
 for(let i=0;i<args.length;i+=2){const key=args[i];assert(required.includes(key)||optional.includes(key),'Unexpected flag '+key);assert(!(key in result),'Duplicate flag '+key);result[key]=args[i+1];}
 for(const key of required)assert(key in result,'Missing '+key);return result;
}
function assertPidExited(pid,kill=process.kill.bind(process)){
 if(pid===null)return;assert(Number.isInteger(pid)&&pid>1,'Missing prior process PID');
 try{kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}
 assert.fail('Previous controller or mutator remains alive: '+pid);
}
function validateJournal(bytes,operationId){
 if(!bytes.length)return sha(bytes);const value=bytes.toString('utf8');assert(value.endsWith('\n'),'Incomplete database journal; inspect manually');
 let previous=sha(Buffer.from(operationId)),sequence=0;
 for(const line of value.trimEnd().split('\n')){const {sha256,...body}=JSON.parse(line);assert.equal(body.sequence,sequence++);assert.equal(body.previous,previous);assert.equal(body.operationId,operationId);assert.equal(sha(Buffer.from(json(body))),sha256,'Database journal chain changed');previous=sha256;}
 return sha(bytes);
}
function assertRecoveryState(result,action){
 assert(['resume','rollback'].includes(action));assert.deepEqual(result.differences,[],'Database closure changed');
 assert.deepEqual(Object.keys(result.counts).sort(),['applied','before','diverged','reversed']);
 for(const n of Object.values(result.counts))assert(Number.isInteger(n)&&n>=0);
 assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),64);assert.equal(result.counts.diverged,0);
 assert((action==='resume'?['before','partial','applied']:['before','partial','applied','reversed']).includes(result.state),'Unreviewed recovery state');
 if(action==='resume')assert.equal(result.counts.reversed,0,'Resume cannot overwrite reversals');
 if(result.state==='before')assert.equal(result.counts.before,64);
 if(result.state==='applied')assert.equal(result.counts.applied,64);
 if(result.state==='reversed')assert(result.counts.applied===0&&result.counts.reversed>0);
 if(result.state==='partial')assert(result.counts.applied>0&&result.counts.applied<64);
}
function inspectStaleLock(root,name,expected,operationId){
 assert(expected==='absent'||validDigest(expected),'Explicit stale-lock digest is required');const location=path.join(root,name);
 if(!fs.existsSync(location)){assert.equal(expected,'absent','Expected stale lock is missing');return null;}
 assert.notEqual(expected,'absent','Unexpected stale lock');const st=fs.lstatSync(location);assert(!st.isSymbolicLink());
 let filename=name;
 if(st.isDirectory()){assert.deepEqual(fs.readdirSync(location),['owner.json'],'Unrecognized lock contents');filename+='/owner.json';}
 else assert(st.isFile());
 const file=path.join(root,filename),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());const bytes=fs.readFileSync(file);assert.equal(sha(bytes),expected,'Stale lock differs from inspected bytes');
 const owner=JSON.parse(bytes);assert.equal(owner.operationId,operationId);const pid=owner.pid??owner.controllerPid;assertPidExited(pid);
 return {name,filename,sha256:expected,pid,owner};
}
function assertNoOtherPackProcesses(){
 // Exclude this command's shells/SSH ancestors, but no other runner or worker.
 const ancestors=new Set([process.pid]);let p=process.pid;
 while(p>1){const status=fs.readFileSync('/proc/'+p+'/status','utf8'),m=status.match(/^PPid:\s+(\d+)$/m);if(!m)break;p=Number(m[1]);if(ancestors.has(p))break;ancestors.add(p);}
 for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)&&!ancestors.has(Number(x)))){
  let cmd;try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0/g,' ');}catch(e){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(e.code))continue;throw e;}
  assert(!cmd.includes(pack+'/'),'Another execution-pack process is present: '+pid);
 }
}
function assertNoPredecessorProcesses(root){
 const ancestors=new Set([process.pid]);let p=process.pid;
 while(p>1){const status=fs.readFileSync('/proc/'+p+'/status','utf8'),m=status.match(/^PPid:\s+(\d+)$/m);if(!m)break;p=Number(m[1]);if(ancestors.has(p))break;ancestors.add(p);}
 for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)&&!ancestors.has(Number(x)))){
  let cmd;try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0/g,' ');}catch(e){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(e.code))continue;throw e;}
  assert(!cmd.includes(root+'/'),'Predecessor execution process is present: '+pid);
 }
}
function assertPredecessor(config,copyReceiptSha256,{root=PREDECESSOR,checkProcesses=assertNoPredecessorProcesses,kill=process.kill.bind(process)}={}){
 const predecessor=config.predecessor;assert(predecessor&&typeof predecessor==='object','Predecessor approval is mandatory');
 assert.equal(predecessor.pack,root);assert.equal(predecessor.restoredFile,'window/restored.json');assert(validDigest(predecessor.restoredSha256));assert(Number.isInteger(predecessor.mutatorPid)&&predecessor.mutatorPid>1);
 const bytes=readAt(root,predecessor.restoredFile);assert.equal(sha(bytes),predecessor.restoredSha256,'Predecessor restoration evidence changed');const receipt=JSON.parse(bytes);
 assert.equal(receipt.operationId,config.operationId);assert.equal(receipt.planSha256,config.planSha256);assert.equal(receipt.copyReceiptSha256,copyReceiptSha256);assert.equal(receipt.apiReady,true);assert.equal(receipt.graphState,'before');assert(validId(receipt.runId));
 const oldState=receipt.consistency;assert(oldState);for(const key of ['operationId','runId','planSha256','preparedPlanSha256','copyReceiptSha256'])assert.equal(oldState[key],receipt[key]);
 assert.equal(oldState.state,'before');assert.deepEqual(oldState.counts,{before:64,applied:0,reversed:0,diverged:0});assert.deepEqual(oldState.differences,[]);assert.equal(oldState.safeToReopen,true);assert.equal(oldState.mutationInProgress,false);assert.equal(oldState.copiesConsistent,true);assert.equal(oldState.journalSha256,sha(Buffer.alloc(0)));
 assert.equal(oldState.physical.state,'staged');assert.equal(oldState.physical.files,40);assert.equal(oldState.physical.stagedFiles,40);assert.equal(oldState.physical.publishedFiles,0);assert.equal(oldState.physical.claimedRoots,0);assert.equal(oldState.physical.privateRoots,0);assert.equal(oldState.physical.copiesConsistent,true);
 const services=receipt.services;assert.equal(services?.length,4);assert.deepEqual(services.map(x=>x.name).sort(),['komondor-api','komondor-nudge','komondor-power','komondor-web']);assert(services.every(x=>x.status==='online'));
 assertPidExited(receipt.controllerPid,kill);assertPidExited(predecessor.mutatorPid,kill);
 for(const name of ['mutation.lock','db-evidence/active.lock','window-reopen.lock','recovery-prepare.lock','active-recovery.json','copy-worker.lock','retry-window-r2.lock','db-evidence/execution.json','db-evidence/journal.jsonl','db-evidence/rollback-plan.json'])assert(!fs.existsSync(path.join(root,name)),'Predecessor is active or changed: '+name);
 const complete=JSON.parse(readAt(root,'window-complete.json'));for(const key of ['operationId','runId','planSha256','preparedPlanSha256'])assert.equal(complete[key],receipt[key]);assert.equal(complete.state,'before');
 checkProcesses(root);return {pack:root,restoredSha256:predecessor.restoredSha256,runId:receipt.runId,controllerPid:receipt.controllerPid,mutatorPid:predecessor.mutatorPid,verified:true};
}
function assertPublicationProof(result,state,{untouchedStage=false}={}){
 assert.equal(result.copiesConsistent,true);assert.equal(result.privateRoots,0);assert.equal(result.retainedStageFiles,40);assert.equal(result.files,40);assert.equal(result.bytes,41432635417);
 for(const key of ['stagedFiles','publishedFiles','claimedRoots'])assert(Number.isInteger(result[key])&&result[key]>=0);
 assert(result.claimedRoots<=12);assert.equal(result.stagedFiles+result.publishedFiles,40);
 assert.equal(result.state,result.publishedFiles===0?'staged':result.publishedFiles===40?'published':'partly-published');
 if(untouchedStage){assert.equal(result.state,'staged');assert.equal(result.publishedFiles,0);assert.equal(result.claimedRoots,0);}
 if(state!=='before')assert.equal(result.state,'published','Changed database graph requires fully published files');
 return result;
}
function checkSeal(){const seal=read('runtime-seal.json');for(const n of ['runner-r3.cjs','exec/database.cjs','exec/window-r3.cjs','exec/listener-probe.cjs','exec/copy.cjs','exec/link-publication.cjs','config.json','scope.json','change-plan.json','db-preflight.cjs','fs-preflight.cjs','filesystem-baseline.json','copy-manifest.json'])assert(seal.files[n],'Missing runtime seal input '+n);for(const [n,h]of Object.entries(seal.files))assert.equal(sha(readBytes(n)),h,n);return sha(readBytes('runtime-seal.json'));}
function assertNoAppProcesses(){
 const names=['api','web','power','nudge'].map(n=>'/storage/www/komondor-'+n);
 for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))){
  let cmd;try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0/g,' ');}catch(e){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(e.code))continue;throw e;}
  if(names.some(n=>cmd.includes(n+'/')) && /node|python|gunicorn|uvicorn/.test(cmd))assert.fail('Application process still present: PID '+pid);
 }
}
async function apiStopped(){const proof=await require('./exec/listener-probe.cjs').waitForStopped();assert.equal(proof.stopped,true,'Could not establish stopped API: '+proof.reason);return proof;}
async function main(){
 assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(pack,'/storage/komondor-gulnara-20261126-r3');
 const [command,...args]=process.argv.slice(2);assert(['prepare-db','apply','resume','verify','safe-to-reopen','rollback','recover-prepare'].includes(command));
 const flags=command==='safe-to-reopen'?parseFlags(args,['--run-id','--plan-sha256'],['--recovery-id']):command==='recover-prepare'?parseFlags(args,['--action','--mutation-lock-sha256','--db-lock-sha256','--reopen-lock-sha256'],['--previous-recovery-id']):parseFlags(args,[],['resume','rollback'].includes(command)?['--recovery-id']:[]);
 const recoveryId=flags['--recovery-id']||null;assert(!recoveryId||validId(recoveryId));if(command==='resume')assert(recoveryId,'Resume requires inspected recovery approval');
 const user=os.userInfo().username;assert(command==='safe-to-reopen'?['deeks','tsldata'].includes(user):user==='deeks');process.umask(0o007);
 const runtimeSha=checkSeal(),config=read('config.json'),scope=read('scope.json'),reviewPlan=read('change-plan.json');
 assert.equal(config.pack,pack);
 assert.equal(config.planSha256,sha(readBytes('change-plan.json')));assert.equal(config.crcImplementationSha256,sha(fs.readFileSync(api+'/lib/utils/crc64nvme.js')));
 assert(exists('copy-stage-complete.json'),'Staged copy is not complete');assert(!exists('copy-worker.lock'),'Copy remains active or ambiguous');
 const copyReceiptSha256=sha(readBytes('copy-evidence/copy-verified.json')),copyComplete=read('copy-stage-complete.json');
 assert.equal(copyComplete.operationId,config.operationId);assert.equal(copyComplete.copyReceiptSha256,copyReceiptSha256);assert.equal(copyComplete.allVerified,true);
 assertPredecessor(config,copyReceiptSha256);
 const {MongoClient,ObjectId}=require(api+'/node_modules/mongodb'),BSON=require(api+'/node_modules/bson'),bson=new BSON();
 const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});
 const db=client.db('komondor'),copy=require('./exec/copy.cjs'),publication=require('./exec/link-publication.cjs');
 const copyOptions={copyManifest:read('copy-manifest.json'),filesystemEvidence:read('filesystem-baseline.json'),scope,stageRoot:config.stageRoot,evidenceDir:path.join(pack,'copy-evidence'),publicationEvidenceDir:path.join(pack,'publication-evidence'),operationId:config.operationId,planSha256:config.planSha256,
   crcFactory:copy.createNodeCrcFactory(require(api+'/lib/utils/crc64nvme').Crc64Nvme)};
 const getReady=()=>{const ready=read('execution-ready.json');assert.equal(ready.operationId,config.operationId);assert.equal(ready.planSha256,config.planSha256);assert.equal(ready.copyReceiptSha256,copyReceiptSha256);assert.equal(ready.runnerFile,'runner-r3.cjs');assert.equal(ready.controllerFile,'exec/window-r3.cjs');assert.deepEqual(ready.predecessor,config.predecessor);for(const[n,h]of Object.entries(ready.files))assert.equal(sha(readBytes(n)),h,n);return ready;};
 const journalSha=()=>{if(!exists('db-evidence/journal.jsonl'))return sha(Buffer.alloc(0));const bytes=readBytes('db-evidence/journal.jsonl');assert(bytes.length>0,'An existing empty database journal needs inspection');return validateJournal(bytes,config.operationId);};
 function getRecovery(id=recoveryId,{fresh=false}={}){
  assert(validId(id));const prefix='recovery/'+id+'/',bytes=readBytes(prefix+'recovery-ready.json'),r=JSON.parse(bytes),ready=getReady(),marker=read('active-recovery.json');
  assert.equal(marker.recoveryId,id);assert.equal(marker.recoveryReadySha256,sha(bytes));assert.equal(marker.operationId,config.operationId);assert.equal(marker.recoveryAction,r.recoveryAction);
  // The operator lease is checked at window admission. A running, bounded
  // window may finish after that lease; its own paused deadline remains strict.
  require('./exec/window-r3.cjs').validateRecovery(r,ready,sha(readBytes('execution-ready.json')),fresh?Date.now():Date.parse(r.preparedAt));
  assert.equal(r.recoveryId,id);for(const[n,h]of Object.entries(r.preservedFiles))assert.equal(sha(readBytes(n)),h,'Preserved evidence changed: '+n);
  const prior=read(prefix+'previous/window/paused.json');assert.equal(prior.runId,r.previousRunId);assert.equal(prior.controllerPid,r.previousControllerPid);
  for(const k of ['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'])assert.equal(prior[k],ready[k]);
  return {...r,recoveryReadySha256:sha(bytes)};
 }
 const windowPrefix=()=>recoveryId?'recovery/'+recoveryId+'/window/':'window/';
 async function assertStoppedWork(){
  await apiStopped();assertNoAppProcesses();
  const jobs=await db.collection('ingestjobs').countDocuments({status:{$nin:['done','failed']}});
  const runs=await db.collection('runs').countDocuments({$or:[{status:{$in:['pending','processing']}},{md5VerificationStatus:'in_progress'}]});
  assert.equal(jobs,0);assert.equal(runs,0);
 }
 async function assertPaused(){
  assertPredecessor(config,copyReceiptSha256);
  assert(!exists('window-reopen.lock'),'Reopening fence is active');assert(!exists('recovery-prepare.lock'),'Recovery preparation fence is active');
  const ready=getReady(),prefix=windowPrefix(),p=read(prefix+'paused.json');
  if(recoveryId){const r=getRecovery();assert.equal(p.recoveryId,recoveryId);assert.equal(p.recoveryAction,r.recoveryAction);assert.equal(p.recoveryReadySha256,r.recoveryReadySha256);assert.equal(p.previousRunId,r.previousRunId);}
  else assert(!exists('active-recovery.json'),'An inspected recovery supersedes the original execution window');
  for(const k of ['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'])assert.equal(p[k],ready[k]);
  assert(p.windowOperator==='tsldata'&&p.externalWritersFrozen&&p.directApiCallersFrozen&&p.allApiInstancesStopped&&p.powerPaused&&p.webPaused&&p.nudgePaused);
  assert(Date.parse(p.expiresAt)>Date.now(),'Maintenance window expired');assert(!exists(prefix+'restored.json')&&!exists(prefix+'restore-failed.json'));
  await assertStoppedWork();return p;
 }
 copyOptions.assertPaused=assertPaused;
 async function verifyStagedMetadata(){
  return assertPublicationProof(await publication.verifyRecoverableCopy(copyOptions),'before',{untouchedStage:true});
 }
 const executor=require('./exec/database.cjs').createExecutor({db,ObjectId,bson,workDir:path.join(pack,'db-evidence'),scope,reviewPlan,actor:'deeks',toolVersion:'gulnara-executor:'+runtimeSha,operationId:config.operationId,reviewedPlanSha256:config.planSha256,expectedCopyReceiptSha256:copyReceiptSha256,
   validateWindow:async({phase})=>{if(phase==='prepare'){assert.equal(command,'prepare-db');assert(!exists('mutation.lock')&&!exists('window-reopen.lock')&&!exists('recovery-prepare.lock'));assertPredecessor(config,copyReceiptSha256);await verifyStagedMetadata();}else {assert(exists('mutation.lock'),'No operation mutation fence');const owner=read('mutation.lock/owner.json');assert.equal(owner.pid,process.pid);assert.equal(owner.operationId,config.operationId);assert.equal(owner.recoveryId||null,recoveryId);await assertPaused();}}});
 async function verifyCopies(state){
  const result=assertPublicationProof(await publication.verifyRecoverableCopy(copyOptions),state);
  // Staged copies are retained. The publication verifier accounts for the
  // copied inode's changed ctime/link count using its sealed link intents.
  // A complete set of links without the final receipts can still be safe for
  // the unchanged source graph; only publishSamples may adopt those receipts.
  if(state!=='before')await publication.verifyPublished(copyOptions);
  return result;
 }
 async function predecessorDatabaseBefore(){
  assertPredecessor(config,copyReceiptSha256);
  const restored=JSON.parse(readAt(PREDECESSOR,config.predecessor.restoredFile)),oldRuntime=readAt(PREDECESSOR,'runtime-seal.json'),oldPrepared=readAt(PREDECESSOR,'db-evidence/prepared-plan.json');
  assert.equal(sha(oldPrepared),restored.preparedPlanSha256);assert.equal(JSON.parse(oldRuntime).files['exec/database.cjs'],sha(readBytes('exec/database.cjs')),'Predecessor database implementation changed');
  const observer=require('./exec/database.cjs').createExecutor({db,ObjectId,bson,workDir:path.join(PREDECESSOR,'db-evidence'),scope,reviewPlan,actor:'deeks',toolVersion:'gulnara-executor:'+sha(oldRuntime),operationId:config.operationId,reviewedPlanSha256:config.planSha256,expectedCopyReceiptSha256:copyReceiptSha256,validateWindow:async()=>{throw new Error('Read-only predecessor observer cannot mutate');}});
  const state=await observer.recoverState({expectedPlanSha256:restored.preparedPlanSha256});assertRecoveryState(state,'resume');assert.equal(state.state,'before');assert.equal(state.activeLock,false);assert.equal(state.snapshotSha256,restored.consistency.snapshotSha256);return state;
 }
 async function prepareRecovery(ready,arg){
  const action=flags['--action'];assert(['resume','rollback'].includes(action));
  if(action==='resume')assert(!exists('db-evidence/rollback-plan.json'),'Rollback was already requested; prepare inspected rollback recovery');
  const previousRecoveryId=flags['--previous-recovery-id']||null;assert(!previousRecoveryId||validId(previousRecoveryId));
  if(exists('active-recovery.json')){assert(previousRecoveryId,'Explicit previous recovery identity is required');getRecovery(previousRecoveryId);}
  else assert.equal(previousRecoveryId,null,'Unexpected previous recovery identity');
  assert(!exists('recovery-prepare.lock'),'A previous recovery preparation requires inspection');
  await assertStoppedWork();assertNoOtherPackProcesses();
  const oldPrefix=previousRecoveryId?'recovery/'+previousRecoveryId+'/window/':'window/',prior=read(oldPrefix+'paused.json');
  for(const k of ['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'])assert.equal(prior[k],ready[k]);
  assert(validId(prior.runId));assertPidExited(prior.controllerPid);
  const specifications=[['mutation.lock','--mutation-lock-sha256'],['db-evidence/active.lock','--db-lock-sha256'],['window-reopen.lock','--reopen-lock-sha256']];
  const locks=specifications.map(([name,flag])=>inspectStaleLock(pack,name,flags[flag],config.operationId));
  const mutation=locks[0],databaseLock=locks[1],reopen=locks[2];
  if(mutation){assert.equal(mutation.owner.recoveryId||null,previousRecoveryId);assert(['apply','resume','rollback'].includes(mutation.owner.command));}
  if(reopen)assert.equal(reopen.pid,prior.controllerPid,'Reopen lock does not belong to prior window');
  let previousMutatorPid=mutation?.pid??databaseLock?.pid??null;
  if(databaseLock&&previousMutatorPid)assert.equal(databaseLock.pid,previousMutatorPid);
  if(previousMutatorPid===null){
   const candidates=fs.readdirSync(pack).filter(n=>/^(?:frozen-before|completed-)[A-Za-z0-9_-]*\.json$/.test(n)).map(n=>read(n)).filter(r=>r.runId===prior.runId&&r.operationId===config.operationId&&Number.isInteger(r.mutatorPid));
   const pids=[...new Set(candidates.map(r=>r.mutatorPid))];assert(pids.length<=1,'Ambiguous previous mutator');previousMutatorPid=pids[0]??null;
  }
  assertPidExited(previousMutatorPid);
  const baseline=await executor.recoverState(arg);assertRecoveryState(baseline,action);if(baseline.state!=='before')assert(previousMutatorPid,'Changed graph has no inspected prior mutator PID');
  const baselineJournalSha256=journalSha(),physical=await verifyCopies(baseline.state);
  const id='recovery-'+new Date().toISOString().replace(/[^0-9]/g,'')+'-'+crypto.randomUUID(),prefix='recovery/'+id+'/',previous=prefix+'previous/';
  fs.mkdirSync(path.join(pack,'recovery-prepare.lock'),{mode:0o750});save('recovery-prepare.lock/owner.json',{at:new Date().toISOString(),pid:process.pid,operationId:config.operationId,recoveryId:id});
  // The fresh fence survives any failure. Never automatically clear a failed
  // preparation or overwrite a prior approval.
  let successful=false;
  try{
   assertNoOtherPackProcesses();await assertStoppedWork();assertPidExited(prior.controllerPid);assertPidExited(previousMutatorPid);
   for(const[name,flag]of specifications)inspectStaleLock(pack,name,flags[flag],config.operationId);
   fs.mkdirSync(path.join(pack,'recovery'),{mode:0o750,recursive:true});assert(!fs.lstatSync(path.join(pack,'recovery')).isSymbolicLink());
   fs.mkdirSync(path.join(pack,prefix),{mode:0o750});fs.mkdirSync(path.join(pack,previous),{mode:0o750});
   const preservedFiles={};
   function preserve(source,target){
    const bytes=readBytes(source),destination=previous+target;fs.mkdirSync(path.dirname(path.join(pack,destination)),{recursive:true,mode:0o750});
    const fd=fs.openSync(path.join(pack,destination),'wx',0o640);try{fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}preservedFiles[destination]=sha(bytes);
   }
   preserve('execution-ready.json','execution-ready.json');
   for(const n of fs.readdirSync(path.join(pack,oldPrefix)).sort()){assert(/^[a-z-]+\.json$/.test(n),'Unexpected prior window file');preserve(oldPrefix+n,'window/'+n);}
   for(const n of ['prepared-plan.json','execution.json','rollback-plan.json','journal.jsonl'])if(exists('db-evidence/'+n))preserve('db-evidence/'+n,'db-evidence/'+n);
   for(const lock of locks.filter(Boolean))preserve(lock.filename,'lock-copies/'+lock.name.replaceAll('/','-')+'.json');
   if(previousRecoveryId)preserve('active-recovery.json','active-recovery.json');
   save(previous+'assessment.json',{at:new Date().toISOString(),operationId:config.operationId,priorRunId:prior.runId,database:baseline,physical,baselineJournalSha256});
   preservedFiles[previous+'assessment.json']=sha(readBytes(previous+'assessment.json'));
   // Rename only the exact locks just inspected, preserving the original
   // directory modes and bytes as well as readable copies for tsldata.
   const movedLocks=[];
   for(const lock of locks.filter(Boolean)){
    const flag=specifications.find(([n])=>n===lock.name)[1];inspectStaleLock(pack,lock.name,flags[flag],config.operationId);
    const destination=previous+'stale-'+lock.name.replaceAll('/','-');assert(!exists(destination));fs.renameSync(path.join(pack,lock.name),path.join(pack,destination));movedLocks.push({from:lock.name,to:destination,ownerSha256:lock.sha256,pid:lock.pid});
   }
   const current=await executor.recoverState(arg);assertRecoveryState(current,action);assert.equal(current.activeLock,false);assert.equal(current.snapshotSha256,baseline.snapshotSha256);assert.deepEqual(current.counts,baseline.counts);assert.equal(journalSha(),baselineJournalSha256);await verifyCopies(current.state);await assertStoppedWork();
   save(previous+'preserved-locks.json',{at:new Date().toISOString(),operationId:config.operationId,movedLocks});preservedFiles[previous+'preserved-locks.json']=sha(readBytes(previous+'preserved-locks.json'));
   const preparedAt=new Date().toISOString(),approval={version:1,kind:'gulnara-recovery-window-approval',recoveryId:id,recoveryAction:action,operationId:config.operationId,planSha256:config.planSha256,preparedPlanSha256:ready.preparedPlanSha256,copyReceiptSha256,readySha256:sha(readBytes('execution-ready.json')),preparedAt,expiresAt:new Date(Date.parse(preparedAt)+3600000).toISOString(),previousRunId:prior.runId,previousControllerPid:prior.controllerPid,previousMutatorPid,allowedInitialState:current.state,allowedInitialCounts:current.counts,baselineSnapshotSha256:current.snapshotSha256,baselineJournalSha256,preservedFiles};
   require('./exec/window-r3.cjs').validateRecovery(approval,ready,approval.readySha256,Date.now());save(prefix+'recovery-ready.json',approval);
   if(previousRecoveryId){const destination=previous+'superseded-active-recovery.json';assert(!exists(destination));fs.renameSync(path.join(pack,'active-recovery.json'),path.join(pack,destination));}
   const recoveryReadySha256=sha(readBytes(prefix+'recovery-ready.json'));save('active-recovery.json',{operationId:config.operationId,recoveryId:id,recoveryAction:action,recoveryReadySha256,preparedAt});
   successful=true;return {recoveryId:id,recoveryAction:action,recoveryReadySha256,readySha256:approval.readySha256,state:current.state,counts:current.counts,approvalFile:prefix+'recovery-ready.json',databaseWrites:0};
  }finally{if(successful){fs.unlinkSync(path.join(pack,'recovery-prepare.lock/owner.json'));fs.rmdirSync(path.join(pack,'recovery-prepare.lock'));}}
 }
 try{
  if(command==='prepare-db'){
   const prior=await predecessorDatabaseBefore(),r=await executor.prepare(),current=await executor.recoverState({expectedPlanSha256:r.preparedPlanSha256}),priorAfter=await predecessorDatabaseBefore();
   assertRecoveryState(current,'resume');assert.equal(current.state,'before');assert.equal(current.activeLock,false);assert.equal(current.snapshotSha256,prior.snapshotSha256);assert.equal(current.snapshotSha256,priorAfter.snapshotSha256);
   save('db-prepared.json',{...r,at:new Date().toISOString(),operationId:config.operationId,reviewedPlanSha256:config.planSha256,copyReceiptSha256,runtimeSealSha256:runtimeSha,predecessor:config.predecessor,predecessorSnapshotSha256:prior.snapshotSha256});console.log(json(r));return;
  }
  const ready=getReady(),arg={expectedPlanSha256:ready.preparedPlanSha256};
  if(command==='recover-prepare'){console.log(json(await prepareRecovery(ready,arg)));return;}
  if(command==='safe-to-reopen'){
   assert(validId(flags['--run-id']));assert.equal(flags['--plan-sha256'],config.planSha256);
   if(recoveryId)getRecovery();else assert(!exists('active-recovery.json'),'Use the active recovery identity for this probe');
   const result=await executor.recoverState(arg),physical=await verifyCopies(result.state),copiesConsistent=physical.copiesConsistent;
   const mutationInProgress=exists('mutation.lock')||result.activeLock||exists('recovery-prepare.lock');
   console.log(json({operationId:config.operationId,runId:flags['--run-id'],recoveryId,planSha256:config.planSha256,preparedPlanSha256:ready.preparedPlanSha256,copyReceiptSha256,state:result.state,counts:result.counts,differences:result.differences,snapshotSha256:result.snapshotSha256,journalSha256:journalSha(),physical,
     mutationInProgress,safeToReopen:result.safeToReopen&&copiesConsistent&&!mutationInProgress,copiesConsistent}));return;
  }
  if(command==='verify'){const r=await executor.verify(arg),files=await publication.verifyPublished(copyOptions);console.log(json({database:r,files}));return;}
  const recovery=recoveryId?getRecovery():null;if(recovery)assert.equal(command==='resume'?'resume':command,recovery.recoveryAction);
  await assertPaused();assert(!exists('mutation.lock')&&!exists('window-reopen.lock')&&!exists('recovery-prepare.lock'));fs.mkdirSync(path.join(pack,'mutation.lock'),{mode:0o750});
  const attemptId=crypto.randomUUID();save('mutation.lock/owner.json',{at:new Date().toISOString(),pid:process.pid,operationId:config.operationId,command,recoveryId,attemptId});
  let successful=false;
  try{
   assert(!exists('window-reopen.lock'),'Reopen started while acquiring mutation fence');const paused=await assertPaused();
   let result;const state=await executor.recoverState(arg);
   if(recovery){assertRecoveryState(state,recovery.recoveryAction);assert.equal(state.activeLock,false);assert.equal(state.state,recovery.allowedInitialState);assert.deepEqual(state.counts,recovery.allowedInitialCounts);assert.equal(state.snapshotSha256,recovery.baselineSnapshotSha256);assert.equal(journalSha(),recovery.baselineJournalSha256);await verifyCopies(state.state);}
   if(command==='apply'){assert.equal(state.state,'before','Initial apply requires unchanged prepared baseline');assert.equal(state.safeToReopen,true);await verifyStagedMetadata();}
   save('frozen-before-'+paused.runId+'-'+attemptId+'.json',{at:new Date().toISOString(),...state,operationId:config.operationId,runId:paused.runId,recoveryId,attemptId,mutatorPid:process.pid,journalSha256:journalSha()});
   if(command==='apply'||command==='resume'){
    await publication.publishSamples(copyOptions);await publication.verifyPublished(copyOptions);
    result=await executor.apply(arg);await executor.verify(arg);
   }else{result=await executor.rollback(arg);assert(['before','reversed'].includes(result.state));}
   const physical=await verifyCopies(result.state);await assertPaused();
   save('completed-'+command+'-'+paused.runId+'-'+attemptId+'.json',{at:new Date().toISOString(),operationId:config.operationId,runId:paused.runId,recoveryId,attemptId,mutatorPid:process.pid,planSha256:config.planSha256,database:result,physical});
   successful=true;
  }finally{if(successful){fs.unlinkSync(path.join(pack,'mutation.lock/owner.json'));fs.rmdirSync(path.join(pack,'mutation.lock'));}}
  const p=read(windowPrefix()+'paused.json'),state=await executor.recoverState(arg);assert.equal(state.safeToReopen,true);
  save(recoveryId?'recovery/'+recoveryId+'/window-complete.json':'window-complete.json',{at:new Date().toISOString(),operationId:config.operationId,runId:p.runId,recoveryId,attemptId,mutatorPid:process.pid,planSha256:config.planSha256,preparedPlanSha256:ready.preparedPlanSha256,state:state.state});
  console.log(json({operationId:config.operationId,recoveryId,state:state.state,completed:true}));
 }finally{await client.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={assertNoAppProcesses,readBytes,parseFlags,assertPidExited,validateJournal,assertRecoveryState,inspectStaleLock,assertPredecessor,assertPublicationProof};
