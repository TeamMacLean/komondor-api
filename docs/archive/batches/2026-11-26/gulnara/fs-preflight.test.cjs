'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {inspectFilesystem} = require('./fs-preflight.cjs');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const statRow = async (filename, relPath) => {
  const s = await fs.lstat(filename);
  return {relPath, type: s.isDirectory() ? 'dir' : 'file', size: s.size, dev: s.dev, ino: s.ino, nlink: s.nlink, mode: s.mode, uid: s.uid, gid: s.gid, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs};
};

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gulnara-fs-preflight-'));
  try {
    const root = path.join(temporary, 'reads'), pack = path.join(temporary, 'pack');
    const scope = {targetProject: {_id: 'ffffffffffffffffffffffff', path: '/group/destination'}, sourceProjects: [], matches: []};
    await fs.mkdir(path.join(root, 'group/destination'), {recursive: true});
    for (let p = 1; p <= 4; p++) {
      const id = String(p).padStart(24, '0'), migration = String(100 + p).padStart(24, '0');
      const projectPath = '/group/project' + p, sourceRoot = path.join(root, projectPath.slice(1));
      const source = {kind: 'source', projectId: id, migrationId: migration, sourceRelativeRoot: projectPath.slice(1), sourceRoot, dataPrefix: 's3://fixture' + projectPath, entries: [], summary: {regularFiles: 0, totalBytes: 0}};
      const verification = {kind: 'verification', projectId: id, migrationId: migration, verified: true, keySet: {matches: true}, localTree: {matches: true}, entries: []};
      for (let s = 1; s <= 3; s++) {
        const safeName = 'sample' + p + '_' + s, samplePath = projectPath + '/' + safeName;
        const directory = path.join(root, samplePath.slice(1));
        await fs.mkdir(directory, {recursive: true});
        const payload = Buffer.from(`payload ${p}/${s}`), file = path.join(directory, 'reads.fastq.gz');
        await fs.writeFile(file, payload);
        source.entries.push(await statRow(directory, safeName));
        source.entries.push({...await statRow(file, safeName + '/reads.fastq.gz'), disposition: 'copy', sha256: sha(payload), crc64nvme: 'fixtureCRC', s3Key: projectPath.slice(1) + '/' + safeName + '/reads.fastq.gz'});
        source.summary.regularFiles++;
        source.summary.totalBytes += payload.length;
        verification.entries.push({relPath: safeName + '/reads.fastq.gz', contentLength: payload.length, checksumCRC64NVME: 'fixtureCRC', verified: true});
        scope.matches.push({sample: {_id: String(p * 10 + s).padStart(24, '0'), project: id, path: samplePath, safeName}});
      }
      const sourceBytes = Buffer.from(JSON.stringify(source));
      verification.sourceManifestSha256 = sha(sourceBytes);
      const verificationBytes = Buffer.from(JSON.stringify(verification));
      const verifiedAt = '2026-10-27T00:00:00.000Z';
      const project = {_id: id, path: projectPath, storage: {s3Uri: source.dataPrefix, s3VerifiedAt: verifiedAt}, archiveMigration: {id: migration, sourceRoot, manifests: {sourceSha256: sha(sourceBytes), verificationSha256: sha(verificationBytes), fileCount: source.summary.regularFiles, totalBytes: source.summary.totalBytes}}};
      scope.sourceProjects.push(project);
      const copies = path.join(pack, 'copies', id);
      await fs.mkdir(copies, {recursive: true});
      await fs.writeFile(path.join(copies, 'source-manifest.json'), sourceBytes);
      await fs.writeFile(path.join(copies, 'verification-report.json'), verificationBytes);
      await fs.writeFile(path.join(copies, 'complete.json'), JSON.stringify({projectId: id, migrationId: migration, s3Uri: source.dataPrefix, s3VerifiedAt: verifiedAt, sourceSha256: sha(sourceBytes), verificationSha256: sha(verificationBytes), files: source.summary.regularFiles, bytes: source.summary.totalBytes}));
    }
    const before = await fs.readFile(path.join(pack, 'copies', scope.sourceProjects[0]._id, 'source-manifest.json'));
    let result = await inspectFilesystem(scope, {root, pack});
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.summary.samples, 12);
    assert.equal(result.summary.files, 12);
    assert.equal(result.summary.sealedEvidenceSetsVerified, 4);
    assert.equal(result.payloadChecksumsRecomputed, false);
    assert.deepEqual(await fs.readFile(path.join(pack, 'copies', scope.sourceProjects[0]._id, 'source-manifest.json')), before);

    const collision = path.join(root, 'group/destination/sample1_1');
    await fs.mkdir(collision);
    result = await inspectFilesystem(scope, {root, pack});
    assert.equal(result.ok, false);
    assert(result.issues.some(i => i.code === 'destination-sample-collision-or-inaccessible'));
    await fs.rmdir(collision);

    const changed = path.join(root, scope.matches[0].sample.path.slice(1), 'reads.fastq.gz');
    await fs.appendFile(changed, 'changed');
    result = await inspectFilesystem(scope, {root, pack});
    assert(result.issues.some(i => i.code === 'selected-tree-differs-from-sealed-metadata'));
    assert(result.samples[0].differences.some(d => d.field === 'size'));

    const symbolic = path.join(root, scope.matches[1].sample.path.slice(1), 'escape');
    await fs.symlink(temporary, symbolic);
    result = await inspectFilesystem(scope, {root, pack});
    assert(result.issues.some(i => i.code === 'symlink-in-selected-tree'));
    assert.equal(result.samples[1].entries.filter(e => e.relPath.startsWith('sample1_2/escape/')).length, 0);

    const evidenceFile = path.join(pack, 'copies', scope.sourceProjects[0]._id, 'source-manifest.json');
    await fs.appendFile(evidenceFile, ' ');
    result = await inspectFilesystem(scope, {root, pack});
    assert(result.issues.some(i => i.code === 'sealed-evidence-invalid-or-unavailable'));

    await fs.rm(path.join(root, scope.matches[2].sample.path.slice(1)), {recursive: true});
    result = await inspectFilesystem(scope, {root, pack});
    assert(result.issues.some(i => i.code === 'source-sample-unavailable-or-unsafe'));
    console.log('PASS: matching metadata/evidence, destination collision, changed payload metadata, symlink refusal, tampered evidence, missing source; no payload hash claims.');
  } finally { await fs.rm(temporary, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
