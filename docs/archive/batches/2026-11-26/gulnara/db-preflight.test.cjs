'use strict';
// In-memory, query-only contract tests. No MongoDB, SSH, filesystem mutation or
// application models are used. This does not replace the live preflight.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { collectDatabase } = require('./db-preflight.cjs');
const fullScope = JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../../../evidence/release-planning-20261030/gulnara-scope.json'), 'utf8'));
const match = fullScope.matches[0];
const scope = { ...fullScope, matches: [match],
  sourceProjects: fullScope.sourceProjects.filter(p => p._id === match.sample.project) };
const clone = value => JSON.parse(JSON.stringify(value));
const fixtureId = n => '7000000000000000000000' + n.toString(16).padStart(2, '0');
class ObjectId { constructor(value) { this.value = value; } toString() { return this.value; } }
const equalId = (a, b) => String(a) === String(b);

function matches(row, filter) {
  if (filter.$or && !filter.$or.some(child => matches(row, child))) return false;
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return true;
    if (value instanceof RegExp) return typeof row[key] === 'string' && value.test(row[key]);
    if (value && value.$in) return value.$in.some(expected => equalId(row[key], expected));
    return equalId(row[key], value);
  });
}

function fixture(change, beforeQuery) {
  const rows = {
    projects: clone([...scope.sourceProjects, scope.targetProject]),
    samples: [clone(match.sample)], runs: clone(match.runs),
    reads: [{ _id: fixtureId(1), run: match.runs[0]._id, file: fixtureId(2) }],
    files: [{ _id: fixtureId(2), path: match.runs[0].path + '/raw/r1.fastq.gz' }],
    additionalfiles: [], ingestjobs: [],
  };
  if (change) change(rows);
  const counts = {};
  const calls = [];
  // Deliberately expose no write methods; any attempted write would throw.
  const db = { databaseName: 'query-only-fixture', collection(name) {
    return { find(filter) {
      calls.push({ method: 'find', collection: name });
      return { maxTimeMS(ms) { assert.equal(ms, 30000); return this; }, async toArray() {
        counts[name] = (counts[name] || 0) + 1;
        if (beforeQuery) beforeQuery(rows, name, counts[name]);
        return clone((rows[name] || []).filter(row => matches(row, filter)));
      } };
    } };
  }, admin() { return { async command(command) {
    assert.deepEqual(command, { isMaster: 1 });
    calls.push({ method: 'isMaster' });
    return { ismaster: true };
  } }; } };
  return { run: () => collectDatabase(db, scope, ObjectId), calls };
}

async function detects(kind, change, beforeQuery) {
  const result = await fixture(change, beforeQuery).run();
  assert.ok(result.issues.some(issue => issue.kind === kind), JSON.stringify(result.issues));
}

test('valid graph produces exact path mappings using only find/isMaster', async () => {
  const f = fixture();
  const got = await f.run();
  assert.deepEqual(got.issues, []);
  assert.equal(got.summary.proposedPathUpdates, 3);
  assert.equal(got.mappings.find(m => m.collection === 'files').newPath,
    scope.targetProject.path + '/' + match.sample.safeName + '/' + match.runs[0].safeName + '/raw/r1.fastq.gz');
  assert.equal(got.topology.setName, null);
  assert.equal(got.observationIsTransactionSnapshot, false);
  assert.ok(f.calls.every(call => ['find', 'isMaster'].includes(call.method)));
});

test('missing Read.file is not silently omitted', () => detects('missing-or-invalid-file-reference', rows => { delete rows.reads[0].file; }));
test('missing AdditionalFile.file is not silently omitted', () => detects('missing-or-invalid-file-reference', rows => {
  rows.additionalfiles.push({ _id: fixtureId(3), sample: match.sample._id });
}));
test('missing linked File document is detected', () => detects('missing-linked-file', rows => { rows.files = []; }));
test('unexpected run under selected sample is detected', () => detects('run-coverage-changed', rows => {
  rows.runs.push({ ...rows.runs[0], _id: fixtureId(4), name: 'extra', path: match.sample.path + '/extra' });
}));
test('foreign Sample inside selected physical tree is detected', () => detects('external-sample-in-selected-tree', rows => {
  rows.samples.push({ _id: fixtureId(5), project: fixtureId(6), name: 'foreign', path: match.sample.path + '/foreign' });
}));
test('foreign Run inside selected physical tree is detected', () => detects('external-run-in-selected-tree', rows => {
  rows.runs.push({ _id: fixtureId(7), sample: fixtureId(8), name: 'foreign', path: match.sample.path + '/foreign-run' });
}));
test('external Read reference to a moving file is detected', () => detects('external-read-reference', rows => {
  rows.reads.push({ _id: fixtureId(9), run: fixtureId(10), file: fixtureId(2) });
}));
test('Project-only AdditionalFile reference to a moving file is detected', () => detects('external-additional-file-reference', rows => {
  rows.additionalfiles.push({ _id: fixtureId(11), project: match.sample.project, file: fixtureId(2) });
}));
test('mixed AdditionalFile parents are detected', () => detects('mixed-additional-parent', rows => {
  rows.additionalfiles.push({ _id: fixtureId(12), project: match.sample.project, sample: match.sample._id, file: fixtureId(2) });
}));
test('destination sample collision is detected', () => detects('target-sample-collision', rows => {
  rows.samples.push({ ...rows.samples[0], _id: fixtureId(13), project: scope.targetProject._id,
    path: scope.targetProject.path + '/' + match.sample.safeName });
}));
test('active selected run is detected', () => detects('run-active', rows => { rows.runs[0].status = 'processing'; }));
test('active checksum worker is detected', () => detects('run-md5-active', rows => { rows.runs[0].md5VerificationStatus = 'in_progress'; }));
test('pending ingest job is detected', () => detects('active-ingest-job', rows => {
  rows.ingestjobs.push({ _id: fixtureId(14), runId: match.runs[0]._id, status: 'pending' });
}));
test('valid File identity pin is retained for planning', async () => {
  const got = await fixture(rows => {
    rows.files[0].reconciliation = { version: 1, operationId: 'previous-correction', identity: { path: rows.files[0].path } };
    rows.files[0].reconciliationHistory = [{ operationId: 'previous-correction' }];
  }).run();
  assert.deepEqual(got.issues, []);
  assert.equal(got.pins.length, 1);
  assert.equal(got.pins[0].historyEntries, 1);
});
test('malformed reconciliation state is detected', () => detects('malformed-reconciliation-state', rows => {
  rows.samples[0].reconciliation = { version: 999, operationId: null, identity: { path: match.sample.path } };
}));
test('disagreeing pin is detected', () => detects('pinned-identity-mismatch', rows => {
  rows.files[0].reconciliation = { version: 1, operationId: 'old', identity: { path: '/different' } };
}));
test('partial archive evidence on HPC destination is detected', () => detects('target-has-unexpected-archive-evidence', rows => {
  rows.projects[1].storage.s3Uri = 's3://unexpected/target';
}));
test('invalid source verification date yields an issue rather than throwing', () => detects('archive-verification-changed', rows => {
  rows.projects[0].storage.s3VerifiedAt = 'not-a-date';
}));
test('deleted document during observation yields drift rather than throwing', () => detects('changed-during-observation', null,
  (rows, name, count) => { if (name === 'files' && count === 2) rows.files = []; }));
test('modified document during observation is detected', () => detects('changed-during-observation', null,
  (rows, name, count) => { if (name === 'samples' && count === 2) rows.samples[0].name = 'changed'; }));
