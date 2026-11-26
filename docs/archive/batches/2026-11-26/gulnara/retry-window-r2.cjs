'use strict';
// Only tsldata may archive its restored first-attempt directory. This launcher
// changes no service or database itself; the sealed r2 controller owns the window.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),assert=require('node:assert/strict');
const {validateReady,parseArguments,readRegular,assertPidExited}=require('./exec/window.cjs');
const PACK='/storage/komondor-gulnara-20261126';
const HISTORY='retry-history/attempt-01',NAMES=['before.json','failed.json','restored.json'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const identityKeys=['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'];
function assertBefore(probe,ready){
  for(const key of identityKeys)assert.equal(probe[key],ready[key],'Prior proof identity differs: '+key);
  assert.equal(probe.state,'before');assert.deepEqual(probe.counts,{before:64,applied:0,reversed:0,diverged:0});
  assert.deepEqual(probe.differences,[]);assert.equal(probe.safeToReopen,true);assert.equal(probe.mutationInProgress,false);assert.equal(probe.copiesConsistent,true);
  assert.equal(probe.journalSha256,sha(Buffer.alloc(0)),'Unexpected prior mutation journal');
  const p=probe.physical;assert.equal(p.state,'staged');assert.equal(p.stagedFiles,40);assert.equal(p.publishedFiles,0);
  assert.equal(p.claimedRoots,0);assert.equal(p.privateRoots,0);assert.equal(p.files,40);assert.equal(p.bytes,41432635417);assert.equal(p.copiesConsistent,true);
}
function archivePriorWindow(ready,deps){
  validateReady(ready);assert.equal(ready.controllerFile,'exec/window-r2.cjs');assert.equal(ready.retryOf?.evidenceRoot,HISTORY);
  for(const n of ['retry-window-r2.cjs','exec/window-r2.cjs','exec/listener-probe.cjs',HISTORY+'/execution-ready.json',HISTORY+'/retry-precheck.json',...NAMES.map(n=>HISTORY+'/window/'+n)])
    assert(ready.files[n],'Missing sealed retry input: '+n);
  for(const[n,h]of Object.entries(ready.files))assert.equal(sha(deps.readBytes(n)),h,'Sealed retry input changed: '+n);
  const originalBytes=deps.readBytes(HISTORY+'/execution-ready.json'),original=validateReady(JSON.parse(originalBytes));
  assert.equal(sha(originalBytes),ready.retryOf.readySha256,'Original readiness differs');
  for(const key of [...identityKeys,'apiHead','webHead'])assert.equal(original[key],ready[key],'Retry changes reviewed identity/head: '+key);
  for(const[n,h]of Object.entries(original.files))assert.equal(ready.files[n],h,'Retry dropped or changed an original sealed input: '+n);
  for(const n of ['mutation.lock','window-reopen.lock','copy-worker.lock','recovery-prepare.lock','db-evidence/active.lock','active-recovery.json','window-complete.json','db-evidence/execution.json','db-evidence/journal.jsonl'])
    assert(!deps.exists(n),'Unexpected operation state: '+n);
  deps.assertDirectory('window');deps.assertDirectory(HISTORY);deps.assertDirectory(HISTORY+'/window');
  assert.deepEqual(deps.names('window').sort(),NAMES,'Unexpected original window contents');
  assert.deepEqual(deps.names(HISTORY+'/window').sort(),NAMES,'Unexpected preserved window contents');
  assert(!deps.exists(HISTORY+'/original-window'),'Original window archive destination already exists');
  const records={};
  for(const name of NAMES){
    const old=deps.readBytes('window/'+name),preserved=deps.readBytes(HISTORY+'/window/'+name);assert(old.equals(preserved),'Original receipt differs from sealed preserved copy: '+name);
    const r=records[name]=JSON.parse(old);for(const k of identityKeys)assert.equal(r[k],ready[k]);assert.equal(r.runId,ready.retryOf.runId);
  }
  const restored=records['restored.json'],before=records['before.json'],failed=records['failed.json'];
  assert(Number.isInteger(restored.controllerPid)&&restored.controllerPid>1);assert.equal(before.controllerPid,restored.controllerPid);assert.equal(failed.controllerPid,restored.controllerPid);
  assert.equal(failed.error,'API listener remains reachable after stopping','This launcher is only for the reviewed first-attempt probe failure');
  assert.equal(restored.apiReady,true);assert.equal(restored.graphState,'before');assert.equal(restored.consistency.runId,restored.runId);assertBefore(restored.consistency,ready);
  assert.deepEqual(restored.services.map(s=>s.name).sort(),['komondor-api','komondor-nudge','komondor-power','komondor-web']);
  assert(restored.services.every(s=>s.status==='online'&&Number.isInteger(s.pid)&&s.pid>1));
  const precheck=JSON.parse(deps.readBytes(HISTORY+'/retry-precheck.json'));
  assert.equal(precheck.kind,'safe-pre-pause-window-retry');assert.equal(precheck.operationId,ready.operationId);assert.equal(precheck.previousReadySha256,ready.retryOf.readySha256);
  assert.equal(precheck.previousRunId,restored.runId);assert.equal(precheck.previousControllerPid,restored.controllerPid);assert.equal(precheck.previousControllerExited,true);
  assert.equal(precheck.runtimeUnchanged,true);assert.equal(precheck.databaseWrites,0);assertBefore(precheck.probe,ready);assert.equal(precheck.probe.snapshotSha256,restored.consistency.snapshotSha256);
  deps.pidExited(restored.controllerPid);
  deps.rename('window',HISTORY+'/original-window');
  for(const name of NAMES)assert(deps.readBytes(HISTORY+'/original-window/'+name).equals(deps.readBytes(HISTORY+'/window/'+name)),'Archived original receipt changed');
  assert(!deps.exists('window'),'Original window remains after preservation');
  return {previousRunId:restored.runId,archivedTo:HISTORY+'/original-window'};
}
async function main(argv=process.argv.slice(2)){
  const parsed=parseArguments(argv);assert.equal(parsed.recoveryId,null,'This launcher is only for the restored first attempt');
  assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'tsldata');assert.equal(__dirname,PACK);
  const readBytes=n=>readRegular(path.join(PACK,n),PACK),readyBytes=readBytes('execution-ready.json');assert.equal(sha(readyBytes),parsed.expectedReadyDigest,'Retry readiness digest differs');
  const ready=validateReady(JSON.parse(readyBytes));
  assert.equal(ready.files['retry-window-r2.cjs'],sha(readBytes('retry-window-r2.cjs')),'Launcher is not sealed by readiness');
  const lock=path.join(PACK,'retry-window-r2.lock'),owner={pid:process.pid,operationId:ready.operationId,readySha256:parsed.expectedReadyDigest,at:new Date().toISOString()};
  const fd=fs.openSync(lock,'wx',0o640);try{fs.writeFileSync(fd,JSON.stringify(owner)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{
    const exists=n=>{try{fs.lstatSync(path.join(PACK,n));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
    const result=archivePriorWindow(ready,{readBytes,exists,names:n=>fs.readdirSync(path.join(PACK,n)),pidExited:assertPidExited,
      assertDirectory:n=>{const p=path.join(PACK,n),s=fs.lstatSync(p);assert(s.isDirectory()&&!s.isSymbolicLink());},rename:(a,b)=>fs.renameSync(path.join(PACK,a),path.join(PACK,b))});
    console.log('PRESERVED: '+JSON.stringify(result));
    // Keep r2's existing signal and restoration handling in the operator's
    // process, while retaining the exclusive launcher fence until it returns.
    return await require('./exec/window-r2.cjs').main(argv);
  }finally{
    const current=JSON.parse(readBytes('retry-window-r2.lock'));assert.equal(current.pid,owner.pid);assert.equal(current.readySha256,owner.readySha256);fs.unlinkSync(lock);
  }
}
module.exports={assertBefore,archivePriorWindow,main};
if(require.main===module)main().catch(e=>{console.error('STOPPED SAFELY: '+e.message);process.exitCode=1;});
