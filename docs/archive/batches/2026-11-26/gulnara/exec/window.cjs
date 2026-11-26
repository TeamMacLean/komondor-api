'use strict';

// User-operated service control only. No datastore or MongoDB writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const os = require('node:os');

const PACK = '/storage/komondor-gulnara-20261126';
const NODE = '/storage/.nvm/versions/node/v24.11.1/bin/node';
const PM2 = '/storage/.nvm/versions/node/v24.11.1/lib/node_modules/pm2/bin/pm2';
const API = '/storage/www/komondor-api';
const WEB = '/storage/www/komondor-web';
const NAMES = ['komondor-api', 'komondor-power', 'komondor-nudge', 'komondor-web'];
const STOP_ORDER = ['komondor-nudge', 'komondor-power', 'komondor-web', 'komondor-api'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,100}$/.test(value);
const safeRelative = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value)
  && value.split('/').every(piece => piece && piece !== '.' && piece !== '..') && !value.includes('\\');

function validateReady(ready) {
  assert.equal(ready.version, 1, 'Unsupported execution-ready version');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,100}$/.test(ready.operationId || ''), 'Invalid operation identity');
  for (const key of ['planSha256', 'preparedPlanSha256', 'copyReceiptSha256']) assert(validDigest(ready[key]), 'Invalid ready ' + key);
  for (const key of ['apiHead', 'webHead']) assert(/^[a-f0-9]{40}$/.test(ready[key] || ''), 'Invalid ready ' + key);
  assert(ready.files && typeof ready.files === 'object' && !Array.isArray(ready.files), 'Missing sealed execution files');
  for (const [filename, digest] of Object.entries(ready.files)) assert(safeRelative(filename) && validDigest(digest), 'Unsafe sealed file entry');
  for (const key of ['preparedPlanFile', 'copyReceiptFile']) assert(safeRelative(ready[key]), 'Unsafe ' + key);
  assert.equal(ready.files[ready.preparedPlanFile], ready.preparedPlanSha256, 'Prepared plan missing from seal');
  assert.equal(ready.files[ready.copyReceiptFile], ready.copyReceiptSha256, 'Copy receipt missing from seal');
  const runner = ready.runnerFile || 'runner.cjs';
  assert(safeRelative(runner) && ready.files[runner], 'Reopen verifier missing from seal');
  assert(Object.keys(ready.files).some(p => p === 'window.cjs' || p === 'exec/window.cjs'), 'Controller missing from seal');
  if (ready.windowMinutes !== undefined) assert(Number.isInteger(ready.windowMinutes) && ready.windowMinutes >= 5 && ready.windowMinutes <= 20);
  return ready;
}

function assertServiceSnapshot(all, status) {
  assert(Array.isArray(all), 'Malformed PM2 process list');
  assert.equal(all.filter(p => p.pm2_env?.pm_exec_path === API + '/server.js').length, 1, 'Unexpected API instance count');
  const selected = NAMES.map(name => {
    const matches = all.filter(p => p.name === name);
    assert.equal(matches.length, 1, 'Missing or duplicated service: ' + name);
    const process = matches[0];
    assert.equal(process.pm2_env?.pm_cwd, '/storage/www/' + name, 'Unexpected service directory: ' + name);
    assert.equal(process.pm2_env?.status, status, 'Unexpected service status: ' + name);
    if (status === 'stopped') assert(!process.pid, 'Stopped service still has a PID: ' + name);
    if (status === 'online') assert(Number.isInteger(process.pid) && process.pid > 0, 'Online service lacks a PID: ' + name);
    return {name, id: process.pm_id, pid: process.pid, status: process.pm2_env.status};
  });
  return selected;
}

function assertProbeIdentity(probe, ready, runId) {
  assert(probe && typeof probe === 'object', 'Missing independent reopen result');
  assert.equal(probe.operationId, ready.operationId, 'Reopen operation differs');
  assert.equal(probe.runId, runId, 'Reopen run differs');
  assert.equal(probe.planSha256, ready.planSha256, 'Reopen plan differs');
  assert.equal(probe.preparedPlanSha256, ready.preparedPlanSha256, 'Reopen prepared plan differs');
  assert.equal(probe.copyReceiptSha256, ready.copyReceiptSha256, 'Reopen copy receipt differs');
}

