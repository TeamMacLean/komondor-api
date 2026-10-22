'use strict';
// Controls services only. The separately reviewed reconciliation CLI makes DB writes.
const fs = require('fs');
const cp = require('child_process');
const assert = require('assert/strict');
const crypto = require('crypto');
const node = '/storage/.nvm/versions/node/v24.11.1/bin/node';
const pm2 = '/storage/.nvm/versions/node/v24.11.1/lib/node_modules/pm2/bin/pm2';
const api = '/storage/www/komondor-api';
const pack = '/storage/komondor-project2178-20261022';
const evidence = '/storage/komondor-project2178-window-20261022';
const oldHead = '27b98035dccf1b33e2f449be972e2003b4114b24';
const newHead = '27b98035dccf1b33e2f449be972e2003b4114b24';
const digest = 'f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b';
const names = ['komondor-api', 'komondor-power', 'komondor-nudge', 'komondor-web'];
const web = '/storage/www/komondor-web';
const oldWebHead = 'e9e183cc6968da46a4b0eada76471b750745a771';
const newWebHead = 'e9e183cc6968da46a4b0eada76471b750745a771';
process.env.KOMONDOR_API_ROOT = api;
const env = { ...process.env, PM2_HOME: '/storage/.pm2' };
const runId = crypto.randomUUID();
const touched = new Set();
let interrupted = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pm = args => cp.execFileSync(node, [pm2, ...args], { env, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
const snapshot = () => JSON.parse(pm(['jlist']));
const git = args => cp.execFileSync('git', ['-c', 'safe.directory=' + api, '-C', api, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
const webGit = args => cp.execFileSync('git', ['-c', 'safe.directory=' + web, '-C', web, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
const write = (name, value) => fs.writeFileSync(evidence + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
const mongoose = require(api + '/node_modules/mongoose');
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

async function noApiWork() {
  const db = mongoose.connection.db;
  const counts = {
    ingest: await db.collection('ingestjobs').countDocuments({ status: { $nin: ['done', 'failed'] } }),
    runs: await db.collection('runs').countDocuments({ $or: [{ status: { $in: ['pending', 'processing'] } }, { md5VerificationStatus: 'in_progress' }] }),
  };
  assert(Object.values(counts).every(n => n === 0), 'Unfinished API work: ' + JSON.stringify(counts));
  return counts;
}
function noPowerWork() {
  const program = `import sqlite3,json
c=sqlite3.connect('file:/storage/www/komondor-power/db/production.db?mode=ro',uri=True)
print(json.dumps({'entries':c.execute("SELECT count(*) FROM entries WHERE status IS NULL OR status NOT IN ('completed','error')").fetchone()[0],'tracking':c.execute('SELECT count(*) FROM entry_tracking WHERE finished_at IS NULL').fetchone()[0]}))
c.close()`;
  const result = JSON.parse(cp.execFileSync('python3', ['-c', program], { encoding: 'utf8', timeout: 10000 }));
  assert(Object.values(result).every(n => n === 0), 'Unfinished Power work: ' + JSON.stringify(result));
  return result;
}
async function ready() {
  try {
    const response = await fetch('http://127.0.0.1:3061/ready', { signal: AbortSignal.timeout(3000) });
    return response.status === 200 && (await response.json()).status === 'ready';
  } catch (_) { return false; }
}
async function main() {
  assert(process.argv.includes('--execute'), '--execute required');
  assert(process.argv.includes('--external-writers-frozen'), 'Operator must attest external writers are frozen');
  assert.equal(cp.execFileSync('id', ['-un'], { encoding: 'utf8' }).trim(), 'tsldata');
  assert(fs.statSync('/storage/.pm2/rpc.sock').isSocket());
  process.kill(Number(fs.readFileSync('/storage/.pm2/pm2.pid', 'utf8').trim()), 0);
  assert(!fs.existsSync(pack + '/window-complete.json'), 'Completion request already exists');
  assert.equal(git(['rev-parse', 'HEAD']), oldHead);
  assert.equal(webGit(['rev-parse', 'HEAD']), oldWebHead);
  assert.equal(webGit(['status', '--porcelain']), '');
  assert.equal(git(['status', '--porcelain']), '');
  const approval = JSON.parse(fs.readFileSync(pack + '/execution-ready.json'));
  assert.equal(approval.planSha256, digest);
  assert.equal(approval.releaseHead, newHead);
  assert.equal(approval.independentBackupRestored, true);
  assert.equal(approval.operations, 69);
  assert.equal(approval.shadowReplayPassed, true);
  assert.equal(approval.webBuildSucceeded, true);
  assert.equal(approval.webReleaseHead, newWebHead);
  fs.mkdirSync(evidence, { mode: 0o755 });
  const all = snapshot();
  assert.equal(all.filter(p => p.pm2_env.pm_exec_path === api + '/server.js').length, 1, 'Unexpected API instance count');
  for (const name of names) {
    const matches = all.filter(p => p.name === name);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].pm2_env.status, 'online');
    assert.equal(matches[0].pm2_env.pm_cwd, '/storage/www/' + name);
  }
  assert(await ready(), 'API is not ready before the window');
  require(api + '/node_modules/dotenv').config({ path: api + '/.env' });
  await mongoose.connect(require(api + '/lib/utils/validateEnv').resolveMongoUri(), {
    autoIndex: false, autoCreate: false, useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 10000,
  });
  write('before.json', { at: new Date().toISOString(), runId, api: await noApiWork(), power: noPowerWork(),
    services: all.filter(p => names.includes(p.name)).map(p => ({ name: p.name, id: p.pm_id, pid: p.pid })) });
  for (const name of ['komondor-nudge', 'komondor-power', 'komondor-web']) { touched.add(name); pm(['stop', name]); }
  noPowerWork(); await noApiWork();
  touched.add('komondor-api'); pm(['stop', 'komondor-api']);
  const stopped = snapshot().filter(p => names.includes(p.name));
  assert.equal(stopped.length, 4);
  assert(stopped.every(p => p.pm2_env.status === 'stopped' && !p.pid));
  await require(api + '/lib/s3-archive/preflight').apiAppearsStopped('http://127.0.0.1:3061/ready');
  await noApiWork(); noPowerWork();
  const deadline = Date.now() + 20 * 60 * 1000;
  write('paused.json', { at: new Date().toISOString(), runId, planSha256: digest, windowOperator: 'tsldata',
    externalWritersFrozen: true, allApiInstancesStopped: true, powerPaused: true, nudgePaused: true, webPaused: true,
    expiresAt: new Date(deadline - 5 * 60 * 1000).toISOString(), automaticRestartAt: new Date(deadline).toISOString() });
  console.log('PAUSED: API, Web, Power and Nudge stopped. Waiting for consolidation and verification; recovery after 20 minutes only if the data is consistent.');
  let reason = 'deadline';
  while (Date.now() < deadline) {
    if (interrupted) { reason = 'signal'; break; }
    if (fs.existsSync(pack + '/window-complete.json')) {
      const done = JSON.parse(fs.readFileSync(pack + '/window-complete.json'));
      assert.equal(done.runId, runId); assert.equal(done.planSha256, digest);
      reason = done.reason; break;
    }
    await sleep(1000);
  }
  write('restart-reason.json', { at: new Date().toISOString(), runId, reason });
}
async function restore() {
  if (!touched.size) return;
  const failures = [];
  let apiReady = !touched.has('komondor-api') && await ready();
  try {
    const head = git(['rev-parse', 'HEAD']);
    assert.equal(git(['status', '--porcelain']), '', 'Checkout is dirty; do not restart inconsistent code');
    assert([oldHead, newHead].includes(head), 'Unreviewed release');
    let registered = 0;
    for (const name of ['projects','samples','runs','files','additionalfiles','archiveReconciliations']) registered += await mongoose.connection.db.collection(name).countDocuments({ 'reconciliation.planSha256': digest });
    const webHead = webGit(['rev-parse', 'HEAD']);
    assert([oldWebHead, newWebHead].includes(webHead), 'Unreviewed web release');
    assert.equal(webGit(['status', '--porcelain']), '', 'Web checkout is dirty');
    if (registered) assert.equal(webHead, newWebHead, 'Reconciled records require the matching web release');
    if (webHead === newWebHead) assert.equal(JSON.parse(fs.readFileSync(web + '/.nuxt/reconciliation-release.json')).head, newWebHead, 'Web build marker differs');
    if (registered) assert.equal(head, newHead, 'Created records require the reviewed API release');
    const consolidation = await require(pack + '/recoverability.cjs').check(mongoose.connection.db);
    if (touched.has('komondor-api')) {
      pm(['restart', 'komondor-api']);
      for (let i = 0; i < 45; i++) { if (await ready()) { apiReady = true; break; } await sleep(1000); }
    }
    assert(apiReady, 'API readiness has not returned; keep dependent services stopped');
    for (const name of ['komondor-web', 'komondor-power', 'komondor-nudge']) if (touched.has(name)) pm(['restart', name]);
    const services = snapshot().filter(p => names.includes(p.name)).map(p => ({ name: p.name, pid: p.pid, status: p.pm2_env.status }));
    assert(services.every(p => p.status === 'online'), 'A service is not online');
    write('restored.json', { at: new Date().toISOString(), runId, apiReady, head, webHead, registered, consolidation, services });
    console.log('RESTORED: API ready; Web, Power and Nudge online.');
  } catch (error) {
    failures.push(error.message);
    write('restore-failed.json', { at: new Date().toISOString(), runId, apiReady, failures });
    console.error('RESTORE NEEDS ATTENTION: ' + failures.join('; ')); process.exitCode = 1;
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { interrupted = true; });
main().catch(error => {
  console.error('Stopped safely: ' + error.message); process.exitCode = 1;
  if (fs.existsSync(evidence)) write('failed.json', { at: new Date().toISOString(), runId, error: error.message });
}).finally(async () => { await restore(); await mongoose.disconnect(); });
