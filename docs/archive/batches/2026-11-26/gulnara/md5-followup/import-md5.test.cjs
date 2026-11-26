"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
let BSON;
try {
  BSON = require("bson");
} catch {
  BSON = require("/Users/deeks/Local_Documents/Local_GitHub/komondor-api/node_modules/bson");
}
const {
    createImporter,
    assertMetadata,
    wholeDocumentFilter,
    TYPED,
  } = require("./import-md5.cjs"),
  bson = new BSON();
const TARGET = "6ae4ac89a6b876c643741d27",
  sha = (x) => crypto.createHash("sha256").update(x).digest("hex"),
  md5 = (x) => crypto.createHash("md5").update(x).digest("hex"),
  id = (n) => n.toString(16).padStart(24, "0"),
  oid = (n) => new BSON.ObjectID(id(n));
const clone = (x) => bson.deserialize(bson.serialize(x), TYPED),
  pack = (x) => bson.serialize(x).toString("base64"),
  same = (a, b) => bson.serialize(a).equals(bson.serialize(b));
function fixture(t, { afterWrite } = {}) {
  const base = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "gulnara-md5-fixture-")
  );
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workDir = path.join(base, "db-evidence");
  fs.mkdirSync(workDir);
  fs.mkdirSync(path.join(base, "hash"));
  const targetPath = "ntalbot/xanthoria_parietina_mycobiont_rnaseq",
    groups = Array.from({ length: 4 }, (_, i) => ({
      _id: oid(10 + i),
      path: "ntalbot/old_" + i,
      storage: {
        state: "aws_pending_hpc_deletion",
        s3Uri: "s3://fixture/" + i,
        s3VerifiedAt: new Date("2026-10-20"),
      },
    }));
  const target = {
    _id: new BSON.ObjectID(TARGET),
    path: targetPath,
    storage: { state: "hpc" },
    preserveOnHpcUntil: new Date("2031-01-01"),
  };
  const data = {
      projects: [...groups, target],
      samples: [],
      runs: [],
      reads: [],
      additionalfiles: [],
      files: [],
      ingestjobs: [],
    },
    entries = [],
    fastqs = [],
    sidecars = [],
    auxiliary = [],
    statMap = new Map(),
    at = "2026-11-26T14:00:00.000Z";
  const meta = (ino, size, nlink = "2") => ({
    dev: "42",
    ino: String(ino),
    mode: "33272",
    nlink,
    uid: "11449",
    gid: "12318",
    size: String(size),
    mtime_ns: "1795690000000000001",
    ctime_ns: "1795690000000000002",
  });
  for (let i = 0; i < 12; i++) {
    const s = {
        _id: oid(100 + i),
        project: target._id,
        path: targetPath + "/sample" + i,
        safeName: "sample" + i,
      },
      r = {
        _id: oid(200 + i),
        sample: s._id,
        path: s.path + "/run" + i,
        safeName: "run" + i,
        name: "Run" + i,
        updatedAt: new Date("2020-01-01"),
        reconciliation: {
          version: new BSON.Int32(1),
          operationId: "prior",
          identity: { sample: s._id, path: s.path + "/run" + i },
        },
        reconciliationHistory: [
          {
            version: new BSON.Int32(1),
            observations: [
              new BSON.Double(1),
              BSON.Long.fromString("9007199254740993"),
            ],
          },
        ],
      };
    data.samples.push(s);
    data.runs.push(r);
  }
  function add(sample, type, index) {
    const s = data.samples[sample],
      run = data.runs[sample],
      name =
        type === "fastq"
          ? "reads_" + sample + "_" + index + ".fq.gz"
          : "MD5.txt",
      relative =
        s.safeName +
        "/" +
        run.safeName +
        "/" +
        (type === "additional" ? "additional" : "raw") +
        "/" +
        name,
      fileId = id(1000 + entries.length),
      source = "/mnt/reads/" + groups[sample % 4].path + "/" + relative,
      destination = "/mnt/reads/" + targetPath + "/" + relative,
      payload =
        type === "fastq"
          ? "compressed-fastq-" + sample + "-" + index
          : "historic-sidecar-" + sample,
      bytes = Buffer.byteLength(payload),
      hash = sha(payload),
      originalMeta = meta(900000 + entries.length, bytes, "1"),
      destMeta = meta(800000 + entries.length, bytes),
      e = {
        projectId: String(groups[sample % 4]._id),
        sampleId: String(s._id),
        fileId,
        source,
        destination,
        bytes,
        sha256: hash,
        sourceMetadata: { size: bytes },
      };
    entries.push(e);
    statMap.set(source, originalMeta);
    statMap.set(destination, destMeta);
    const f = {
      _id: new BSON.ObjectID(fileId),
      path: targetPath + "/" + relative,
      originalName: name,
      updatedAt: new Date("2020-01-01"),
    };
    data.files.push(f);
    if (type === "additional")
      data.additionalfiles.push({
        _id: oid(4000 + data.additionalfiles.length),
        file: f._id,
        sample: s._id,
      });
    else
      data.reads.push({
        _id: oid(3000 + data.reads.length),
        file: f._id,
        run: run._id,
        updatedAt: new Date("2020-01-01"),
        paired: true,
      });
    if (type === "fastq")
      fastqs.push({
        sampleId: String(s._id),
        fileId,
        path: destination,
        bytes,
        sealedSha256: hash,
        expectedMd5FromSidecars: md5(payload),
        sidecarFileIds: [],
      });
    else {
      sidecars.push({
        fileId,
        sampleId: String(s._id),
        path: destination,
        bytes,
        sha256: hash,
      });
      if (type === "auxiliary")
        auxiliary.push({
          fileId,
          sampleId: String(s._id),
          sourcePath: source,
          destinationPath: destination,
          bytes,
          expectedMd5: md5(payload),
          calculatedMd5: md5(payload),
          sourceSha256: hash,
          destinationSha256: hash,
          sourceMetadata: originalMeta,
          destinationMetadata: destMeta,
          verifiedAt: at,
          expectedSource: "retained-original-sidecar",
        });
    }
  }
  for (let i = 0; i < 12; i++) {
    add(i, "fastq", 1);
    add(i, "fastq", 2);
  }
  for (let i = 5; i < 12; i++) add(i, "auxiliary");
  for (let i = 0; i < 9; i++) add(i, "additional");
  for (const f of fastqs)
    f.sidecarFileIds = sidecars
      .filter((s) => s.sampleId === f.sampleId)
      .map((s) => s.fileId);
  const write = (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    fs.writeFileSync(path.join(base, name), bytes);
    return { file: name, sha256: sha(bytes) };
  };
  const snapshot = {
    kind: "gulnara-md5-initial-snapshot",
    at,
    database: "komondor",
    collections: Object.fromEntries(
      Object.entries(data).map(([c, rows]) => [
        c,
        rows.map((r) => ({ id: String(r._id), bson: pack(r) })),
      ])
    ),
  };
  const snapshotRef = write("snapshot.json", snapshot),
    manifestRef = write("manifest.json", { count: 40, entries }),
    reviewRef = write("review.json", {
      projectId: TARGET,
      coverageComplete: true,
      conflicts: [],
      fastqCount: 24,
      sidecarCount: 16,
      fastqs,
      sidecars,
    });
  const natives = { fastqs: [], sidecars: [] };
  for (const row of fastqs) {
    const record = {
      ...row,
      md5: row.expectedMd5FromSidecars,
      sha256: row.sealedSha256,
      metadata: statMap.get(row.path),
      at,
      verified: true,
      inputSha256: reviewRef.sha256,
    };
    const ref = write("hash/fastq-" + row.fileId + ".json", record);
    natives.fastqs.push({ record, receiptSha256: ref.sha256 });
  }
  for (const row of sidecars) {
    const record = {
      ...row,
      calculatedMd5: md5(
        "historic-sidecar-" + (Number(BigInt("0x" + row.sampleId)) - 100)
      ),
      calculatedSha256: row.sha256,
      metadata: statMap.get(row.path),
      at,
      mappingVerified: true,
    };
    const ref = write("hash/sidecar-" + row.fileId + ".json", record);
    natives.sidecars.push({ record, receiptSha256: ref.sha256 });
  }
  const proofRef = write("hash/completed.json", {
    kind: "gulnara-independent-md5-sha256-completion",
    projectId: TARGET,
    allVerified: true,
    inputSha256: reviewRef.sha256,
    copyManifestSha256: manifestRef.sha256,
    fastqCount: 24,
    sidecarCount: 16,
    ...natives,
  });
  const auxRef = write("aux.json", {
    kind: "gulnara-auxiliary-source-copy-md5-proof",
    projectId: TARGET,
    allVerified: true,
    files: auxiliary,
  });
  const input = {
      version: 1,
      operationId: crypto.randomUUID(),
      targetProjectId: TARGET,
      snapshot: snapshotRef,
      fastqProof: proofRef,
      sidecarReview: reviewRef,
      copyManifest: manifestRef,
      auxProof: auxRef,
    },
    inputRef = write("input.json", input),
    store = Object.fromEntries(
      Object.entries(data).map(([c, docs]) => [
        c,
        new Map(docs.map((d) => [String(d._id), clone(d)])),
      ])
    ),
    writes = [];
  const db = {
    databaseName: "komondor",
    collection(c) {
      return {
        find(q) {
          const rows = () => [...store[c].values()].map(clone);
          return {
            sort() {
              return this;
            },
            maxTimeMS() {
              return this;
            },
            async toArray() {
              return rows();
            },
          };
        },
        async findOne(q) {
          const d = store[c].get(String(q._id));
          return d ? clone(d) : null;
        },
        async updateOne(filter, update) {
          const key = String(filter._id),
            before = filter.$expr.$and[0].$eq[1].$literal,
            current = store[c].get(key);
          if (!current || !same(current, before)) return { matchedCount: 0 };
          assert(update.$set);
          const after = clone(current);
          Object.assign(after, update.$set);
          store[c].set(key, clone(after));
          writes.push({ collection: c, id: key, set: clone(update.$set) });
          return { matchedCount: 1 };
        },
      };
    },
  };
  const options = {
    db,
    ObjectId: BSON.ObjectID,
    BSON,
    bson,
    baseDir: base,
    workDir,
    input,
    inputSha256: inputRef.sha256,
    statMetadata: (p) => ({ ...statMap.get(p) }),
    now: () => new Date("2026-11-26T14:05:00.000Z"),
    afterWrite,
  };
  return {
    base,
    workDir,
    data,
    store,
    writes,
    options,
    statMap,
    input,
    write,
    importer: createImporter(options),
  };
}
test("exact43 metadata writes: true31 comparisons, terminal12 runs, numeric pins/controls preserved", async (t) => {
  const f = fixture(t),
    prepared = await f.importer.prepare();
  assert.equal(prepared.operations, 43);
  assert.equal(f.writes.length, 0);
  const result = await f.importer.apply(prepared);
  assert.equal(result.state, "complete");
  assert.equal(f.writes.length, 43);
  assert(f.writes.slice(0, 31).every((w) => w.collection === "reads"));
  assert(f.writes.slice(31).every((w) => w.collection === "runs"));
  assert(
    f.writes.every(
      (w) => !["pending", "in_progress"].includes(w.set.md5VerificationStatus)
    )
  );
  for (const before of f.data.runs) {
    const after = f.store.runs.get(String(before._id));
    assert(same(before.reconciliation, after.reconciliation));
    assert(
      same(
        { h: before.reconciliationHistory },
        { h: after.reconciliationHistory }
      )
    );
    assert.equal(after.status, "complete");
    assert.equal(after.md5VerificationStatus, "complete");
    assert.equal(after.md5VerificationAttempts.valueOf(), 1);
    assert.equal(after.md5VerificationResult.skipped.valueOf(), 0);
    assert.equal(
      after.md5VerificationResult.total.valueOf(),
      after.md5VerificationResult.verified.valueOf()
    );
  }
  for (const c of ["projects", "samples", "files", "additionalfiles"])
    for (const before of f.data[c])
      assert(same(before, f.store[c].get(String(before._id))));
  assert.equal((await f.importer.verify(prepared)).state, "complete");
  await f.importer.apply(prepared);
  assert.equal(f.writes.length, 43, "Idempotence must not rewrite");
});
test("interrupted Read write resumes only its exact after-image without queueing", async (t) => {
  let stopped = false;
  const f = fixture(t, {
      afterWrite: async () => {
        if (!stopped && f.writes.length === 5) {
          stopped = true;
          throw Error("simulated interruption");
        }
      },
    }),
    prepared = await f.importer.prepare();
  await assert.rejects(f.importer.apply(prepared), /interruption/);
  assert.equal(f.writes.length, 5);
  assert.equal([...f.store.runs.values()].filter((r) => r.status).length, 0);
  assert.equal((await f.importer.assess(prepared)).state, "partial");
  await f.importer.apply(prepared);
  assert.equal(f.writes.length, 43);
  assert.equal((await f.importer.verify(prepared)).state, "complete");
});
test("extra live graph record or control storage mutation refuses writes", async (t) => {
  const f = fixture(t),
    prepared = await f.importer.prepare();
  f.store.reads.set(id(9999), {
    _id: oid(9999),
    run: f.data.runs[0]._id,
    file: f.data.files[0]._id,
  });
  await assert.rejects(f.importer.apply(prepared), /Database changed/);
  assert.equal(f.writes.length, 0);
  f.store.reads.delete(id(9999));
  f.store.projects.get(TARGET).storage.state = "aws";
  await assert.rejects(f.importer.apply(prepared), /Database changed/);
  assert.equal(f.writes.length, 0);
});
test("hash mismatch, duplicate native proof and unsafe target cannot prepare", (t) => {
  const f = fixture(t);
  const proof = JSON.parse(
    fs.readFileSync(path.join(f.base, f.input.fastqProof.file))
  );
  proof.fastqs[0].record.md5 = "0".repeat(32);
  f.input.fastqProof = f.write(f.input.fastqProof.file, proof);
  assert.throws(() => createImporter({ ...f.options, input: f.input }));
  const g = fixture(t);
  const sidecarProof = JSON.parse(
    fs.readFileSync(path.join(g.base, g.input.fastqProof.file))
  );
  sidecarProof.sidecars[1] = sidecarProof.sidecars[0];
  g.input.fastqProof = g.write(g.input.fastqProof.file, sidecarProof);
  assert.throws(
    () => createImporter({ ...g.options, input: g.input }),
    /Repeated/
  );
  const h = fixture(t),
    snapshot = JSON.parse(
      fs.readFileSync(path.join(h.base, h.input.snapshot.file))
    );
  const row = snapshot.collections.projects.find((r) => r.id === TARGET),
    doc = bson.deserialize(Buffer.from(row.bson, "base64"), TYPED);
  doc.storage = { state: "aws", s3Uri: "s3://elsewhere" };
  row.bson = pack(doc);
  h.input.snapshot = h.write(h.input.snapshot.file, snapshot);
  assert.throws(
    () => createImporter({ ...h.options, input: h.input }),
    /HPC writable/
  );
});
test("changed file metadata blocks import; added document field never overwritten", async (t) => {
  const f = fixture(t),
    prepared = await f.importer.prepare(),
    first = f.input;
  const p = [...f.statMap.keys()].find(
    (x) => x.includes("xanthoria") && x.endsWith(".fq.gz")
  );
  f.statMap.get(p).ctime_ns = "1795690000000000003";
  await assert.rejects(f.importer.apply(prepared), /Payload metadata changed/);
  assert.equal(f.writes.length, 0);
  const g = fixture(t),
    other = await g.importer.prepare();
  g.store.reads.get(String(g.data.reads[0]._id)).newConcurrentField = true;
  await assert.rejects(g.importer.apply(other), /Database changed/);
  assert.equal(g.writes.length, 0);
  assert.equal(
    g.store.reads.get(String(g.data.reads[0]._id)).newConcurrentField,
    true
  );
});
test("mid-import graph drift prevents any terminal Run transition", async (t) => {
  const f = fixture(t, {
      afterWrite: async () => {
        if (f.writes.length === 31)
          f.store.projects.get(TARGET).newField = "concurrent";
      },
    }),
    prepared = await f.importer.prepare();
  await assert.rejects(f.importer.apply(prepared), /Graph changed/);
  assert.equal(f.writes.length, 31);
  assert.equal(f.writes.filter((x) => x.collection === "runs").length, 0);
});
test("metadata rejects unsafe nanosecond numbers; CAS fences absent fields and BSON types", () => {
  const value = {
    dev: "42",
    ino: "1",
    mode: "33272",
    nlink: "2",
    uid: "11449",
    gid: "12318",
    size: "100",
    mtime_ns: "1795690000000000001",
    ctime_ns: "1795690000000000002",
  };
  assertMetadata({ ...value }, value);
  assert.throws(
    () => assertMetadata(value, { ...value, mtime_ns: Number(value.mtime_ns) }),
    /Lossy/
  );
  const before = { _id: oid(1), nested: [{ v: new BSON.Int32(1) }] },
    filter = wholeDocumentFilter(before, ["MD5"]);
  assert.deepEqual(filter.$and, [{ MD5: { $exists: false } }]);
  assert(JSON.stringify(filter).includes('"int"'));
  assert(JSON.stringify(filter).includes("$objectToArray"));
});

