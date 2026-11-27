'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateReady,validateRecovery,assertServiceSnapshot,assertReopenProbe,assertRecoveryProbe,assertPidExited,parseArguments,runWindow,readRegular}=require('./window-r3.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

const digest='1'.repeat(64),prepared='2'.repeat(64),copied='3'.repeat(64);
const ready=()=>({version:1,operationId:'gulnara-test-operation',planSha256:digest,
  preparedPlanSha256:prepared,copyReceiptSha256:copied,apiHead:'a'.repeat(40),webHead:'b'.repeat(40),
  preparedPlanFile:'db/prepared.json',copyReceiptFile:'copy-verified.json',runnerFile:'runner-r3.cjs',controllerFile:'exec/window-r3.cjs',windowMinutes:5,
  files:{'db/prepared.json':prepared,'copy-verified.json':copied,'runner-r3.cjs':'4'.repeat(64),'exec/window-r3.cjs':'5'.repeat(64),'exec/listener-probe.cjs':'6'.repeat(64)}});
const names=['komondor-api','komondor-power','komondor-nudge','komondor-web'];
function fixture(overrides={}) {
  let time=0,probes=0,checks=0;
  const calls=[],files=new Map(),receipts=new Map(),messages=[];
  const services=names.map((name,i)=>({name,pm_id:i,pid:i+100,
    pm2_env:{status:'online',pm_cwd:'/storage/www/'+name,pm_exec_path:'/storage/www/'+name+(name==='komondor-api'?'/server.js':'/app.js')}}));
  const r=ready();
  const probe=(runId,state)=>({operationId:r.operationId,runId,planSha256:r.planSha256,preparedPlanSha256:r.preparedPlanSha256,
    copyReceiptSha256:r.copyReceiptSha256,safeToReopen:true,mutationInProgress:false,state});
  const deps={
    now:()=>time,uuid:()=> 'window-test-run',controllerPid:12345,interrupted:()=>false,say:s=>messages.push(s),
    wait:async ms=>{time+=ms;},exists:name=>files.has(name),read:async name=>files.get(name),
    verifySeal:async()=>{calls.push('verifySeal');},checkRelease:async()=>{checks++;calls.push('checkRelease');},checkPm2:async()=>{},
    probe:async runId=>{probes++;calls.push('probe');return probe(runId,probes===1?'before':(overrides.finalState||'applied'));},
    snapshot:async()=>services,apiReady:async()=>true,apiStopped:async()=>true,
    noApiWork:async()=>({ingest:0,runs:0}),noPowerWork:async()=>({entries:0,tracking:0}),
    createEvidence:async()=>{calls.push('createEvidence');},
    write:async(name,value)=>{
      assert(!receipts.has(name),'Receipt overwrite: '+name);receipts.set(name,value);
      if(name==='paused.json'&&overrides.complete!==false)files.set(value.recoveryId?'recovery/'+value.recoveryId+'/window-complete.json':'window-complete.json',
        {runId:value.runId,operationId:r.operationId,planSha256:r.planSha256,...(value.recoveryId?{recoveryId:value.recoveryId}:{})});
      if(name==='paused.json'&&overrides.onPaused)overrides.onPaused({files,receipts,services,calls});
    },
    stop:async name=>{calls.push('stop:'+name);const p=services.find(p=>p.name===name);p.pid=0;p.pm2_env.status='stopped';},
    restart:async name=>{calls.push('restart:'+name);const p=services.find(p=>p.name===name);p.pid=500;p.pm2_env.status='online';},
    acquireReopenLock:async value=>{assert(!files.has('window-reopen.lock'),'Existing reopen lock');files.set('window-reopen.lock',value);calls.push('lock');},
    releaseReopenLock:async runId=>{assert.equal(files.get('window-reopen.lock').runId,runId);files.delete('window-reopen.lock');calls.push('unlock');},
    ...overrides.deps,
  };
  return {r,deps,calls,files,receipts,messages,services,probe,checks:()=>checks,probes:()=>probes};
}