function assertReopenProbe(probe, ready, runId, expectedState) {
  assertProbeIdentity(probe, ready, runId);
  assert.equal(probe.safeToReopen, true, 'Independent check refuses service restart');
  assert.equal(probe.mutationInProgress, false, 'Mutation is active or ambiguous');
  assert(['before', 'applied', 'reversed'].includes(probe.state), 'Database graph is not consistently before/applied/reversed');
  if (expectedState) assert.equal(probe.state, expectedState, 'Unexpected initial database state');
  return probe;
}

function validateRecovery(recovery, ready, expectedReadyDigest, now) {
  assert.equal(recovery.version, 1, 'Unsupported recovery approval version');
  assert.equal(recovery.kind, 'gulnara-recovery-window-approval', 'Unexpected recovery approval kind');
  assert(validId(recovery.recoveryId), 'Invalid recovery identity');
  for (const key of ['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'])
    assert.equal(recovery[key], ready[key], 'Recovery approval differs: ' + key);
  assert.equal(recovery.readySha256, expectedReadyDigest, 'Recovery readiness seal differs');
  assert(validId(recovery.previousRunId), 'Invalid previous window identity');
  assert(Number.isInteger(recovery.previousControllerPid) && recovery.previousControllerPid > 1, 'Missing previous controller PID');
  assert(recovery.previousMutatorPid === null || (Number.isInteger(recovery.previousMutatorPid) && recovery.previousMutatorPid > 1), 'Invalid previous mutator PID');
  assert(['resume','rollback'].includes(recovery.recoveryAction), 'Unreviewed recovery action');
  assert((recovery.recoveryAction === 'resume' ? ['before','partial','applied'] : ['before','partial','applied','reversed']).includes(recovery.allowedInitialState), 'Unreviewed recovery state');
  if (recovery.allowedInitialState !== 'before') assert(recovery.previousMutatorPid, 'Missing previous mutator for changed graph');
  const counts = recovery.allowedInitialCounts;
  assert(counts && typeof counts === 'object' && !Array.isArray(counts), 'Missing recovery counts');
  assert.deepEqual(Object.keys(counts).sort(), ['applied','before','diverged','reversed']);
  for (const n of Object.values(counts)) assert(Number.isInteger(n) && n >= 0, 'Invalid recovery count');
  assert.equal(counts.diverged, 0, 'Diverged recovery graph');
  if (recovery.recoveryAction === 'resume') assert.equal(counts.reversed, 0, 'Forward recovery cannot include reversals');
  assert.equal(counts.before + counts.applied + counts.reversed, 64, 'Incomplete recovery graph');
  if (recovery.allowedInitialState === 'before') assert.equal(counts.before, 64);
  if (recovery.allowedInitialState === 'applied') assert.equal(counts.applied, 64);
  if (recovery.allowedInitialState === 'reversed') assert(counts.applied === 0 && counts.reversed > 0);
  if (recovery.allowedInitialState === 'partial') assert(counts.applied > 0 && counts.applied < 64);
  for (const key of ['baselineSnapshotSha256','baselineJournalSha256']) assert(validDigest(recovery[key]), 'Missing recovery ' + key);
  const previous = 'recovery/' + recovery.recoveryId + '/previous/';
  assert(recovery.preservedFiles && typeof recovery.preservedFiles === 'object' && !Array.isArray(recovery.preservedFiles), 'Missing preserved recovery evidence');
  for (const [filename,digest] of Object.entries(recovery.preservedFiles))
    assert(safeRelative(filename) && filename.startsWith(previous) && validDigest(digest), 'Unsafe preserved recovery file');
  assert.equal(recovery.preservedFiles[previous + 'execution-ready.json'], expectedReadyDigest, 'Original readiness was not preserved');
  assert(validDigest(recovery.preservedFiles[previous + 'window/paused.json']), 'Original paused receipt was not preserved');
  const preparedAt = Date.parse(recovery.preparedAt), expiresAt = Date.parse(recovery.expiresAt);
  assert(Number.isFinite(preparedAt) && Number.isFinite(expiresAt) && preparedAt <= now && expiresAt > now
    && expiresAt > preparedAt && expiresAt - preparedAt <= 60 * 60 * 1000, 'Recovery approval is expired or invalid');
  return recovery;
}