test("auxiliary checksum mapping rejects a swapped cross-sample Read reference", (t) => {
  const f = fixture(t),
    snapshot = JSON.parse(
      fs.readFileSync(path.join(f.base, f.input.snapshot.file))
    ),
    a = snapshot.collections.reads[24],
    b = snapshot.collections.reads[25],
    ad = bson.deserialize(Buffer.from(a.bson, "base64"), TYPED),
    bd = bson.deserialize(Buffer.from(b.bson, "base64"), TYPED),
    run = ad.run;
  ad.run = bd.run;
  bd.run = run;
  a.bson = pack(ad);
  b.bson = pack(bd);
  f.input.snapshot = f.write(f.input.snapshot.file, snapshot);
  assert.throws(() => createImporter({ ...f.options, input: f.input }));
});

test("verification requires the complete, intact write-ahead journal", async (t) => {
  const f = fixture(t),
    prepared = await f.importer.prepare();
  await f.importer.apply(prepared);
  const journal = path.join(f.workDir, "journal.jsonl"),
    original = fs.readFileSync(journal);
  const checked = await f.importer.verify(prepared);
  assert.equal(checked.journalEvents, 86);
  assert.equal(checked.journalSha256, sha(original));
  fs.writeFileSync(journal, original.subarray(0, original.length - 1));
  await assert.rejects(f.importer.verify(prepared), /Truncated/);
  const lines = original.toString().trimEnd().split("\n"),
    first = JSON.parse(lines[0]);
  first.event = "adopt-after";
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(journal, lines.join("\n") + "\n");
  await assert.rejects(f.importer.verify(prepared), /Journal chain/);
  fs.unlinkSync(journal);
  await assert.rejects(f.importer.verify(prepared), /Missing/);
});