test('ready manifest requires safe paths, exact hashes and reviewed verifier/controller',()=>{
  validateReady(ready());
  const traversal=ready();traversal.files['../foreign']='0'.repeat(64);assert.throws(()=>validateReady(traversal),/Unsafe sealed/);
  const wrong=ready();wrong.files['copy-verified.json']='f'.repeat(64);assert.throws(()=>validateReady(wrong),/Copy receipt missing/);
  const missing=ready();delete missing.files['runner-r3.cjs'];assert.throws(()=>validateReady(missing),/verifier missing/);
});
test('service snapshot refuses unexpected duplicate API instances and wrong cwd',()=>{
  const f=fixture();assert.equal(assertServiceSnapshot(f.services,'online').length,4);
  assert.throws(()=>assertServiceSnapshot([...f.services,f.services[0]],'online'),/API instance/);
  f.services[1].pm2_env.pm_cwd='/wrong';assert.throws(()=>assertServiceSnapshot(f.services,'online'),/directory/);
});
test('independent probe must bind all identities and admit only consistent terminal states',()=>{
  const f=fixture(),p=f.probe('run','applied');assertReopenProbe(p,f.r,'run');
  for(const patch of [{state:'partial'},{safeToReopen:false},{mutationInProgress:true},{runId:'foreign'},{copyReceiptSha256:'a'.repeat(64)}])
    assert.throws(()=>assertReopenProbe({...p,...patch},f.r,'run'));
});
test('active global ingest stops before service changes',async()=>{
  const f=fixture({deps:{noApiWork:async()=>{throw Error('Unfinished API work');}}});
  const result=await runWindow(f.r,f.deps);
  assert.match(result.initialError,/Unfinished/);assert.equal(result.paused,false);
  assert(!f.calls.some(c=>c.startsWith('stop:')||c.startsWith('restart:')));
});
test('active Power work stops before service changes',async()=>{
  const f=fixture({deps:{noPowerWork:async()=>{throw Error('Unfinished Power work');}}});
  const result=await runWindow(f.r,f.deps);assert.match(result.initialError,/Power/);
  assert(!f.calls.some(c=>c.startsWith('stop:')));
});
test('verified complete graph restarts API first and records whitelisted receipts',async()=>{
  const f=fixture(),result=await runWindow(f.r,f.deps);
  assert.equal(result.restored,true);assert.equal(result.state,'applied');
  assert.deepEqual(f.calls.filter(c=>c.startsWith('stop:')),['stop:komondor-nudge','stop:komondor-power','stop:komondor-web','stop:komondor-api']);
  assert.deepEqual(f.calls.filter(c=>c.startsWith('restart:')),['restart:komondor-api','restart:komondor-web','restart:komondor-power','restart:komondor-nudge']);
  assert.equal(f.receipts.get('paused.json').preparedPlanSha256,prepared);
  assert.equal(f.receipts.get('paused.json').controllerPid,12345);
  assert.equal(f.receipts.get('restored.json').services.length,4);
  assert(!JSON.stringify([...f.receipts.values()]).includes('pm2_env'));
  assert(!f.files.has('window-reopen.lock'));
});

