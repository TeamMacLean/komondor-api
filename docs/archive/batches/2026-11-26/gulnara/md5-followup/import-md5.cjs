"use strict";
// Scoped checksum metadata import only. No models, queue, email or storage writes.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  os = require("node:os");
const TARGET = "6ae4ac89a6b876c643741d27",
  PACK = "/storage/komondor-gulnara-md5-20261126-01",
  API = "/storage/www/komondor-api";
const TYPED = {
  promoteValues: false,
  promoteLongs: false,
  promoteBuffers: false,
};
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex"),
  json = (x) => Buffer.from(JSON.stringify(x, null, 2) + "\n"),
  id = (x) => String(x?._id || x);
const plain = (x) => x && Object.getPrototypeOf(x) === Object.prototype;
const ordered = (x) =>
  Array.isArray(x)
    ? x.map(ordered)
    : plain(x)
    ? Object.fromEntries(
        Object.keys(x)
          .sort()
          .map((k) => [k, ordered(x[k])])
      )
    : x;
const md5 = (x) => typeof x === "string" && /^[a-f0-9]{32}$/.test(x),
  digest = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const relative = (x) =>
  typeof x === "string" &&
  !path.isAbsolute(x) &&
  x.split("/").every((k) => k && k !== "." && k !== "..");