function assertRecoveryProbe(probe, ready, runId, recovery) {
  assertProbeIdentity(probe, ready, runId);
  assert.equal(probe.recoveryId, recovery.recoveryId, 'Recovery probe identity differs');
  assert.equal(probe.state, recovery.allowedInitialState, 'Recovery graph state changed');
  assert.deepEqual(probe.counts, recovery.allowedInitialCounts, 'Recovery graph counts changed');
  assert.deepEqual(probe.differences, [], 'Recovery graph diverged');
  assert.equal(probe.snapshotSha256, recovery.baselineSnapshotSha256, 'Recovery graph snapshot changed');
  assert.equal(probe.journalSha256, recovery.baselineJournalSha256, 'Recovery journal changed');
  assert.equal(probe.copiesConsistent, true, 'Recovery copy paths are not independently verified');
  assert.equal(probe.mutationInProgress, false, 'Recovery mutation is active or ambiguous');
  assert.equal(probe.safeToReopen, recovery.allowedInitialState !== 'partial', 'Unexpected recovery safety assessment');
  return probe;
}

function assertPidExited(pid, kill = process.kill) {
  if (pid === null) return;
  assert(Number.isInteger(pid) && pid > 1, 'Invalid previous process PID');
  try { kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
  throw new Error('Previous controller or mutator is still running: ' + pid);
}

async function runWindow(ready, deps, recovery = null) {
  validateReady(ready);
  if (recovery) {
    validateRecovery(recovery,ready,recovery.readySha256,deps.now());
    assert(validDigest(deps.recoveryReadySha256), 'Missing pinned recovery approval digest');
  }
  const runId = deps.uuid(), touched = new Set();
  const completeFile = recovery ? 'recovery/' + recovery.recoveryId + '/window-complete.json' : 'window-complete.json';
  let created = false, paused = false, initialError = null, restoreError = null, finalProbe = null;
  const receipt = more => ({at: new Date(deps.now()).toISOString(), runId, controllerPid: deps.controllerPid || process.pid, operationId: ready.operationId,
    planSha256: ready.planSha256, preparedPlanSha256: ready.preparedPlanSha256,
    copyReceiptSha256: ready.copyReceiptSha256, ...(recovery ? {recoveryId: recovery.recoveryId, previousRunId: recovery.previousRunId,
      recoveryAction: recovery.recoveryAction, recoveryReadySha256: deps.recoveryReadySha256} : {}), ...more});
  try {
    await deps.verifySeal();
    await deps.checkRelease();
    await deps.checkPm2();
    assert(!deps.exists(completeFile), 'An old completion request exists');
    assert(!deps.exists('mutation.lock'), 'A mutation lock already exists');
    assert(!deps.exists('window-reopen.lock'), 'A reopen lock already exists');
    assert(!deps.exists('recovery-prepare.lock'), 'Recovery preparation is active or ambiguous');
    if (recovery) {
      assert(!deps.exists('db-evidence/active.lock'), 'A database mutation lock already exists');
      await deps.verifyRecovery();
      assertRecoveryProbe(await deps.probe(runId), ready, runId, recovery);
    } else assertReopenProbe(await deps.probe(runId), ready, runId, 'before');
    const services = assertServiceSnapshot(await deps.snapshot(), recovery ? 'stopped' : 'online');
    if (recovery) assert(await deps.apiStopped(), 'API listener is reachable during recovery admission');
    else assert(await deps.apiReady(), 'API is not ready before the window');
    const apiWork = await deps.noApiWork(), powerWork = await deps.noPowerWork();
    await deps.createEvidence(); created = true;
    await deps.write('before.json', receipt({apiWork, powerWork, services}));
    if (recovery) {
      // Explicitly inherit the existing outage only after the approved stopped
      // state, evidence and independent recovery checks have all succeeded.
      for (const name of NAMES) touched.add(name);
    } else {
      for (const name of STOP_ORDER) {
        if (name === 'komondor-api') { await deps.noApiWork(); await deps.noPowerWork(); }
        touched.add(name);
        await deps.stop(name);
      }
    }
    const stopped = assertServiceSnapshot(await deps.snapshot(), 'stopped');
    assert(await deps.apiStopped(), 'API listener remains reachable after stopping');
    await deps.noApiWork(); await deps.noPowerWork();
    const deadline = deps.now() + (ready.windowMinutes || 20) * 60 * 1000;
    await deps.write('paused.json', receipt({windowOperator: 'tsldata', externalWritersFrozen: true,
      directApiCallersFrozen: true, allApiInstancesStopped: true, powerPaused: true, nudgePaused: true, webPaused: true,
      expiresAt: new Date(deadline - 60 * 1000).toISOString(), reviewAfterAt: new Date(deadline).toISOString(), services: stopped}));
    paused = true;
    deps.say('PAUSED: all four Komondor services stopped. Tell Codex PAUSED and keep this terminal open. The window is at most 20 minutes; restart is permitted only after independent data-consistency checks.');
    let reason = 'deadline';
    while (deps.now() < deadline) {
      if (deps.interrupted()) { reason = 'signal'; break; }
      if (deps.exists(completeFile)) {
        const done = await deps.read(completeFile);
        assert.equal(done.runId, runId, 'Completion run differs');
        assert.equal(done.operationId, ready.operationId, 'Completion operation differs');
        assert.equal(done.planSha256, ready.planSha256, 'Completion plan differs');
        if (recovery) assert.equal(done.recoveryId, recovery.recoveryId, 'Completion recovery differs');
        reason = 'verified-completion-request'; break;
      }
      await deps.wait(1000);
    }
    await deps.write('restart-reason.json', receipt({reason}));
  } catch (error) {
    initialError = error;
    if (created) await deps.write('failed.json', receipt({error: error.message}));
    deps.say('STOPPED SAFELY: ' + error.message);
  } finally {
    if (touched.size) {
      let reopenLocked = false;
      try {
        // The runner must check this lock both before and immediately after
        // acquiring mutation.lock. That handshake closes the check/start race.
        await deps.acquireReopenLock(receipt({purpose: 'independent-reopen-check'})); reopenLocked = true;
        assert(!deps.exists('mutation.lock'), 'Mutation lock remains; services must stay stopped');
        assert(!deps.exists('db-evidence/active.lock'), 'Database mutation lock remains; services must stay stopped');
        assert(!deps.exists('recovery-prepare.lock'), 'Recovery preparation remains active; services must stay stopped');
        await deps.verifySeal();
        await deps.checkRelease();
        finalProbe = assertReopenProbe(await deps.probe(runId), ready, runId);
        if (recovery) {
          assert.equal(finalProbe.recoveryId, recovery.recoveryId, 'Final recovery probe differs');
          assert.equal(finalProbe.copiesConsistent, true, 'Final recovery copy paths are not independently verified');
        }
        assert(!deps.exists('mutation.lock'), 'Mutation began during reopen check; services must stay stopped');
        assert(!deps.exists('db-evidence/active.lock'), 'Database mutation began during reopen check; services must stay stopped');
        assert(!deps.exists('recovery-prepare.lock'), 'Recovery preparation began during reopen check; services must stay stopped');
        if (touched.has('komondor-api')) await deps.restart('komondor-api');
        let healthy = false;
        for (let attempt = 0; attempt < 45; attempt++) {
          if (await deps.apiReady()) { healthy = true; break; }
          await deps.wait(1000);
        }
        assert(healthy, 'API readiness did not return; dependent services remain stopped');
        for (const name of ['komondor-web','komondor-power','komondor-nudge']) if (touched.has(name)) await deps.restart(name);
        const services = assertServiceSnapshot(await deps.snapshot(), 'online');
        await deps.write('restored.json', receipt({apiReady: true, graphState: finalProbe.state, consistency: finalProbe, services}));
        deps.say('RESTORED: API ready; Web, Power and Nudge online.');
        await deps.releaseReopenLock(runId); reopenLocked = false;
      } catch (error) {
        restoreError = error;
        await deps.write('restore-failed.json', receipt({error: error.message, reopenLockRetained: reopenLocked}));
        deps.say('RESTORE NEEDS ATTENTION: ' + error.message + '. Do not manually restart into an incomplete graph; inspect the preserved journal.');
        // Intentionally retain the reopen lock. Recovery must inspect it and
        // the database state before explicitly clearing it under operator control.
      }
    }
  }
  return {runId, paused, restored: touched.size > 0 && !restoreError, initialError: initialError?.message || null,
    restoreError: restoreError?.message || null, state: finalProbe?.state || null};
}

function readRegular(filename, root) {
  const relative = path.relative(root, filename);
  assert(safeRelative(relative), 'Unsafe sealed path');
  let current = root;
  assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'Unsafe pack root');
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink in execution pack');
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd); assert(before.isFile(), 'Sealed path is not a regular file');
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ctimeMs, before.ctimeMs);
    return bytes;
  } finally { fs.closeSync(fd); }
}