const readyHash='6'.repeat(64),recoveryHash='7'.repeat(64);
function recoveryApproval(r=ready()) {
  const recoveryId='recovery-test-20261126';
  return {version:1,kind:'gulnara-recovery-window-approval',recoveryId,recoveryAction:'resume',operationId:r.operationId,
    planSha256:r.planSha256,preparedPlanSha256:r.preparedPlanSha256,copyReceiptSha256:r.copyReceiptSha256,readySha256:readyHash,
    previousRunId:'previous-window-run',previousControllerPid:1234,previousMutatorPid:2345,
    allowedInitialState:'partial',allowedInitialCounts:{before:60,applied:4,reversed:0,diverged:0},
    baselineSnapshotSha256:'8'.repeat(64),baselineJournalSha256:'9'.repeat(64),
    preservedFiles:{['recovery/'+recoveryId+'/previous/execution-ready.json']:readyHash,
      ['recovery/'+recoveryId+'/previous/window/paused.json']:'a'.repeat(64)},
    preparedAt:new Date(0).toISOString(),expiresAt:new Date(3600000).toISOString()};
}
function recoveryFixture(overrides={}) {
  const f=fixture(overrides),approval=recoveryApproval(f.r);
  for(const p of f.services){p.pid=0;p.pm2_env.status='stopped';}
  f.deps.verifyRecovery=async()=>{f.calls.push('verifyRecovery');};
  f.deps.recoveryReadySha256=recoveryHash;
  let probes=0;
  f.recoveryProbe=(runId,state=approval.allowedInitialState)=>({...f.probe(runId,state),recoveryId:approval.recoveryId,
    safeToReopen:state!=='partial',counts:approval.allowedInitialCounts,differences:[],copiesConsistent:true,
    snapshotSha256:approval.baselineSnapshotSha256,journalSha256:approval.baselineJournalSha256});
  f.deps.probe=async runId=>{probes++;f.calls.push('probe');return f.recoveryProbe(runId,probes===1?approval.allowedInitialState:(overrides.finalState||'applied'));};
  return {...f,approval};
}

