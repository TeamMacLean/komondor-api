'use strict';
// Confirm only George's two reported pilot deletions through the deployed CLI.
// Never deletes filesystem data, changes S3 objects, or releases the 167 job.
// Run on v1333 as deeks: node confirm-pilot.cjs --execute-reported-deletion
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert/strict');
const { connect, createAws, api, sha } = require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli = require(api + '/lib/s3-archive/cli');
const { collectProjectDatabase, collectHardBlockers } = require(api + '/lib/s3-archive/preflight');
const { projectStorageLocations } = require(api + '/lib/project-storage-locations');
const { resolveHpcPreservation } = require(api + '/lib/hpc-preservation');

const PLAN = '/storage/komondor-hpc-delete-split-20261127-01/hpc-slurm-two-project-test/pilot-2/deletion-plan.json';
const PLAN_SHA256 = '79778948f8d92ae888a3c8ba275c2245d248bbdf41c717c094a1043a23269489';
const ROOT = '/mnt/reads';
const TARGETS = {
  '5fc012bda3efcb29338b7d13': {
    relativeRoot: 'jjones/miseq_renseq_of_brassica_accessions_',
    migrationId: '6adb34882f2b2c46efb0e138',
    counts: { samples: 2, runs: 1, unfinishedJobs: 0, reads: 2, additionalFiles: 14 },
  },
  '5fc012bda3efcb29338b7d4e': {
    relativeRoot: 'jjones/resistance_to_albugo_laibachii_in_sf_2',
    migrationId: '6adb34932f2b2c46efb0e186',
    counts: { samples: 1, runs: 1, unfinishedJobs: 0, reads: 2, additionalFiles: 5 },
  },
};
const HELD = {
  '5fc012bda3efcb29338b7d58': 'two_blades/gargy_2019_rnaseq',
  '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
  '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
  '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
  '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
};
const reportedSlurm = {
  jobId: '25339708',
  provenance: 'User report; raw job logs and scheduler accounting not inspected by this script',
  reportedProcessExitCode: 0,
  schedulerState: 'not-yet-inspected',
  reportedDeletedProjects: 2,
  reportedDeletedBytes: 388000992,
  rawLogsInspected: false,
  schedulerAccountingIndependentlyVerified: false,
};
const plain = value => JSON.parse(JSON.stringify(value));
const counts = database => Object.fromEntries(Object.entries(database).map(([key, value]) => [key, value.length]));
let c, pack;
const commands = [], confirmed = [];
function saveBytes(name, bytes) {
  assert.equal(path.basename(name), name);
  const filename = path.join(pack, name);
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(filename, 0o400);
  return sha(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}
const save = (name, value) => saveBytes(name, JSON.stringify(value, null, 2) + '\n');

function actualDirectory(filename) {
  assert(fs.lstatSync(filename).isDirectory(), 'Missing or symlinked directory: ' + filename);
  assert.equal(fs.realpathSync(filename), filename, 'Unexpected directory resolution');
}

function mountAndAbsences() {
  const mount = JSON.parse(cp.execFileSync('findmnt', ['-J', '-T', ROOT, '-o', 'TARGET,SOURCE,FSTYPE'])).filesystems[0];
  assert.equal(mount.target, ROOT);
  assert.equal(mount.source, 'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');
  assert(mount.fstype.startsWith('nfs'));
  actualDirectory(ROOT);
  actualDirectory(ROOT + '/jjones');
  for (const target of Object.values(TARGETS)) {
    assert.throws(() => fs.lstatSync(ROOT + '/' + target.relativeRoot), { code: 'ENOENT' });
  }
  for (const relativeRoot of Object.values(HELD)) {
    actualDirectory(ROOT + '/' + relativeRoot.split('/')[0]);
    actualDirectory(ROOT + '/' + relativeRoot);
  }
  assert.throws(() => fs.lstatSync(ROOT + '/jjones/plant_capture_enhancer'), { code: 'ENOENT' });
  return { at: new Date().toISOString(), mount, bothPilotRootsAbsent: true,
    fiveHeldRootsPresent: true, plantCaptureAbsent: true };
}

function checkProject(project, reviewed, expectedState = 'aws_pending_hpc_deletion') {
  assert(project, 'Project missing');
  const target = TARGETS[reviewed.projectId];
  assert(target, 'Project outside the two-project pilot');
  assert.equal(String(project._id), reviewed.projectId);
  assert.equal(project.path, '/' + target.relativeRoot);
  assert.equal(reviewed.relativeRoot, target.relativeRoot);
  assert.equal(reviewed.hpcPath, '/tsl/data/reads/' + target.relativeRoot);
  assert.equal(reviewed.migrationId, target.migrationId);
  assert.equal(project.storage.state, expectedState);
  assert.equal(project.archiveMigration.phase, expectedState === 'aws' ? 'completed' : 'verified');
  assert.equal(project.archiveMigration.sourceRoot, ROOT + '/' + target.relativeRoot);
  assert.equal(project.archiveMigration.sourceRelativeRoot, target.relativeRoot);
  assert.equal(String(project.archiveMigration.id), target.migrationId);
  assert.equal(project.storage.s3Uri, reviewed.s3Uri);
  assert.equal(project.storage.s3VerifiedAt.toISOString(), reviewed.s3VerifiedAt);
  for (const key of ['sourceSha256', 'verificationSha256']) {
    assert.equal(project.archiveMigration.manifests[key], reviewed[key]);
  }
  assert.equal(project.archiveMigration.manifests.fileCount, reviewed.fileCount);
  assert.equal(project.archiveMigration.manifests.totalBytes, reviewed.bytes);
  assert.deepEqual(resolveHpcPreservation(project), { until: null, active: false, invalid: false },
    'Pilot keep date changed or is invalid; investigate before finalizing');
}

function unchangedProjectFields(project) {
  const result = plain(project);
  delete result.updatedAt; // Mongoose updates this alongside the native transition.
  for (const key of ['state', 'hpcVerifiedAbsentAt', 'archivedAt']) delete result.storage[key];
  for (const key of ['phase', 'confirmedAbsentBy', 'updatedAt']) delete result.archiveMigration[key];
  return result;
}

async function command(aws, projectId, label, args) {
  let stdout = '', stderr = '';
  const exitCode = await cli.runCli(args, { ...c, aws, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  const receipt = { at: new Date().toISOString(), projectId, args, exitCode, stdout, stderr };
  save(projectId + '-' + label + '.json', receipt);
  commands.push(receipt);
  assert.equal(exitCode, 0, stderr || 'Native command failed');
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

(async () => {
  assert.deepEqual(process.argv.slice(2), ['--execute-reported-deletion']);
  assert.equal(os.hostname().split('.')[0], 'v1333');
  assert.equal(os.userInfo().username, 'deeks');
  process.umask(0o077);
  const startedAt = new Date().toISOString();
  const rawPlan = fs.readFileSync(PLAN);
  assert.equal(sha(rawPlan), PLAN_SHA256, 'Sealed pilot plan differs');
  const plan = JSON.parse(rawPlan);
  assert.equal(plan.kind, 'komondor-reviewed-hpc-deletion-v1');
  assert.equal(plan.stage, 'pilot-2');
  assert.equal(plan.releaseStatus, 'ready-for-user-submission');
  assert.equal(plan.projects.length, 2);
  assert.deepEqual(plan.projects.map(p => p.projectId).sort(), Object.keys(TARGETS).sort());
  assert.deepEqual(Object.fromEntries(plan.held.map(p => [p.projectId, p.relativeRoot])), HELD);
  assert.equal(plan.projects.reduce((total, p) => total + p.bytes, 0), reportedSlurm.reportedDeletedBytes);
  // The six-hour deletion window is retained as evidence. Confirmation proves
  // current absence and uses native fences; it does not authorize another rm.
  pack = '/storage/komondor-slurm-pilot-confirm-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  fs.mkdirSync(pack, { mode: 0o700 });
  saveBytes('pilot-deletion-plan.json', rawPlan);
  saveBytes('confirm-pilot.cjs', fs.readFileSync(__filename));
  save('reported-slurm.json', { at: startedAt, ...reportedSlurm });
  c = await connect();
  assert.equal(c.toolVersion, plan.apiHead, 'API checkout changed since native deletion review');
  assert.equal(c.config.datastoreRoot, ROOT);
  const user = await c.models.User.findOne({ username: 'deeks' }).lean();
  assert(user); assert.equal(user.name, 'George Deeks');
  const aws = createAws(c.config);
  const baseline = [];
  for (const reviewed of plan.projects) {
    const project = await c.models.Project.collection.findOne({ _id: new c.mongoose.Types.ObjectId(reviewed.projectId) });
    checkProject(project, reviewed);
    const database = await collectProjectDatabase(c.models, reviewed.projectId);
    assert.deepEqual(counts(database), TARGETS[reviewed.projectId].counts);
    assert.deepEqual(collectHardBlockers(database), []);
    baseline.push({ reviewed, project, database });
  }
  save('before.json', { at: startedAt, apiHead: c.toolVersion, observations: mountAndAbsences(),
    operator: { username: user.username, name: user.name }, projects: baseline,
    reportedSlurm, remaining167Released: false });

  // Load the native sealed source/verification controls and dry-run BOTH
  // Projects before allowing either native database transition.
  for (const { reviewed, project } of baseline) {
    const source = await cli.loadSourceManifest({ ...c, aws }, project);
    const verification = await cli.loadVerificationReport({ ...c, aws }, project);
    assert.equal(sha(source.bytes), reviewed.sourceSha256);
    assert.equal(sha(verification.bytes), reviewed.verificationSha256);
    saveBytes(reviewed.projectId + '-source-manifest.json', source.bytes);
    saveBytes(reviewed.projectId + '-verification.json', verification.bytes);
    mountAndAbsences();
    const dry = await command(aws, reviewed.projectId, 'dry-run',
      ['confirm-absent', '--project-id', reviewed.projectId, '--confirmed-by', 'deeks']);
    assert.equal(dry.command, 'confirm-absent');
    assert.equal(dry.would, 'finalize project as aws');
    assert.equal(String(dry.migrationId), reviewed.migrationId);
  }
  save('both-dry-runs-passed.json', { at: new Date().toISOString(), projectIds: Object.keys(TARGETS), observations: mountAndAbsences() });

  const results = [];
  for (const { reviewed, project: before, database: databaseBefore } of baseline) {
    const current = await c.models.Project.collection.findOne({ _id: before._id });
    checkProject(current, reviewed);
    assert.deepEqual(plain(current), plain(before), 'Project changed since preflight');
    assert.deepEqual(plain(await collectProjectDatabase(c.models, reviewed.projectId)), plain(databaseBefore), 'Associated records changed since preflight');
    mountAndAbsences();
    const executed = await command(aws, reviewed.projectId, 'confirmation',
      ['confirm-absent', '--project-id', reviewed.projectId, '--confirmed-by', 'deeks', '--execute']);
    assert.equal(executed.command, 'confirm-absent');
    assert.equal(executed.state, 'aws');
    assert.equal(executed.phase, 'completed');
    assert.equal(String(executed.migrationId), reviewed.migrationId);
    confirmed.push(reviewed.projectId);
    const status = await command(aws, reviewed.projectId, 'status', ['status', '--project-id', reviewed.projectId, '--json']);
    assert.equal(status.state, 'aws'); assert.equal(status.phase, 'completed'); assert.equal(status.hpcExists, false);
    const after = await c.models.Project.collection.findOne({ _id: before._id });
    const databaseAfter = await collectProjectDatabase(c.models, reviewed.projectId);
    save(reviewed.projectId + '-after.json', { at: new Date().toISOString(), project: after, database: databaseAfter });
    checkProject(after, reviewed, 'aws');
    assert.equal(after.archiveMigration.confirmedAbsentBy, 'deeks');
    assert(after.storage.hpcVerifiedAbsentAt instanceof Date);
    assert(after.storage.hpcVerifiedAbsentAt.getTime() >= new Date(startedAt).getTime());
    assert.equal(after.storage.archivedAt.toISOString(), after.storage.hpcVerifiedAbsentAt.toISOString());
    assert.deepEqual(unchangedProjectFields(after), unchangedProjectFields(before), 'Unexpected Project fields changed');
    assert.deepEqual(plain(databaseAfter), plain(databaseBefore), 'Associated database records changed');
    const locations = await projectStorageLocations(after, { datastoreRoot: ROOT, readsRoot: '/tsl/data/reads' });
    assert.equal(locations.hpc.status, 'absent'); assert.equal(locations.aws.status, 'verified');
    assert.equal(locations.hpc.uri, reviewed.hpcPath); assert.equal(locations.aws.uri, reviewed.s3Uri);
    results.push({ projectId: reviewed.projectId, name: after.name, migrationId: reviewed.migrationId,
      storage: after.storage, phase: after.archiveMigration.phase, locations, counts: counts(databaseAfter),
      associatedRecordsUnchanged: true, s3VerifiedAtUnchanged: true, onlyNativeConfirmationFieldsChanged: true });
  }
  const result = { at: new Date().toISOString(), operator: 'deeks', apiHead: c.toolVersion,
    planSha256: PLAN_SHA256, observations: mountAndAbsences(), projects: results,
    reportedSlurm, serverEvidence: pack, remaining167Released: false, commands };
  save('completed.json', result);
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  if (pack) {
    try { save('failure.json', { at: new Date().toISOString(), error: error.stack, confirmedProjects: confirmed, commands, remaining167Released: false }); }
    catch (saveError) { console.error('Could not save failure receipt: ' + saveError.message); }
  }
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => { if (c) await c.mongoose.disconnect(); });