function regular(filename) {
  assert(path.isAbsolute(filename));
  let here = path.parse(filename).root;
  for (const part of filename.slice(here.length).split(path.sep)) {
    here = path.join(here, part);
    const s = fs.lstatSync(here);
    assert(!s.isSymbolicLink(), "Symlink evidence or payload path");
    if (here !== filename) assert(s.isDirectory());
  }
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  );
  try {
    assert(fs.fstatSync(fd).isFile());
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function writeOnce(filename, value) {
  const fd = fs.openSync(filename, "wx", 0o640);
  try {
    fs.fchmodSync(fd, 0o640);
    fs.writeFileSync(fd, Buffer.isBuffer(value) ? value : json(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(filename), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
function metadata(filename) {
  let here = path.parse(filename).root;
  assert(path.isAbsolute(filename) && path.normalize(filename) === filename);
  for (const part of filename.slice(here.length).split(path.sep)) {
    here = path.join(here, part);
    const s = fs.lstatSync(here);
    assert(!s.isSymbolicLink());
    if (here !== filename) assert(s.isDirectory());
  }
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  );
  try {
    const s = fs.fstatSync(fd, { bigint: true });
    assert(s.isFile());
    return Object.fromEntries(
      ["dev", "ino", "mode", "nlink", "uid", "gid", "size"]
        .map((k) => [k, s[k].toString()])
        .concat([
          ["mtime_ns", s.mtimeNs.toString()],
          ["ctime_ns", s.ctimeNs.toString()],
        ])
    );
  } finally {
    fs.closeSync(fd);
  }
}
function assertMetadata(actual, expected) {
  const fields = [
    "dev",
    "ino",
    "mode",
    "nlink",
    "uid",
    "gid",
    "size",
    "mtime_ns",
    "ctime_ns",
  ];
  assert.deepEqual(Object.keys(expected).sort(), fields.slice().sort());
  for (const k of fields) {
    assert(
      typeof expected[k] === "string" && /^\d+$/.test(expected[k]),
      "Lossy metadata " + k
    );
    assert.equal(actual[k], expected[k], "Payload metadata changed: " + k);
  }
}
function bsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (Buffer.isBuffer(value)) return "binData";
  if (value?._bsontype) {
    const types = {
      ObjectID: "objectId",
      ObjectId: "objectId",
      Int32: "int",
      Long: "long",
      Double: "double",
      Decimal128: "decimal",
      Binary: "binData",
      Timestamp: "timestamp",
      BSONRegExp: "regex",
      MinKey: "minKey",
      MaxKey: "maxKey",
    };
    assert(types[value._bsontype], "Unsupported BSON type");
    return types[value._bsontype];
  }
  if (plain(value)) return "object";
  const t = {
    string: "string",
    boolean: "bool",
    number: "double",
    undefined: "undefined",
  }[typeof value];
  assert(t, "Unsupported BSON value");
  return t;
}
function typedExpression(value, expression) {
  const checks = [{ $eq: [{ $type: expression }, bsonType(value)] }];
  if (plain(value)) {
    checks.push({
      $eq: [
        {
          $map: {
            input: { $objectToArray: expression },
            as: "kv",
            in: "$$kv.k",
          },
        },
        { $literal: Object.keys(value) },
      ],
    });
    for (const [key, child] of Object.entries(value)) {
      const childExpression = {
        $arrayElemAt: [
          {
            $map: {
              input: {
                $filter: {
                  input: { $objectToArray: expression },
                  as: "kv",
                  cond: { $eq: ["$$kv.k", { $literal: key }] },
                },
              },
              as: "kv",
              in: "$$kv.v",
            },
          },
          0,
        ],
      };
      checks.push(typedExpression(child, childExpression));
    }
  } else if (Array.isArray(value)) {
    checks.push({ $eq: [{ $size: expression }, value.length] });
    value.forEach((child, i) =>
      checks.push(typedExpression(child, { $arrayElemAt: [expression, i] }))
    );
  }
  return { $and: checks };
}
function wholeDocumentFilter(before, newFields) {
  return {
    _id: before._id,
    $and: newFields
      .filter((k) => !Object.hasOwn(before, k))
      .map((k) => ({ [k]: { $exists: false } })),
    $expr: {
      $and: [
        { $eq: ["$$ROOT", { $literal: before }] },
        typedExpression(before, "$$ROOT"),
      ],
    },
  };
}
function createImporter({
  db,
  ObjectId,
  BSON,
  bson,
  baseDir,
  workDir,
  input,
  inputSha256,
  statMetadata = metadata,
  readsRoot = "/mnt/reads",
  now = () => new Date(),
  afterWrite,
}) {
  assert(db && bson && ObjectId && BSON);
  assert.equal(input.version, 1);
  assert.equal(input.targetProjectId, TARGET);
  assert(/^[a-f0-9-]{36}$/.test(input.operationId));
  assert(digest(inputSha256));
  assert(path.isAbsolute(baseDir) && path.isAbsolute(workDir));
  const pack = (d) => bson.serialize(d).toString("base64"),
    unpack = (s) => bson.deserialize(Buffer.from(s, "base64"), TYPED),
    same = (a, b) =>
      a != null &&
      b != null &&
      bson.serialize(ordered(a)).equals(bson.serialize(ordered(b)));
  function evidence(key) {
    const ref = input[key];
    assert(ref && relative(ref.file) && digest(ref.sha256));
    const bytes = regular(path.join(baseDir, ref.file));
    assert.equal(sha(bytes), ref.sha256, key + " evidence changed");
    return JSON.parse(bytes);
  }
  const snapshot = evidence("snapshot"),
    review = evidence("sidecarReview"),
    manifest = evidence("copyManifest"),
    proof = evidence("fastqProof"),
    aux = evidence("auxProof");
  assert.equal(snapshot.database, db.databaseName);
  assert.equal(snapshot.kind, "gulnara-md5-initial-snapshot");
  assert.equal(review.projectId, TARGET);
  assert.equal(review.coverageComplete, true);
  assert.deepEqual(review.conflicts, []);
  assert.equal(review.fastqCount, 24);
  assert.equal(review.sidecarCount, 16);
  assert.equal(proof.kind, "gulnara-independent-md5-sha256-completion");
  assert.equal(proof.projectId, TARGET);
  assert.equal(proof.allVerified, true);
  assert.equal(proof.inputSha256, input.sidecarReview.sha256);
  assert.equal(proof.copyManifestSha256, input.copyManifest.sha256);
  assert.equal(proof.fastqCount, 24);
  assert.equal(proof.sidecarCount, 16);
  assert.equal(proof.fastqs.length, 24);
  assert.equal(proof.sidecars.length, 16);
  assert.equal(aux.kind, "gulnara-auxiliary-source-copy-md5-proof");
  assert.equal(aux.projectId, TARGET);
  assert.equal(aux.allVerified, true);
  assert.equal(aux.files.length, 7);
  const baseline = Object.fromEntries(
    Object.entries(snapshot.collections).map(([c, rows]) => [
      c,
      rows.map((r) => {
        const doc = unpack(r.bson);
        assert.equal(id(doc), r.id);
        return doc;
      }),
    ])
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(baseline).map(([c, rows]) => [c, rows.length])
    ),
    {
      projects: 5,
      samples: 12,
      runs: 12,
      reads: 31,
      additionalfiles: 9,
      files: 40,
      ingestjobs: 0,
    }
  );
  const byId = (rows) => new Map(rows.map((r) => [id(r), r])),
    projects = byId(baseline.projects),
    samples = byId(baseline.samples),
    runs = byId(baseline.runs),
    files = byId(baseline.files),
    reads = byId(baseline.reads),
    target = projects.get(TARGET);
  assert(target);
  const storage = target.storage || {};
  assert(
    [undefined, null, "", "hpc"].includes(storage.state),
    "Target is not HPC writable"
  );
  assert(
    !["s3Uri", "s3VerifiedAt", "hpcVerifiedAbsentAt", "archivedAt"].some(
      (k) =>
        storage[k] !== undefined && storage[k] !== null && storage[k] !== ""
    ),
    "Target has conflicting archive evidence"
  );
  const clean = (x) => x.replace(/^\//, ""),
    targetRoot = path.join(readsRoot, clean(target.path));
  assert.equal(path.normalize(targetRoot), targetRoot);
  assert(targetRoot.startsWith(readsRoot + "/"));
  assert.equal(manifest.entries.length, 40);
  assert.equal(manifest.count, 40);
  const manifestMap = new Map(manifest.entries.map((e) => [e.fileId, e]));
  assert.equal(manifestMap.size, 40);
  assert.deepEqual(
    [...new Set(manifest.entries.map((e) => e.projectId))]
      .concat(TARGET)
      .sort(),
    [...projects.keys()].sort()
  );
  for (const sample of samples.values()) {
    assert.equal(id(sample.project), TARGET);
    assert(clean(sample.path).startsWith(clean(target.path) + "/"));
  }
  for (const run of runs.values()) {
    assert(samples.has(id(run.sample)));
    assert(
      clean(run.path).startsWith(clean(samples.get(id(run.sample)).path) + "/")
    );
    assert(
      !Object.hasOwn(run, "status"),
      "Legacy run already has processing state"
    );
    assert(
      !Object.keys(run).some((k) => /^md5/i.test(k)),
      "Legacy run already has MD5 state"
    );
  }
  const fileToRead = new Map();
  for (const read of reads.values()) {
    assert(runs.has(id(read.run)));
    assert(!fileToRead.has(id(read.file)));
    fileToRead.set(id(read.file), read);
    for (const k of ["MD5", "destinationMd5", "md5Mismatch", "MD5LastChecked"])
      assert(!Object.hasOwn(read, k), "Existing Read checksum state");
  }
  assert.equal(fileToRead.size, 31);
  const additionalFileIds = new Set(
    baseline.additionalfiles.map((r) => id(r.file))
  );
  assert.equal(additionalFileIds.size, 9);
  assert.deepEqual(
    [...fileToRead.keys(), ...additionalFileIds].sort(),
    [...files.keys()].sort()
  );
  for (const e of manifest.entries) {
    assert(
      files.has(e.fileId) &&
        samples.has(e.sampleId) &&
        projects.has(e.projectId)
    );
    assert.equal(
      path.join(readsRoot, clean(files.get(e.fileId).path)),
      e.destination
    );
    assert(e.destination.startsWith(targetRoot + "/"));
    assert(
      e.source.startsWith(
        path.join(readsRoot, clean(projects.get(e.projectId).path)) + "/"
      )
    );
    assert.equal(e.bytes, Number(e.sourceMetadata.size));
  }
  const proofs = new Map(),
    metadataChecks = [],
    sidecars = new Map(review.sidecars.map((r) => [r.fileId, r])),
    reviewFastqs = new Map(review.fastqs.map((r) => [r.fileId, r]));
  assert.equal(sidecars.size, 16);
  assert.equal(reviewFastqs.size, 24);
  function nativeReceipt(entry, prefix) {
    assert(entry && digest(entry.receiptSha256));
    const r = entry.record;
    const name = path.join(
      path.dirname(input.fastqProof.file),
      prefix + "-" + r.fileId + ".json"
    );
    const bytes = regular(path.join(baseDir, name));
    assert.equal(
      sha(bytes),
      entry.receiptSha256,
      "Native hash receipt changed"
    );
    assert.deepEqual(JSON.parse(bytes), r);
    return r;
  }
  const seenSidecars = new Set();
  for (const entry of proof.sidecars) {
    const r = nativeReceipt(entry, "sidecar"),
      expected = sidecars.get(r.fileId),
      e = manifestMap.get(r.fileId);
    assert(expected && e);
    assert(!seenSidecars.has(r.fileId), "Repeated native sidecar proof");
    seenSidecars.add(r.fileId);
    assert.equal(expected.sha256, e.sha256);
    assert.equal(r.sha256, e.sha256);
    assert.equal(r.sampleId, e.sampleId);
    assert.equal(r.mappingVerified, true);
    assert.equal(r.path, e.destination);
    assert.equal(r.bytes, e.bytes);
    assert.equal(r.calculatedSha256, e.sha256);
    assert(md5(r.calculatedMd5));
    metadataChecks.push({ path: r.path, metadata: r.metadata });
  }
  assert.deepEqual([...seenSidecars].sort(), [...sidecars.keys()].sort());
  for (const entry of proof.fastqs) {
    const r = nativeReceipt(entry, "fastq"),
      expected = reviewFastqs.get(r.fileId),
      e = manifestMap.get(r.fileId),
      read = fileToRead.get(r.fileId);
    assert(expected && e && read);
    assert.equal(r.sampleId, e.sampleId);
    assert.equal(r.verified, true);
    assert.equal(r.inputSha256, input.sidecarReview.sha256);
    assert.equal(r.path, e.destination);
    assert.equal(r.bytes, e.bytes);
    assert.equal(r.sha256, e.sha256);
    assert.equal(r.sealedSha256, e.sha256);
    assert.equal(expected.sealedSha256, e.sha256);
    assert(md5(r.md5) && md5(r.expectedMd5FromSidecars));
    assert.equal(r.md5, expected.expectedMd5FromSidecars);
    assert.equal(r.expectedMd5FromSidecars, expected.expectedMd5FromSidecars);
    assert.deepEqual(r.sidecarFileIds, expected.sidecarFileIds);
    assert(
      r.sidecarFileIds.length > 0 &&
        r.sidecarFileIds.every((x) => sidecars.has(x))
    );
    assert.equal(id(runs.get(id(read.run)).sample), r.sampleId);
    assert(Number.isFinite(Date.parse(r.at)));
    assert(!proofs.has(r.fileId));
    proofs.set(r.fileId, {
      fileId: r.fileId,
      readId: id(read),
      runId: id(read.run),
      expectedMd5: expected.expectedMd5FromSidecars,
      calculatedMd5: r.md5,
      verifiedAt: r.at,
      expectedSource: "preserved-historical-sidecars",
      sidecarFileIds: r.sidecarFileIds,
      destinationPath: r.path,
      destinationMetadata: r.metadata,
    });
    metadataChecks.push({ path: r.path, metadata: r.metadata });
  }
  assert.deepEqual([...proofs.keys()].sort(), [...reviewFastqs.keys()].sort());
  for (const r of aux.files) {
    const e = manifestMap.get(r.fileId),
      read = fileToRead.get(r.fileId);
    assert(e && read && sidecars.has(r.fileId));
    assert.equal(r.sampleId, e.sampleId);
    assert.equal(id(runs.get(id(read.run)).sample), e.sampleId);
    assert(!proofs.has(r.fileId));
    assert.equal(path.basename(e.destination), "MD5.txt");
    assert.equal(r.sourcePath, e.source);
    assert.equal(r.destinationPath, e.destination);
    assert.equal(r.bytes, e.bytes);
    assert.equal(r.sourceSha256, e.sha256);
    assert.equal(r.destinationSha256, e.sha256);
    assert(md5(r.expectedMd5) && md5(r.calculatedMd5));
    assert.equal(r.expectedMd5, r.calculatedMd5);
    assert.equal(r.expectedSource, "retained-original-sidecar");
    assert(
      !(
        r.sourceMetadata.dev === r.destinationMetadata.dev &&
        r.sourceMetadata.ino === r.destinationMetadata.ino
      ),
      "Auxiliary proof reuses the copied inode"
    );
    if (r.readId) assert.equal(r.readId, id(read));
    if (r.runId) assert.equal(r.runId, id(read.run));
    assert(Number.isFinite(Date.parse(r.verifiedAt)));
    proofs.set(r.fileId, { ...r, readId: id(read), runId: id(read.run) });
    metadataChecks.push(
      { path: r.sourcePath, metadata: r.sourceMetadata },
      { path: r.destinationPath, metadata: r.destinationMetadata }
    );
  }
  assert.equal(proofs.size, 31);
  assert.deepEqual([...proofs.keys()].sort(), [...fileToRead.keys()].sort());
  const countsByRun = new Map(
    [...runs.keys()].map((k) => [
      k,
      baseline.reads.filter((r) => id(r.run) === k).length,
    ])
  );
  assert.deepEqual(
    [...countsByRun.values()].sort(),
    [2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3]
  );
  const operations = [...reads.values()]
    .sort((a, b) => id(a).localeCompare(id(b)))
    .map((r) => ({
      collection: "reads",
      id: id(r),
      beforeBson: pack(r),
      proof: proofs.get(id(r.file)),
    }))
    .concat(
      [...runs.values()]
        .sort((a, b) => id(a).localeCompare(id(b)))
        .map((r) => ({
          collection: "runs",
          id: id(r),
          beforeBson: pack(r),
          readCount: countsByRun.get(id(r)),
        }))
    );
  assert.equal(operations.length, 43);
  const O = (xs) => xs.map((x) => new ObjectId(x)),
    sampleIds = [...samples.keys()],
    runIds = [...runs.keys()],
    fileIds = [...files.keys()];
  const regex = new RegExp(
    "^/?" +
      clean(target.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:/|$)"
  );
  const queries = {
    projects: { _id: { $in: O([...projects.keys()]) } },
    samples: {
      $or: [{ _id: { $in: O(sampleIds) } }, { project: new ObjectId(TARGET) }],
    },
    runs: {
      $or: [{ _id: { $in: O(runIds) } }, { sample: { $in: O(sampleIds) } }],
    },
    reads: {
      $or: [{ run: { $in: O(runIds) } }, { file: { $in: O(fileIds) } }],
    },
    additionalfiles: {
      $or: [
        { sample: { $in: O(sampleIds) } },
        { run: { $in: O(runIds) } },
        { project: new ObjectId(TARGET) },
        { file: { $in: O(fileIds) } },
      ],
    },
    files: { $or: [{ _id: { $in: O(fileIds) } }, { path: regex }] },
    ingestjobs: {
      $or: [
        { runId: { $in: O(runIds) } },
        { run: { $in: O(runIds) } },
        { sample: { $in: O(sampleIds) } },
        { project: new ObjectId(TARGET) },
      ],
    },
  };
  const planPath = path.join(workDir, "plan.json"),
    executionPath = path.join(workDir, "execution.json"),
    journalPath = path.join(workDir, "journal.jsonl"),
    lockPath = path.join(workDir, "active.lock");
  async function capture() {
    const out = {};
    for (const [c, q] of Object.entries(queries))
      out[c] = await db
        .collection(c)
        .find(q, TYPED)
        .sort({ _id: 1 })
        .maxTimeMS(30000)
        .toArray();
    return out;
  }
  function checkFiles(runId = null) {
    for (const check of metadataChecks) {
      if (
        runId &&
        ![...proofs.values()].some(
          (p) =>
            p.runId === runId &&
            (p.destinationPath === check.path || p.sourcePath === check.path)
        )
      )
        continue;
      assertMetadata(statMetadata(check.path), check.metadata);
    }
  }
  function afterImage(op, at) {
    const value = unpack(op.beforeBson);
    if (op.collection === "reads")
      Object.assign(value, {
        MD5: op.proof.expectedMd5,
        destinationMd5: op.proof.calculatedMd5,
        md5Mismatch: false,
        MD5LastChecked: new Date(op.proof.verifiedAt),
        updatedAt: at,
      });
    else
      Object.assign(value, {
        status: "complete",
        md5VerificationStatus: "complete",
        md5VerificationAttempts: new BSON.Int32(1),
        md5VerificationLastAttempt: at,
        md5VerificationCompletedAt: at,
        md5VerificationResult: {
          verified: new BSON.Int32(op.readCount),
          mismatches: new BSON.Int32(0),
          errors: new BSON.Int32(0),
          skipped: new BSON.Int32(0),
          total: new BSON.Int32(op.readCount),
          disabled: false,
        },
        updatedAt: at,
      });
    return value;
  }
  function load(expected) {
    const bytes = regular(planPath);
    assert.equal(sha(bytes), expected, "Prepared plan digest differs");
    const plan = JSON.parse(bytes);
    assert.equal(plan.inputSha256, inputSha256);
    assert.equal(plan.operationId, input.operationId);
    assert.deepEqual(plan.operations, operations);
    assert.deepEqual(plan.baseline, snapshot.collections);
    let execution = null;
    if (fs.existsSync(executionPath)) {
      execution = JSON.parse(regular(executionPath));
      assert.equal(execution.planSha256, expected);
      assert.equal(execution.operationId, input.operationId);
      assert(Number.isFinite(Date.parse(execution.at)));
      assert.equal(execution.operations.length, 43);
      for (let i = 0; i < 43; i++) {
        assert.equal(
          execution.operations[i].collection,
          operations[i].collection
        );
        assert.equal(execution.operations[i].id, operations[i].id);
        assert(
          same(
            unpack(execution.operations[i].afterBson),
            afterImage(operations[i], new Date(execution.at))
          ),
          "Unexpected after image"
        );
      }
    }
    return { plan, execution, digest: expected };
  }
  async function assess(context) {
    const actual = await capture(),
      afters = new Map(
        (context?.execution?.operations || []).map((o) => [
          o.collection + ":" + o.id,
          unpack(o.afterBson),
        ])
      ),
      ops = new Map(operations.map((o) => [o.collection + ":" + o.id, o])),
      states = [],
      differences = [];
    for (const [c, docs] of Object.entries(baseline)) {
      const live = byId(actual[c]);
      for (const current of actual[c])
        if (!docs.some((d) => id(d) === id(current)))
          differences.push({
            collection: c,
            id: id(current),
            reason: "unexpected-record",
          });
      for (const before of docs) {
        const current = live.get(id(before)),
          key = c + ":" + id(before),
          op = ops.get(key);
        if (!current) {
          differences.push({
            collection: c,
            id: id(before),
            reason: "missing-record",
          });
          if (op) states.push({ collection: c, id: op.id, state: "diverged" });
          continue;
        }
        if (!op) {
          if (!same(current, before))
            differences.push({
              collection: c,
              id: id(before),
              reason: "control-record-changed",
            });
          continue;
        }
        const state = same(current, before)
          ? "before"
          : afters.has(key) && same(current, afters.get(key))
          ? "after"
          : "diverged";
        states.push({ collection: c, id: id(before), state });
        if (state === "diverged")
          differences.push({
            collection: c,
            id: id(before),
            reason: "changed-record",
          });
      }
    }
    const counts = { before: 0, after: 0, diverged: 0 };
    for (const s of states) counts[s.state]++;
    const state = differences.length
      ? "diverged"
      : counts.after === 43
      ? "complete"
      : counts.before === 43
      ? "before"
      : "partial";
    return {
      at: now().toISOString(),
      operationId: input.operationId,
      state,
      counts,
      differences,
      states,
      snapshotSha256: sha(bson.serialize(ordered(actual))),
    };
  }
  function journalState(context, requireComplete = false) {
    let previous = sha(input.operationId),
      sequence = 0;
    const intents = new Set(),
      finished = new Set(),
      operationMap = new Map(
        operations.map((op) => [op.collection + ":" + op.id, op])
      ),
      afters = new Map(
        (context?.execution?.operations || []).map((op) => [
          op.collection + ":" + op.id,
          unpack(op.afterBson),
        ])
      );
    let raw = Buffer.alloc(0);
    if (fs.existsSync(journalPath)) {
      assert(
        context?.execution,
        "Journal exists without immutable after-images"
      );
      raw = regular(journalPath);
      const bytes = raw.toString();
      assert(bytes.endsWith("\n"), "Truncated or empty write-ahead journal");
      for (const line of bytes.trimEnd().split("\n")) {
        const { sha256, ...body } = JSON.parse(line);
        assert.equal(
          body.sequence,
          sequence++,
          "Journal chain sequence differs"
        );
        assert.equal(
          body.previous,
          previous,
          "Journal chain predecessor differs"
        );
        assert.equal(
          body.operationId,
          input.operationId,
          "Journal operation differs"
        );
        assert.equal(sha(json(body)), sha256, "Journal chain digest differs");
        const key = body.collection + ":" + body.id,
          op = operationMap.get(key);
        assert(op, "Out-of-scope journal record");
        if (body.event === "write-intent") {
          assert.equal(
            body.beforeSha256,
            sha(bson.serialize(ordered(unpack(op.beforeBson))))
          );
          assert.equal(
            body.afterSha256,
            sha(bson.serialize(ordered(afters.get(key))))
          );
          intents.add(key);
        } else {
          assert(
            ["write-verified", "adopt-after"].includes(body.event),
            "Unknown journal event"
          );
          assert(intents.has(key), "Completion has no durable write intent");
          finished.add(key);
        }
        previous = sha256;
      }
    }
    if (requireComplete) {
      assert.equal(intents.size, 43, "Missing write intents");
      assert.equal(
        finished.size,
        43,
        "Missing verified or adopted completion evidence"
      );
    }
    return {
      previous,
      sequence,
      intents,
      journalSha256: sha(raw),
      journalEvents: sequence,
    };
  }
  function append(event, context) {
    const { previous, sequence } = journalState(context);
    const body = {
        sequence,
        previous,
        at: now().toISOString(),
        operationId: input.operationId,
        ...event,
      },
      fd = fs.openSync(
        journalPath,
        fs.constants.O_APPEND |
          fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_NOFOLLOW,
        0o640
      );
    try {
      fs.fchmodSync(fd, 0o640);
      fs.writeFileSync(
        fd,
        JSON.stringify({ ...body, sha256: sha(json(body)) }) + "\n"
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  async function prepare() {
    assert(!fs.existsSync(planPath), "Plan already exists");
    for (const filename of [executionPath, journalPath, lockPath])
      assert(
        !fs.existsSync(filename),
        "Preparation needs a fresh evidence directory"
      );
    assert(
      fs.lstatSync(workDir).isDirectory() &&
        !fs.lstatSync(workDir).isSymbolicLink()
    );
    checkFiles();
    const state = await assess(null);
    assert.equal(
      state.state,
      "before",
      "Fresh database differs from approved snapshot"
    );
    const plan = {
      kind: "gulnara-scoped-md5-import",
      version: 1,
      preparedAt: now().toISOString(),
      operationId: input.operationId,
      inputSha256,
      inputs: input,
      scope: { reads: 31, runs: 12, fastqs: 24, auxiliarySidecars: 7 },
      baseline: snapshot.collections,
      operations,
    };
    writeOnce(planPath, plan);
    return {
      planSha256: sha(regular(planPath)),
      operations: 43,
      scope: plan.scope,
      snapshotSha256: state.snapshotSha256,
    };
  }
  async function apply({ planSha256 }) {
    let context = load(planSha256);
    fs.mkdirSync(lockPath, { mode: 0o700 });
    writeOnce(path.join(lockPath, "owner.json"), {
      pid: process.pid,
      operationId: input.operationId,
      at: now().toISOString(),
    });
    try {
      checkFiles();
      journalState(context);
      let state = await assess(context);
      assert.equal(
        state.differences.length,
        0,
        "Database changed before import"
      );
      if (!context.execution) {
        assert.equal(state.state, "before");
        const at = now();
        writeOnce(executionPath, {
          kind: "gulnara-md5-import-execution",
          operationId: input.operationId,
          planSha256,
          at: at.toISOString(),
          operations: operations.map((op) => ({
            collection: op.collection,
            id: op.id,
            afterBson: pack(afterImage(op, at)),
          })),
        });
        context = load(planSha256);
      }
      const afters = new Map(
        context.execution.operations.map((o) => [
          o.collection + ":" + o.id,
          unpack(o.afterBson),
        ])
      );
      for (const op of operations) {
        const after = afters.get(op.collection + ":" + op.id),
          before = unpack(op.beforeBson),
          current = await db
            .collection(op.collection)
            .findOne({ _id: new ObjectId(op.id) }, TYPED);
        if (same(current, after)) {
          assert(
            journalState(context).intents.has(op.collection + ":" + op.id),
            "Unjournalled after-image"
          );
          append(
            { event: "adopt-after", collection: op.collection, id: op.id },
            context
          );
          continue;
        }
        assert(same(current, before), "Concurrent checksum metadata change");
        if (op.collection === "runs") {
          checkFiles(op.id);
          state = await assess(context);
          assert.equal(
            state.differences.length,
            0,
            "Graph changed before terminal run transition"
          );
          for (const read of baseline.reads.filter((r) => id(r.run) === op.id))
            assert(
              state.states.some(
                (s) =>
                  s.collection === "reads" &&
                  s.id === id(read) &&
                  s.state === "after"
              ),
              "Run checksums are incomplete"
            );
        } else {
          const p = op.proof;
          assertMetadata(
            statMetadata(p.destinationPath),
            p.destinationMetadata
          );
          if (p.sourcePath)
            assertMetadata(statMetadata(p.sourcePath), p.sourceMetadata);
        }
        const allowed =
            op.collection === "reads"
              ? [
                  "MD5",
                  "destinationMd5",
                  "md5Mismatch",
                  "MD5LastChecked",
                  "updatedAt",
                ]
              : [
                  "status",
                  "md5VerificationStatus",
                  "md5VerificationAttempts",
                  "md5VerificationLastAttempt",
                  "md5VerificationCompletedAt",
                  "md5VerificationResult",
                  "updatedAt",
                ],
          set = Object.fromEntries(allowed.map((k) => [k, after[k]]));
        append(
          {
            event: "write-intent",
            collection: op.collection,
            id: op.id,
            beforeSha256: sha(bson.serialize(ordered(before))),
            afterSha256: sha(bson.serialize(ordered(after))),
          },
          context
        );
        const result = await db
          .collection(op.collection)
          .updateOne(
            wholeDocumentFilter(before, allowed),
            { $set: set },
            {
              upsert: false,
              writeConcern: { w: "majority", j: true, wtimeout: 15000 },
            }
          );
        assert.equal(result.matchedCount, 1, "Whole-document CAS lost");
        if (afterWrite) await afterWrite(op);
        assert(
          same(
            await db
              .collection(op.collection)
              .findOne({ _id: new ObjectId(op.id) }, TYPED),
            after
          ),
          "Post-write comparison failed"
        );
        append(
          { event: "write-verified", collection: op.collection, id: op.id },
          context
        );
      }
      state = await assess(context);
      assert.equal(state.state, "complete");
      checkFiles();
      const { journalSha256, journalEvents } = journalState(context, true);
      state = { ...state, journalSha256, journalEvents };
      writeOnce(
        path.join(workDir, "complete-" + crypto.randomUUID() + ".json"),
        {
          ...state,
          planSha256,
          metadataOnly: true,
          queuedJobs: 0,
          emailsSent: 0,
        }
      );
      return state;
    } finally {
      fs.unlinkSync(path.join(lockPath, "owner.json"));
      fs.rmdirSync(lockPath);
    }
  }
  async function verify({ planSha256 }) {
    assert(!fs.existsSync(lockPath), "Importer is active or ambiguous");
    const context = load(planSha256),
      state = await assess(context);
    assert.equal(state.state, "complete");
    checkFiles();
    const { journalSha256, journalEvents } = journalState(context, true);
    return { ...state, journalSha256, journalEvents };
  }
  return {
    prepare,
    apply,
    verify,
    assess: (args) => assess(load(args.planSha256)),
    operations,
    queries,
  };
}
async function main() {
  assert.equal(os.hostname().split(".")[0], "v1333");
  assert.equal(os.userInfo().username, "deeks");
  const [command, ...args] = process.argv.slice(2);
  assert(["prepare", "apply", "verify"].includes(command));
  assert.equal(args.length, command === "prepare" ? 6 : 8);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(
      ["--input", "--input-sha256", "--work-dir", "--plan-sha256"].includes(
        args[i]
      )
    );
    assert(!flags[args[i]]);
    flags[args[i]] = args[i + 1];
  }
  assert.equal(path.dirname(flags["--input"]), PACK);
  assert.equal(flags["--work-dir"], path.join(PACK, "db-evidence"));
  const bytes = regular(flags["--input"]);
  assert.equal(sha(bytes), flags["--input-sha256"]);
  assert.equal(
    JSON.parse(bytes).toolSha256,
    sha(regular(__filename)),
    "Importer code differs from reviewed input"
  );
  const { MongoClient, ObjectId } = require(API + "/node_modules/mongodb"),
    BSON = require(API + "/node_modules/bson"),
    client = await MongoClient.connect(
      "mongodb://127.0.0.1:28015/komondor?directConnection=true",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 15000,
      }
    );
  try {
    const importer = createImporter({
      db: client.db("komondor"),
      ObjectId,
      BSON,
      bson: new BSON(),
      baseDir: PACK,
      workDir: flags["--work-dir"],
      input: JSON.parse(bytes),
      inputSha256: sha(bytes),
    });
    console.log(
      JSON.stringify(
        await importer[command](
          command === "prepare"
            ? undefined
            : { planSha256: flags["--plan-sha256"] }
        ),
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  });
module.exports = {
  createImporter,
  wholeDocumentFilter,
  typedExpression,
  assertMetadata,
  metadata,
  TYPED,
};