test('recovery approval is specific, fresh and preserves the prior review',()=>{
  const r=ready(),a=recoveryApproval(r);validateRecovery(a,r,readyHash,0);
  for(const patch of [{kind:'other'},{operationId:'other'},{readySha256:digest},{allowedInitialState:'diverged'},
    {previousControllerPid:0},{previousMutatorPid:null},{baselineJournalSha256:'bad'},{expiresAt:new Date(0).toISOString()},
    {expiresAt:new Date(3600001).toISOString()},{preparedAt:new Date(1).toISOString()},
    {preservedFiles:{}},{allowedInitialCounts:{before:59,applied:4,reversed:0,diverged:0}}])
    assert.throws(()=>validateRecovery({...a,...patch},r,readyHash,0));
});
test('explicit rollback admission recognizes interrupted reversals but forward resume refuses them',()=>{
  const r=ready(),a=recoveryApproval(r);a.recoveryAction='rollback';a.allowedInitialCounts={before:58,applied:4,reversed:2,diverged:0};
  validateRecovery(a,r,readyHash,0);
  assert.throws(()=>validateRecovery({...a,recoveryAction:'resume'},r,readyHash,0),/cannot include reversals/);
  a.allowedInitialState='reversed';a.allowedInitialCounts={before:58,applied:0,reversed:6,diverged:0};
  validateRecovery(a,r,readyHash,0);
});
test('only ESRCH proves the old process has exited',()=>{
  assertPidExited(null,()=>{throw Error('must not call');});
  assertPidExited(1234,()=>{const e=Error();e.code='ESRCH';throw e;});
  assert.throws(()=>assertPidExited(1234,()=>{}),/still running/);
  assert.throws(()=>assertPidExited(1234,()=>{const e=Error('permission');e.code='EPERM';throw e;}),/permission/);
});
test('recovery probe must match the exact approved graph, journal and copy evidence',()=>{
  const f=recoveryFixture(),p=f.recoveryProbe('run');assertRecoveryProbe(p,f.r,'run',f.approval);
  for(const patch of [{recoveryId:'foreign'},{state:'before'},{counts:{before:59,applied:5,reversed:0,diverged:0}},
    {differences:[{kind:'changed'}]},{snapshotSha256:digest},{journalSha256:digest},
    {copiesConsistent:false},{mutationInProgress:true},{safeToReopen:true}])
    assert.throws(()=>assertRecoveryProbe({...p,...patch},f.r,'run',f.approval));
});
test('recovery admits stopped partial state under a new lease and reopens only after full verification',async()=>{
  const f=recoveryFixture();f.files.set('window-complete.json',{runId:'old'});
  const result=await runWindow(f.r,f.deps,f.approval);
  assert.equal(result.paused,true);assert.equal(result.restored,true);
  assert(!f.calls.some(c=>c.startsWith('stop:')));
  assert.deepEqual(f.calls.filter(c=>c.startsWith('restart:')),['restart:komondor-api','restart:komondor-web','restart:komondor-power','restart:komondor-nudge']);
  const paused=f.receipts.get('paused.json');
  assert.equal(paused.recoveryId,f.approval.recoveryId);assert.equal(paused.previousRunId,f.approval.previousRunId);
  assert.equal(paused.controllerPid,12345);assert.equal(paused.recoveryReadySha256,recoveryHash);
  assert.equal(f.files.get('window-complete.json').runId,'old');
});
test('a recovery lease never reopens a still-partial graph at its deadline',async()=>{
  const f=recoveryFixture({complete:false,finalState:'partial'}),result=await runWindow(f.r,f.deps,f.approval);
  assert.equal(result.paused,true);assert.equal(result.restored,false);assert(result.restoreError);
  assert(!f.calls.some(c=>c.startsWith('restart:')));assert(f.files.has('window-reopen.lock'));
});
test('recovery refuses live services, stale locks, active old processes or changed graph without service commands',async()=>{
  const changes=[f=>{f.services[0].pid=100;f.services[0].pm2_env.status='online';},
    ...['mutation.lock','window-reopen.lock','db-evidence/active.lock','recovery-prepare.lock'].map(lock=>f=>f.files.set(lock,{})),
    f=>{f.deps.verifyRecovery=async()=>{throw Error('Old PID alive');};},
    f=>{f.deps.probe=async run=>({...f.recoveryProbe(run),snapshotSha256:digest});},
    f=>{f.deps.apiStopped=async()=>false;},
    f=>{f.deps.noApiWork=async()=>{throw Error('Unfinished API work');};},
    f=>{f.files.set('recovery/'+f.approval.recoveryId+'/window-complete.json',{});}];
  for(const change of changes){const f=recoveryFixture();change(f);const result=await runWindow(f.r,f.deps,f.approval);
    assert.equal(result.paused,false);assert(result.initialError);assert(!f.calls.some(c=>c.startsWith('stop:')||c.startsWith('restart:')));}
});
test('final recovery probe remains bound to the recovery identity and physical copies',async()=>{
  for(const patch of [{recoveryId:'foreign'},{copiesConsistent:false}]){
    const f=recoveryFixture(),original=f.deps.probe;let n=0;
    f.deps.probe=async run=>{const p=await original(run);return ++n>1?{...p,...patch}:p;};
    const result=await runWindow(f.r,f.deps,f.approval);assert(result.restoreError);
    assert(!f.calls.some(c=>c.startsWith('restart:')));
  }
});
test('recovery CLI requires both explicit recovery identity and approval hash',()=>{
  const normal=['--execute','--external-writers-and-api-callers-frozen','--ready-sha256',readyHash];
  assert.equal(parseArguments(normal).recoveryId,null);
  assert.equal(parseArguments([...normal,'--recovery-id','recovery-test','--recovery-ready-sha256',recoveryHash]).recoveryId,'recovery-test');
  for(const extra of [['--recovery-id','recovery-test'],['--recovery-id','../outside','--recovery-ready-sha256',recoveryHash],
    ['--recovery-id','recovery-test','--recovery-ready-sha256','bad']])assert.throws(()=>parseArguments([...normal,...extra]));
});
test('deadline can reopen unchanged baseline but is never itself permission',async()=>{
  const f=fixture({complete:false,finalState:'before'}),result=await runWindow(f.r,f.deps);
  assert.equal(result.restored,true);assert.equal(result.state,'before');assert.equal(f.probes(),2);
  assert.equal(f.receipts.get('restart-reason.json').reason,'deadline');
});
test('deadline with mutation lock leaves all stopped and retains reopen fence',async()=>{
  const f=fixture({complete:false,onPaused:({files})=>files.set('mutation.lock',{})}),result=await runWindow(f.r,f.deps);
  assert.match(result.restoreError,/Mutation lock remains/);assert.equal(result.restored,false);
  assert.equal(f.calls.filter(c=>c.startsWith('restart:')).length,0);assert(f.files.has('window-reopen.lock'));
  assert.equal(f.receipts.get('restore-failed.json').reopenLockRetained,true);
});
test('unknown partial graph refuses restart even with valid completion request',async()=>{
  const f=fixture({finalState:'partial'}),result=await runWindow(f.r,f.deps);
  assert.match(result.restoreError,/not consistently/);assert(!f.calls.some(c=>c.startsWith('restart:')));
});
test('reversed consistent graph is allowed to reopen',async()=>{
  const f=fixture({finalState:'reversed'}),result=await runWindow(f.r,f.deps);
  assert.equal(result.restored,true);assert.equal(result.state,'reversed');
});
test('signal requests independent safety check rather than unconditional restart',async()=>{
  const f=fixture({complete:false,finalState:'partial',deps:{interrupted:()=>true}}),result=await runWindow(f.r,f.deps);
  assert.equal(f.receipts.get('restart-reason.json').reason,'signal');assert(result.restoreError);
  assert(!f.calls.some(c=>c.startsWith('restart:')));
});
test('release or seal changes during pause prevent restart',async()=>{
  for(const method of ['verifySeal','checkRelease']){
    const f=fixture();let count=0;f.deps[method]=async()=>{if(++count>1)throw Error('Changed reviewed inputs');};
    const result=await runWindow(f.r,f.deps);assert.match(result.restoreError,/Changed reviewed inputs/);
    assert(!f.calls.some(c=>c.startsWith('restart:')));
  }
});
test('partially failed service stop restores only touched services after baseline check',async()=>{
  const f=fixture({finalState:'before'}),original=f.deps.stop;
  f.deps.stop=async name=>{await original(name);if(name==='komondor-power')throw Error('stop command failed');};
  const result=await runWindow(f.r,f.deps);assert.match(result.initialError,/stop command failed/);assert.equal(result.restored,true);
  assert.deepEqual(f.calls.filter(c=>c.startsWith('restart:')),['restart:komondor-power','restart:komondor-nudge']);
});
test('API health failure after safe probe keeps dependent services stopped',async()=>{
  const f=fixture();let readyCalls=0;f.deps.apiReady=async()=>++readyCalls===1;
  const result=await runWindow(f.r,f.deps);assert.match(result.restoreError,/API readiness/);
  assert.deepEqual(f.calls.filter(c=>c.startsWith('restart:')),['restart:komondor-api']);
  assert(f.files.has('window-reopen.lock'));
});
test('a mutation attempting to appear after independent probe still fences restart',async()=>{
  const f=fixture(),original=f.deps.probe;
  f.deps.probe=async runId=>{const p=await original(runId);if(f.probes()>1)f.files.set('mutation.lock',{});return p;};
  const result=await runWindow(f.r,f.deps);assert.match(result.restoreError,/Mutation began/);
  assert(!f.calls.some(c=>c.startsWith('restart:')));
});
test('recovery preparation fences normal admission and restart',async()=>{
  const before=fixture();before.files.set('recovery-prepare.lock',{});
  const stopped=await runWindow(before.r,before.deps);assert(stopped.initialError);assert(!before.calls.some(c=>c.startsWith('stop:')));
  const during=fixture({onPaused:({files})=>files.set('recovery-prepare.lock',{})});
  const result=await runWindow(during.r,during.deps);assert.match(result.restoreError,/Recovery preparation/);
  assert(!during.calls.some(c=>c.startsWith('restart:')));
});
test('sealed files reject symlink components and out-of-root paths',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gulnara-window-'));
  try{
    fs.writeFileSync(path.join(root,'valid'),'{}');assert.equal(readRegular(path.join(root,'valid'),root).toString(),'{}');
    fs.symlinkSync(path.join(root,'valid'),path.join(root,'link'));assert.throws(()=>readRegular(path.join(root,'link'),root),/Symlink/);
    assert.throws(()=>readRegular(path.join(root,'..','other'),root),/Unsafe/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
