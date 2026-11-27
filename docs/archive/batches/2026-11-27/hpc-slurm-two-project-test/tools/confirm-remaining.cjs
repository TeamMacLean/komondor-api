'use strict';
// Native confirmation only for the exact, user-deleted remaining167 package.
// No filesystem/S3 deletion, direct database writes, automatic retry or service control.
const fs = require('fs'), os = require('os'), path = require('path');
const cp = require('child_process'), assert = require('assert/strict');
const { connect, createAws, api, sha } = require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli = require(api + '/lib/s3-archive/cli');
const { collectProjectDatabase, collectHardBlockers } = require(api + '/lib/s3-archive/preflight');
const { projectStorageLocations } = require(api + '/lib/project-storage-locations');
const { resolveHpcPreservation } = require(api + '/lib/hpc-preservation');

const PLAN = '/storage/komondor-hpc-delete-remaining167-20261127-01/deletion-plan.json';
const PLAN_SHA256 = 'bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7';
const IDS_SHA256 = '29fc93c14c6bb969cc9a2b5f8e3b953f8acbac5257af781fa712cf5ebf303cac';
const REVIEW = '/storage/komondor-deletion-refresh-20261127-01', ROOT = '/mnt/reads';
const HELD = {
  '5fc012bda3efcb29338b7d58': 'two_blades/gargy_2019_rnaseq',
  '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
  '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
  '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
  '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
};
const COMPLETED = {
  '5fc012bda3efcb29338b7d4b': 'jjones/plant_capture_enhancer',
  '5fc012bda3efcb29338b7d13': 'jjones/miseq_renseq_of_brassica_accessions_',
  '5fc012bda3efcb29338b7d4e': 'jjones/resistance_to_albugo_laibachii_in_sf_2',
};
const reportedSlurm = {
  jobId: '25340024', provenance: 'User report; raw logs/accounting not inspected by this script',
  reportedState: 'COMPLETED', reportedExitCode: '0:0', reportedElapsed: '00:09:46',
  reportedStartedAt: '2026-11-27T13:14:31Z', reportedFinishedAt: '2026-11-27T13:24:17Z',
  rawLogsInspected: false, schedulerAccountingIndependentlyVerified: false,
};
const plain = value => JSON.parse(JSON.stringify(value));
const counts = database => Object.fromEntries(Object.entries(database).map(([key, value]) => [key, value.length]));
let c, pack, startedAt;
const commands = [], confirmed = [], verified = [], failures = [];
function saveBytes(name, bytes) {
  assert.equal(path.basename(name), name);
  const filename = path.join(pack, name), fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(filename, 0o400);
  return sha(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}
const save = (name, value) => saveBytes(name, JSON.stringify(value, null, 2) + '\n');
const readProject = id => c.models.Project.collection.findOne({ _id: new c.mongoose.Types.ObjectId(id) });
function directory(filename) {
  assert(fs.lstatSync(filename).isDirectory(), 'Missing/symlinked directory: ' + filename);
  assert.equal(fs.realpathSync(filename), filename);
}
function absent(relativeRoot) {
  directory(ROOT + '/' + relativeRoot.split('/')[0]);
  assert.throws(() => fs.lstatSync(ROOT + '/' + relativeRoot), { code: 'ENOENT' });
}
function observe(targets) {
  const mount = JSON.parse(cp.execFileSync('findmnt', ['-J', '-T', ROOT, '-o', 'TARGET,SOURCE,FSTYPE'])).filesystems[0];
  assert.equal(mount.target, ROOT);
  assert.equal(mount.source, 'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');
  assert(mount.fstype.startsWith('nfs')); directory(ROOT);
  for (const project of targets) absent(project.relativeRoot);
  for (const relativeRoot of Object.values(COMPLETED)) absent(relativeRoot);
  for (const relativeRoot of Object.values(HELD)) {
    directory(ROOT + '/' + relativeRoot.split('/')[0]); directory(ROOT + '/' + relativeRoot);
  }
  return { at: new Date().toISOString(), mount, absentTargets: targets.length,
    fiveHeldRootsPresent: true, threePreviouslyCompletedRootsAbsent: true };
}
function identity(project, reviewed, state = 'aws_pending_hpc_deletion') {
  assert(project); assert(!HELD[reviewed.projectId] && !COMPLETED[reviewed.projectId]);
  assert.equal(String(project._id), reviewed.projectId);
  assert.equal(project.path, '/' + reviewed.relativeRoot);
  assert.equal(reviewed.hpcPath, '/tsl/data/reads/' + reviewed.relativeRoot);
  assert.equal(project.storage.state, state);
  assert.equal(project.archiveMigration.phase, state === 'aws' ? 'completed' : 'verified');
  assert.equal(project.archiveMigration.sourceRoot, ROOT + '/' + reviewed.relativeRoot);
  assert.equal(project.archiveMigration.sourceRelativeRoot, reviewed.relativeRoot);
  assert.equal(String(project.archiveMigration.id), reviewed.migrationId);
  assert.equal(project.storage.s3Uri, reviewed.s3Uri);
  assert.equal(project.storage.s3VerifiedAt.toISOString(), reviewed.s3VerifiedAt);
  for (const key of ['sourceSha256', 'verificationSha256']) assert.equal(project.archiveMigration.manifests[key], reviewed[key]);
  assert.equal(project.archiveMigration.manifests.fileCount, reviewed.fileCount);
  assert.equal(project.archiveMigration.manifests.totalBytes, reviewed.bytes);
  const hold = resolveHpcPreservation(project);
  assert.equal(hold.invalid, false); assert.equal(hold.active, false);
}
function unchangedFields(project) {
  const result = plain(project); delete result.updatedAt;
  for (const key of ['state', 'hpcVerifiedAbsentAt', 'archivedAt']) delete result.storage[key];
  for (const key of ['phase', 'confirmedAbsentBy', 'updatedAt']) delete result.archiveMigration[key];
  return result;
}
function localControls(reviewed) {
  for (const [name, kind, digest] of [['source-manifest.v1.json', 'source', reviewed.sourceSha256],
    ['verification-report.v1.json', 'verification', reviewed.verificationSha256]]) {
    const bytes = fs.readFileSync(path.join(REVIEW, reviewed.projectId, name));
    assert.equal(sha(bytes), digest, 'Sealed local control digest differs');
    const record = JSON.parse(bytes);
    assert.equal(record.kind, kind); assert.equal(String(record.projectId), reviewed.projectId);
    assert.equal(String(record.migrationId), reviewed.migrationId);
    if (kind === 'source') {
      assert.equal(record.sourceRoot, ROOT + '/' + reviewed.relativeRoot);
      assert.equal(record.sourceRelativeRoot, reviewed.relativeRoot);
      assert.equal(record.dataPrefix, reviewed.s3Uri);
      assert.equal(record.entries.filter(e => e.type !== 'dir' && e.disposition !== 'copy').length, 0);
    } else assert.equal(record.verified, true);
    saveBytes(reviewed.projectId + '-' + name, bytes);
  }
}
async function native(aws, reviewed, execute) {
  let stdout = '', stderr = '';
  const args = ['confirm-absent', '--project-id', reviewed.projectId, '--confirmed-by', 'deeks', ...(execute ? ['--execute'] : [])];
  const exitCode = await cli.runCli(args, { ...c, aws, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  const receipt = { at: new Date().toISOString(), projectId: reviewed.projectId, args, exitCode, stdout, stderr };
  save(reviewed.projectId + (execute ? '-confirmation.json' : '-dry-run.json'), receipt); commands.push(receipt);
  assert.equal(exitCode, 0, stderr || 'Native confirmation failed'); assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.command, 'confirm-absent'); assert.equal(String(result.migrationId), reviewed.migrationId);
  if (execute) { assert.equal(result.state, 'aws'); assert.equal(result.phase, 'completed'); }
  else assert.equal(result.would, 'finalize project as aws');
}
// Stop assigning work on first failure; await every in-flight operation. Each
// execute task checks canContinue again immediately before its native mutation.
async function bounded(stage, items, task) {
  let next = 0, finished = 0, firstError = null;
  console.log(JSON.stringify({ at: new Date().toISOString(), stage, event: 'phase-started', total: items.length, serverEvidence: pack }));
  async function worker() {
    while (!firstError && next < items.length) {
      const item = items[next++], id = item.reviewed ? item.reviewed.projectId : item.projectId;
      try {
        await task(item, () => !firstError); finished++;
        if (finished % 10 === 0 || finished === items.length) {
          console.log(JSON.stringify({ at: new Date().toISOString(), stage, done: finished, total: items.length, serverEvidence: pack }));
        }
      }
      catch (error) {
        firstError ||= error;
        const receipt = { at: new Date().toISOString(), stage, projectId: id, error: error.stack };
        failures.push(receipt);
        try { save(id + '-' + stage + '-failure.json', receipt); }
        catch (saveError) { console.error('Failure receipt save failed: ' + saveError.message); }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (firstError) throw firstError;
}
async function protectedSnapshot() {
  const snapshots = [];
  for (const [id, relativeRoot] of Object.entries({ ...HELD, ...COMPLETED })) {
    const project = await readProject(id); assert(project); assert.equal(project.path, '/' + relativeRoot);
    assert.equal(project.archiveMigration.sourceRoot, ROOT + '/' + relativeRoot);
    assert.equal(project.storage.state, HELD[id] ? 'aws_pending_hpc_deletion' : 'aws');
    assert.equal(project.archiveMigration.phase, HELD[id] ? 'verified' : 'completed');
    assert.equal(resolveHpcPreservation(project).invalid, false);
    if (id === '5fc012bda3efcb29338b7d58') assert.equal(resolveHpcPreservation(project).active, true);
    if (COMPLETED[id]) assert(project.storage.hpcVerifiedAbsentAt instanceof Date);
    snapshots.push({ project, database: await collectProjectDatabase(c.models, id) });
  }
  return snapshots;
}
async function checkAfter(baseline) {
  const { reviewed, project: before, database: databaseBefore } = baseline;
  const project = await readProject(reviewed.projectId), database = await collectProjectDatabase(c.models, reviewed.projectId);
  identity(project, reviewed, 'aws');
  assert.equal(project.archiveMigration.confirmedAbsentBy, 'deeks');
  assert(project.storage.hpcVerifiedAbsentAt instanceof Date);
  assert(project.storage.hpcVerifiedAbsentAt.getTime() >= new Date(startedAt).getTime());
  assert.equal(project.storage.archivedAt.toISOString(), project.storage.hpcVerifiedAbsentAt.toISOString());
  assert.deepEqual(unchangedFields(project), unchangedFields(before), 'Unexpected Project fields changed');
  assert.deepEqual(plain(database), plain(databaseBefore), 'Associated database records changed');
  const locations = await projectStorageLocations(project, { datastoreRoot: ROOT, readsRoot: '/tsl/data/reads' });
  assert.equal(locations.hpc.status, 'absent'); assert.equal(locations.aws.status, 'verified');
  assert.equal(locations.hpc.uri, reviewed.hpcPath); assert.equal(locations.aws.uri, reviewed.s3Uri);
  return { project, database, locations };
}

(async () => {
  assert.deepEqual(process.argv.slice(2), ['--execute-reported-deletion']);
  assert.equal(os.hostname().split('.')[0], 'v1333'); assert.equal(os.userInfo().username, 'deeks');
  process.umask(0o077); startedAt = new Date().toISOString();
  const rawPlan = fs.readFileSync(PLAN); assert.equal(sha(rawPlan), PLAN_SHA256);
  const plan = JSON.parse(rawPlan);
  assert.equal(plan.kind, 'komondor-reviewed-hpc-deletion-v1'); assert.equal(plan.stage, 'remaining-167-released');
  assert.equal(plan.releaseStatus, 'ready-for-user-submission'); assert.equal(plan.projects.length, 167);
  const ids = plan.projects.map(p => p.projectId).sort(); assert.equal(new Set(ids).size, 167);
  assert.equal(sha(Buffer.from(ids.join('\n') + '\n')), IDS_SHA256);
  assert.deepEqual(Object.fromEntries(plan.held.map(p => [p.projectId, p.relativeRoot])), HELD);
  for (const id of ids) assert(!HELD[id] && !COMPLETED[id]);
  // Retain the original deletion expiry; confirmation does not authorize rm.
  pack = '/storage/komondor-slurm-bulk-confirm-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  fs.mkdirSync(pack, { mode: 0o700 });
  console.log(JSON.stringify({ at: startedAt, event: 'started', total: 167, workers: 4, serverEvidence: pack }));
  saveBytes('deletion-plan.json', rawPlan); saveBytes('confirm-remaining.cjs', fs.readFileSync(__filename));
  save('reported-slurm.json', { at: startedAt, ...reportedSlurm });
  c = await connect(); assert.equal(c.toolVersion, plan.apiHead); assert.equal(c.config.datastoreRoot, ROOT);
  const user = await c.models.User.findOne({ username: 'deeks' }).lean(); assert(user); assert.equal(user.name, 'George Deeks');
  const protectedBefore = await protectedSnapshot();
  save('protected-before.json', { at: new Date().toISOString(), projects: protectedBefore });
  save('initial-observations.json', { at: startedAt, apiHead: c.toolVersion, observations: observe(plan.projects), operator: 'deeks' });
  const baseline = new Map();
  await bounded('preflight', plan.projects, async reviewed => {
    const project = await readProject(reviewed.projectId), database = await collectProjectDatabase(c.models, reviewed.projectId);
    const item = { reviewed, project, database };
    save(reviewed.projectId + '-before.json', { at: new Date().toISOString(), ...item });
    identity(project, reviewed); assert.deepEqual(collectHardBlockers(database), []); localControls(reviewed);
    baseline.set(reviewed.projectId, item);
  });
  assert.equal(baseline.size, 167);
  save('all-before-snapshots-passed.json', { at: new Date().toISOString(), projects: 167, observations: observe(plan.projects) });
  const items = plan.projects.map(p => baseline.get(p.projectId));
  await bounded('dry-run', items, async ({ reviewed }) => { observe([reviewed]); await native(createAws(c.config), reviewed, false); });
  save('all-dry-runs-passed.json', { at: new Date().toISOString(), projects: 167, observations: observe(plan.projects) });
  assert.deepEqual(plain(await protectedSnapshot()), plain(protectedBefore), 'Protected Projects changed during preflight');

  await bounded('execute', items, async (item, canContinue) => {
    const { reviewed, project: before, database: databaseBefore } = item;
    const current = await readProject(reviewed.projectId);
    identity(current, reviewed); assert.deepEqual(plain(current), plain(before), 'Project changed since preflight');
    const database = await collectProjectDatabase(c.models, reviewed.projectId);
    assert.deepEqual(collectHardBlockers(database), []);
    assert.deepEqual(plain(database), plain(databaseBefore), 'Associated records changed since preflight');
    observe([reviewed]); assert(canContinue(), 'Another worker failed; do not start another confirmation');
    await native(createAws(c.config), reviewed, true); confirmed.push(reviewed.projectId);
    // Save the raw after-state even if a subsequent assertion fails.
    save(reviewed.projectId + '-after.json', { at: new Date().toISOString(), project: await readProject(reviewed.projectId),
      database: await collectProjectDatabase(c.models, reviewed.projectId) });
    const after = await checkAfter(item);
    const result = { at: new Date().toISOString(), projectId: reviewed.projectId, name: after.project.name,
      migrationId: reviewed.migrationId, storage: after.project.storage, phase: after.project.archiveMigration.phase,
      locations: after.locations, counts: counts(after.database), associatedRecordsUnchanged: true,
      s3VerifiedAtUnchanged: true, onlyNativeConfirmationFieldsChanged: true };
    save(reviewed.projectId + '-completed.json', result); verified.push(result);
  });
  assert.equal(confirmed.length, 167); assert.equal(verified.length, 167);
  const final = [];
  await bounded('final-audit', items, async item => {
    const after = await checkAfter(item);
    final.push({ projectId: item.reviewed.projectId, state: after.project.storage.state,
      phase: after.project.archiveMigration.phase, s3VerifiedAt: after.project.storage.s3VerifiedAt,
      counts: counts(after.database), locations: after.locations, associatedRecordsUnchanged: true });
  });
  const protectedAfter = await protectedSnapshot();
  save('protected-after.json', { at: new Date().toISOString(), projects: protectedAfter });
  assert.deepEqual(plain(protectedAfter), plain(protectedBefore), 'Held or previously completed Projects changed');
  assert.equal(final.length, 167); assert.equal(new Set(final.map(p => p.projectId)).size, 167);
  const result = { at: new Date().toISOString(), success: true, projects: 167, confirmed: 167, verified: 167,
    operator: 'deeks', apiHead: c.toolVersion, planSha256: PLAN_SHA256, observations: observe(plan.projects),
    final: final.sort((a, b) => a.projectId.localeCompare(b.projectId)), protectedProjectsUnchanged: 8,
    heldProjectsRemaining: 5, previouslyCompletedProjectsUnchanged: 3, failures, reportedSlurm, serverEvidence: pack };
  save('final-audit.json', { at: result.at, projects: result.final, observations: result.observations });
  save('commands.json', commands); save('completed.json', result);
  console.log(JSON.stringify({ at: result.at, success: true, confirmed: 167, verified: 167, serverEvidence: pack }));
})().catch(error => {
  if (pack) {
    try { save('failure.json', { at: new Date().toISOString(), error: error.stack,
      confirmedProjects: confirmed, verifiedProjects: verified.map(p => p.projectId), failures, commands,
      continuationRequiresInspection: true, serverEvidence: pack }); }
    catch (saveError) { console.error('Could not save failure receipt: ' + saveError.message); }
  }
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => { if (c) await c.mongoose.disconnect(); });