function parseArguments(argv) {
  assert([4,8].includes(argv.length), 'Use --execute --external-writers-and-api-callers-frozen --ready-sha256 SHA256 [--recovery-id ID --recovery-ready-sha256 SHA256]');
  assert.equal(argv[0], '--execute');
  assert.equal(argv[1], '--external-writers-and-api-callers-frozen');
  assert.equal(argv[2], '--ready-sha256'); assert(validDigest(argv[3]), 'Expected ready digest');
  if (argv.length === 8) {
    assert.equal(argv[4], '--recovery-id'); assert(validId(argv[5]), 'Invalid recovery identity');
    assert.equal(argv[6], '--recovery-ready-sha256'); assert(validDigest(argv[7]), 'Expected recovery approval digest');
  }
  return {expectedReadyDigest: argv[3], recoveryId: argv[5] || null, expectedRecoveryDigest: argv[7] || null};
}

async function main(argv = process.argv.slice(2)) {
  const {expectedReadyDigest,recoveryId,expectedRecoveryDigest} = parseArguments(argv);
  assert.equal(os.hostname().split('.')[0], 'v1333', 'This controller is only for v1333');
  assert.equal(os.userInfo().username, 'tsldata', 'Service control must run in the tsldata terminal');
  const readyBytes = readRegular(path.join(PACK, 'execution-ready.json'), PACK);
  assert.equal(sha(readyBytes), expectedReadyDigest, 'Execution readiness seal differs');
  const ready = validateReady(JSON.parse(readyBytes));
  const recoveryFile = recoveryId ? path.join(PACK,'recovery',recoveryId,'recovery-ready.json') : null;
  const recoveryBytes = recoveryFile ? readRegular(recoveryFile,PACK) : null;
  if (recoveryBytes) assert.equal(sha(recoveryBytes), expectedRecoveryDigest, 'Recovery approval seal differs');
  const recovery = recoveryBytes ? validateRecovery(JSON.parse(recoveryBytes),ready,expectedReadyDigest,Date.now()) : null;
  if (recovery) assert.equal(recovery.recoveryId,recoveryId,'Recovery identity differs');
  const windowDir = recovery ? path.join(PACK,'recovery',recoveryId,'window') : path.join(PACK,'window');
  const verifyRecoverySeal = () => {
    if (!recovery) return;
    assert.equal(sha(readRegular(recoveryFile,PACK)),expectedRecoveryDigest,'Recovery approval changed');
    for(const [relative,digest] of Object.entries(recovery.preservedFiles))
      assert.equal(sha(readRegular(path.join(PACK,relative),PACK)),digest,'Preserved recovery evidence changed: '+relative);
    const previous = 'recovery/' + recoveryId + '/previous/';
    const prior = JSON.parse(readRegular(path.join(PACK,previous,'window/paused.json'),PACK));
    assert.equal(prior.runId,recovery.previousRunId,'Previous window identity differs');
    assert.equal(prior.controllerPid,recovery.previousControllerPid,'Previous controller PID differs');
    for(const key of ['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'])
      assert.equal(prior[key],ready[key],'Previous window differs: '+key);
  };
  const env = {...process.env, PM2_HOME:'/storage/.pm2'};
  const pm = args => cp.execFileSync(NODE, [PM2,...args], {env,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
  const git = (directory,args) => cp.execFileSync('git', ['--no-optional-locks','--no-pager','-c','safe.directory='+directory,'-C',directory,...args], {encoding:'utf8',timeout:10000}).trim();
  const write = (name,value) => {
    assert(/^[a-z-]+\.json$/.test(name));
    const fd=fs.openSync(path.join(windowDir,name),'wx',0o644);
    try {fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  };
  const {MongoClient}=require(API+'/node_modules/mongodb');
  const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',
    {useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
  const db=client.db('komondor');
  let interrupted=false;
  const interrupt=()=>{interrupted=true;};
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,interrupt);
  const apiProbe=async()=>{try {const r=await fetch('http://127.0.0.1:3061/ready',{signal:AbortSignal.timeout(3000)});return {reachable:true,ready:r.status===200&&(await r.json()).status==='ready'};}catch(error){return {reachable:error?.cause?.code!=='ECONNREFUSED',ready:false};}};
  try {
    const result=await runWindow(ready,{
      now:Date.now,uuid:crypto.randomUUID,say:console.log,controllerPid:process.pid,recoveryReadySha256:expectedRecoveryDigest,
      interrupted:()=>interrupted,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
      exists:name=>fs.existsSync(path.join(PACK,name)),
      read:name=>JSON.parse(readRegular(path.join(PACK,name),PACK)),
      createEvidence:()=>fs.mkdirSync(windowDir,{mode:0o755}),write,
      verifySeal:()=>{
        assert.equal(sha(readRegular(path.join(PACK,'execution-ready.json'),PACK)),expectedReadyDigest);
        for(const [relative,digest] of Object.entries(ready.files))assert.equal(sha(readRegular(path.join(PACK,relative),PACK)),digest,'Sealed execution file changed: '+relative);
        assert.equal(sha(readRegular(path.join(PACK,ready.preparedPlanFile),PACK)),ready.preparedPlanSha256);
        assert.equal(sha(readRegular(path.join(PACK,ready.copyReceiptFile),PACK)),ready.copyReceiptSha256);
        verifyRecoverySeal();
      },
      verifyRecovery:()=>{
        validateRecovery(recovery,ready,expectedReadyDigest,Date.now());
        verifyRecoverySeal();
        assertPidExited(recovery.previousControllerPid);
        assertPidExited(recovery.previousMutatorPid);
      },
      checkRelease:()=>{
        for(const [directory,head] of [[API,ready.apiHead],[WEB,ready.webHead]]){
          assert.equal(git(directory,['rev-parse','HEAD']),head,'Code changed during the reviewed window');
          assert.equal(git(directory,['status','--porcelain']),'','Checkout is dirty; do not change reviewed code during this window');
        }
      },
      checkPm2:()=>{assert(fs.statSync('/storage/.pm2/rpc.sock').isSocket());process.kill(Number(fs.readFileSync('/storage/.pm2/pm2.pid','utf8').trim()),0);},
      snapshot:()=>JSON.parse(pm(['jlist'])),stop:name=>pm(['stop',name]),restart:name=>pm(['restart',name]),
      apiReady:async()=> (await apiProbe()).ready,
      apiStopped:async()=> !(await apiProbe()).reachable,
      noApiWork:async()=>{
        const counts={ingest:await db.collection('ingestjobs').countDocuments({status:{$nin:['done','failed']}}),
          runs:await db.collection('runs').countDocuments({$or:[{status:{$in:['pending','processing']}},{md5VerificationStatus:'in_progress'}]})};
        assert(Object.values(counts).every(n=>n===0),'Unfinished API work: '+JSON.stringify(counts));return counts;
      },
      noPowerWork:()=>{
        const program="import sqlite3,json\nc=sqlite3.connect('file:/storage/www/komondor-power/db/production.db?mode=ro',uri=True)\nprint(json.dumps({'entries':c.execute(\"SELECT count(*) FROM entries WHERE status IS NULL OR status NOT IN ('completed','error')\").fetchone()[0],'tracking':c.execute('SELECT count(*) FROM entry_tracking WHERE finished_at IS NULL').fetchone()[0]}))\nc.close()";
        const counts=JSON.parse(cp.execFileSync('python3',['-c',program],{encoding:'utf8',timeout:10000}));
        assert(Object.values(counts).every(n=>n===0),'Unfinished Power work: '+JSON.stringify(counts));return counts;
      },
      probe:runId=>JSON.parse(cp.execFileSync(NODE,[path.join(PACK,ready.runnerFile||'runner.cjs'),'safe-to-reopen','--run-id',runId,'--plan-sha256',ready.planSha256,...(recovery?['--recovery-id',recoveryId]:[])],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024})),
      acquireReopenLock:value=>{
        const fd=fs.openSync(path.join(PACK,'window-reopen.lock'),'wx',0o644);
        try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      },
      releaseReopenLock:runId=>{const filename=path.join(PACK,'window-reopen.lock');assert.equal(JSON.parse(readRegular(filename,PACK)).runId,runId);fs.unlinkSync(filename);},
    },recovery);
    if(result.initialError||result.restoreError)process.exitCode=1;
    return result;
  } finally {
    for(const signal of ['SIGINT','SIGTERM'])process.off(signal,interrupt);
    await client.close();
  }
}

module.exports={validateReady,validateRecovery,assertServiceSnapshot,assertReopenProbe,assertRecoveryProbe,assertPidExited,parseArguments,runWindow,readRegular,main};
if(require.main===module)main().catch(error=>{console.error('STOPPED SAFELY: '+error.message);process.exitCode=1;});
