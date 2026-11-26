'use strict';

// Read-only observer. No model imports, network requests, writes or payload hashing.
// A passing metadata comparison is NOT a fresh checksum verification.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const subset = (parent, entry) => entry === parent || entry.startsWith(parent + '/');
const metadata = stat => ({
  type: stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'special',
  size: stat.size, dev: stat.dev, ino: stat.ino, nlink: stat.nlink,
  mode: stat.mode, uid: stat.uid, gid: stat.gid,
  mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
});

function relative(value) {
  assert.equal(typeof value, 'string');
  const rel = value.replace(/^\//, '');
  assert(rel && !path.isAbsolute(rel) && rel.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe relative path');
  return rel;
}

async function inspectFilesystem(scope, {root = '/mnt/reads', pack = '/storage/komondor-archive-batch-20261023'} = {}) {
  assert.equal(scope.matches.length, 12, 'Only the reviewed twelve-sample scope is supported');
  assert.equal(scope.sourceProjects.length, 4);
  assert.equal(new Set(scope.matches.map(m => m.sample._id)).size, 12);
  assert.equal(new Set(scope.matches.map(m => m.sample.safeName)).size, 12, 'Destination sample names must be unique');
  assert.equal(new Set(scope.sourceProjects.map(p => p._id)).size, 4);
  assert(!scope.sourceProjects.some(p => p._id === scope.targetProject._id || p.path === scope.targetProject.path));
  root = path.resolve(root);
  pack = path.resolve(pack);
  const result = {
    startedAt: new Date().toISOString(), root, pack,
    payloadChecksumsRecomputed: false, snapshotIsAtomic: false,
    roots: [], manifests: [], samples: [], issues: [], warnings: [],
  };
  const issue = (code, detail) => result.issues.push({code, ...detail});
  const warn = (code, detail) => result.warnings.push({code, ...detail});
  const absolute = rel => {
    const resolved = path.resolve(root, relative(rel));
    assert(inside(root, resolved));
    return resolved;
  };

  // Reject symlinks in every component below the explicit mount root. Missing
  // final paths are recorded, not created. A symlink at the root also refuses.
  async function inspectPath(filename) {
    assert(inside(root, filename));
    let current = root;
    const components = path.relative(root, filename).split(path.sep).filter(Boolean);
    for (let index = -1; index < components.length; index++) {
      if (index >= 0) current = path.join(current, components[index]);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if (error.code === 'ENOENT') return {path: filename, exists: false, missingAt: current};
        return {path: filename, exists: null, error: error.code || error.message, failedAt: current};
      }
      if (stat.isSymbolicLink()) return {path: filename, exists: true, unsafe: 'symlink-component', failedAt: current};
      if (index < components.length - 1 && !stat.isDirectory()) return {path: filename, exists: true, unsafe: 'non-directory-component', failedAt: current};
      if (current === filename) return {path: filename, exists: true, canonicalPath: await fs.realpath(filename), ...metadata(stat)};
    }
    throw new Error('Unreachable path inspection');
  }

  for (const project of [...scope.sourceProjects, scope.targetProject]) {
    const observed = await inspectPath(absolute(project.path));
    result.roots.push({projectId: project._id, destination: project._id === scope.targetProject._id, ...observed});
    if (observed.exists !== true || observed.unsafe || observed.type !== 'dir') issue('project-root-unavailable-or-unsafe', {projectId: project._id, observed});
  }

  const targetRoot = absolute(scope.targetProject.path);
  const safeTarget = result.roots.find(r => r.projectId === scope.targetProject._id);
  if (safeTarget.exists === true && !safeTarget.unsafe && safeTarget.type === 'dir') {
    try {
      const stat = await fs.statfs(targetRoot, {bigint: true});
      result.capacity = {
        path: targetRoot, availableBytes: (stat.bavail * stat.bsize).toString(),
        freeBytes: (stat.bfree * stat.bsize).toString(), blockSize: stat.bsize.toString(),
        availableInodes: stat.ffree.toString(),
        limitation: 'Filesystem availability only; user/group quotas and concurrent allocations are not established.',
      };
      result.destinationChildren = (await fs.readdir(targetRoot)).sort();
    } catch (error) { issue('destination-capacity-inspection-failed', {error: error.code || error.message}); }
  }

  const manifests = new Map();
  for (const project of scope.sourceProjects) {
    const directory = path.join(pack, 'copies', project._id);
    assert(/^[a-f0-9]{24}$/.test(project._id));
    try {
      const [sourceBytes, verificationBytes, receiptBytes] = await Promise.all([
        fs.readFile(path.join(directory, 'source-manifest.json')),
        fs.readFile(path.join(directory, 'verification-report.json')),
        fs.readFile(path.join(directory, 'complete.json')),
      ]);
      const source = JSON.parse(sourceBytes), verification = JSON.parse(verificationBytes), receipt = JSON.parse(receiptBytes);
      const expected = project.archiveMigration;
      const observed = {projectId: project._id, sourceSha256: sha256(sourceBytes), verificationSha256: sha256(verificationBytes), receiptSha256: sha256(receiptBytes)};
      assert.equal(observed.sourceSha256, expected.manifests.sourceSha256);
      assert.equal(observed.verificationSha256, expected.manifests.verificationSha256);
      assert.equal(source.kind, 'source');
      assert.equal(verification.kind, 'verification');
      for (const item of [source, verification, receipt]) {
        assert.equal(item.projectId, project._id);
        assert.equal(item.migrationId, expected.id);
      }
      assert.equal(source.sourceRelativeRoot, relative(project.path));
      assert.equal(source.sourceRoot, expected.sourceRoot);
      assert.equal(source.dataPrefix, project.storage.s3Uri);
      assert.equal(verification.sourceManifestSha256, observed.sourceSha256);
      assert.equal(verification.verified, true);
      assert.equal(verification.keySet.matches, true);
      assert.equal(verification.localTree.matches, true);
      assert.equal(receipt.sourceSha256, observed.sourceSha256);
      assert.equal(receipt.verificationSha256, observed.verificationSha256);
      assert.equal(receipt.s3VerifiedAt, project.storage.s3VerifiedAt);
      assert.equal(receipt.s3Uri, project.storage.s3Uri);
      assert.equal(receipt.files, expected.manifests.fileCount);
      assert.equal(receipt.bytes, expected.manifests.totalBytes);
      assert.equal(receipt.hpcPath || source.sourceRoot, source.sourceRoot);
      assert.equal(source.summary.regularFiles, receipt.files);
      assert.equal(source.summary.totalBytes, receipt.bytes);
      assert.equal(new Set(source.entries.map(e => relative(e.relPath))).size, source.entries.length);
      manifests.set(project._id, {source, verification});
      result.manifests.push({...observed, identityAndDigestsMatch: true, historicalVerifiedAt: receipt.s3VerifiedAt});
    } catch (error) {
      issue('sealed-evidence-invalid-or-unavailable', {projectId: project._id, error: error.message});
    }
  }

  async function walk(filename, projectRoot, rows) {
    const stat = await fs.lstat(filename);
    const row = {relPath: path.relative(projectRoot, filename).split(path.sep).join('/'), ...metadata(stat)};
    rows.push(row);
    if (row.type === 'symlink') {
      row.linkTarget = await fs.readlink(filename);
      issue('symlink-in-selected-tree', {path: filename});
    } else if (row.type === 'special') issue('special-file-in-selected-tree', {path: filename});
    else if (row.type === 'dir') {
      const children = (await fs.readdir(filename)).sort();
      for (const child of children) await walk(path.join(filename, child), projectRoot, rows);
      const after = metadata(await fs.lstat(filename));
      if (after.dev !== row.dev || after.ino !== row.ino || after.mtimeMs !== row.mtimeMs || after.ctimeMs !== row.ctimeMs) issue('directory-changed-during-observation', {path: filename});
    } else {
      try { await fs.access(filename, require('node:fs').constants.R_OK); row.readableByObserver = true; }
      catch (error) { row.readableByObserver = false; issue('file-not-readable-by-observer', {path: filename, error: error.code}); }
      if (row.nlink > 1) warn('source-file-has-multiple-hardlinks', {path: filename, nlink: row.nlink});
    }
  }

  for (const match of scope.matches) {
    const project = scope.sourceProjects.find(p => p._id === match.sample.project);
    assert(project, 'Unknown source project');
    const projectRoot = absolute(project.path);
    const sourcePath = absolute(match.sample.path);
    assert(inside(projectRoot, sourcePath) && sourcePath !== projectRoot);
    const sampleRelative = path.relative(projectRoot, sourcePath).split(path.sep).join('/');
    assert.equal(sampleRelative, match.sample.safeName);
    const destinationPath = path.join(targetRoot, sampleRelative);
    const item = {sampleId: match.sample._id, projectId: project._id, sourcePath, destinationPath, entries: [], differences: []};
    result.samples.push(item);
    item.source = await inspectPath(sourcePath);
    item.destination = await inspectPath(destinationPath);
    if (item.destination.exists !== false || item.destination.error || item.destination.unsafe) issue('destination-sample-collision-or-inaccessible', {sampleId: item.sampleId, observed: item.destination});
    if (item.source.exists !== true || item.source.unsafe || item.source.type !== 'dir') {
      issue('source-sample-unavailable-or-unsafe', {sampleId: item.sampleId, observed: item.source});
      continue;
    }
    try { await walk(sourcePath, projectRoot, item.entries); }
    catch (error) { issue('source-tree-observation-failed', {sampleId: item.sampleId, error: error.code || error.message}); }
    item.files = item.entries.filter(e => e.type === 'file').length;
    item.bytes = item.entries.filter(e => e.type === 'file').reduce((sum, e) => sum + e.size, 0);
    const sealed = manifests.get(project._id);
    if (!sealed) continue;
    const expected = sealed.source.entries.filter(e => subset(sampleRelative, e.relPath));
    item.manifestEntries = expected.map(e => ({...e, db: e.db ? {kind: e.db.kind, id: e.db.id, fileId: e.db.fileId} : null}));
    item.verificationEntries = sealed.verification.entries.filter(e => subset(sampleRelative, e.relPath));
    const expectedMap = new Map(expected.map(e => [e.relPath, e]));
    const observedMap = new Map(item.entries.map(e => [e.relPath, e]));
    const sameMountPath = sealed.source.sourceRoot === projectRoot;
    item.deviceAndInodeCompared = sameMountPath;
    if (!sameMountPath) warn('device-and-inode-not-compared-different-mount-path', {projectId: project._id, manifestRoot: sealed.source.sourceRoot, observedRoot: projectRoot});
    for (const actual of item.entries) {
      const old = expectedMap.get(actual.relPath);
      if (!old) { item.differences.push({relPath: actual.relPath, field: 'presence', expected: 'absent', observed: 'present'}); continue; }
      const fields = ['type', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs'];
      if (actual.type === 'file') fields.push('size');
      if (sameMountPath) fields.push('dev', 'ino');
      for (const field of fields) {
        const equal = field.endsWith('Ms') ? Math.abs(actual[field] - old[field]) <= 1 : actual[field] === old[field];
        if (!equal) item.differences.push({relPath: actual.relPath, field, expected: old[field], observed: actual[field]});
      }
      if (actual.type === 'file' && (old.disposition !== 'copy' || !/^[a-f0-9]{64}$/.test(old.sha256 || '') || typeof old.crc64nvme !== 'string')) item.differences.push({relPath: actual.relPath, field: 'sealed-payload-checksums', expected: 'copy entry with SHA-256 and CRC64NVME', observed: 'missing or excluded'});
      if (actual.type === 'file') {
        const verified = item.verificationEntries.filter(e => e.relPath === old.relPath);
        if (verified.length !== 1 || verified[0].verified !== true || verified[0].contentLength !== old.size || verified[0].checksumCRC64NVME !== old.crc64nvme) item.differences.push({relPath: actual.relPath, field: 'historical-object-verification', expected: 'one matching verified entry', observed: 'missing, ambiguous or inconsistent'});
      }
    }
    for (const old of expected) if (!observedMap.has(old.relPath)) item.differences.push({relPath: old.relPath, field: 'presence', expected: 'present', observed: 'absent'});
    if (!expected.length) item.differences.push({field: 'manifest-subset', expected: 'nonempty', observed: 'empty'});
    if (item.differences.length) issue('selected-tree-differs-from-sealed-metadata', {sampleId: item.sampleId, differenceCount: item.differences.length});
  }
  result.summary = {
    sourceProjects: scope.sourceProjects.length, samples: result.samples.length,
    files: result.samples.reduce((sum, item) => sum + (item.files || 0), 0),
    bytes: result.samples.reduce((sum, item) => sum + (item.bytes || 0), 0),
    sealedEvidenceSetsVerified: result.manifests.length,
    destinationSampleCollisions: result.samples.filter(item => item.destination.exists === true).length,
    issueCount: result.issues.length, warningCount: result.warnings.length,
  };
  if (result.capacity) {
    result.capacity.selectedCopyBytes = result.summary.bytes;
    result.capacity.exceedsSelectedCopyBytes = BigInt(result.capacity.availableBytes) > BigInt(result.summary.bytes);
    if (!result.capacity.exceedsSelectedCopyBytes) issue('insufficient-observed-free-space', {requiredBytes: result.summary.bytes, availableBytes: result.capacity.availableBytes});
  }
  result.summary.issueCount = result.issues.length;
  result.completedAt = new Date().toISOString();
  result.ok = result.issues.length === 0;
  return result;
}

module.exports = {inspectFilesystem};
