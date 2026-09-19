/** Real CLI, raw MongoDB documents and files. Requires an explicit scratch URI. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { configureEnv, restoreEnv } = require("./support/env");
const rootMongo = require("./support/mongo");
const { makeRunChain } = require("./support/fixtures");
let envHandle;
let fixture;
const data = "tiny sequencing file";
const md5 = crypto.createHash("md5").update(data).digest("hex");
const ObjectId = rootMongo.mongoose.Types.ObjectId;
const oid = () => new ObjectId();

beforeAll(async () => {
  envHandle = await configureEnv("power-inspector");
  await rootMongo.connect();
});
afterAll(async () => {
  await rootMongo.disconnect();
  await restoreEnv(envHandle);
});
beforeEach(async () => {
  await rootMongo.dropDatabase();
  const db = rootMongo.mongoose.connection.db;
  // Use the actual model hooks: Project.path starts with '/', which is
  // inherited by Sample.path/Run.path, while getRelativePath() does not.
  // The original hand-written fixture missed that production distinction.
  const chain = await makeRunChain({
    group: { name: "group" },
    project: { name: "project", owner: "tester" },
    sample: { name: "sample", owner: "tester" },
    run: {
      name: "run",
      owner: "tester",
      status: "complete",
      md5VerificationStatus: "complete",
    },
  });
  // Complete fixture-side index builds before testing that the inspector
  // itself leaves documents and indexes unchanged.
  await Promise.all(
    Object.values(rootMongo.mongoose.models).map((model) => model.init()),
  );
  const project = chain.project._id,
    sample = chain.sample._id,
    run = chain.run._id,
    file = oid(),
    read = oid();
  const relativeRunPath = await chain.run.getRelativePath();
  expect(chain.run.path).toBe("/" + relativeRunPath);
  const relative = path.join(relativeRunPath, "raw", "reads.fq.gz");
  const target = path.join(envHandle.datastoreRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  await db.collection("reads").insertOne({
    _id: read,
    run,
    file,
    MD5: md5,
    destinationMd5: md5,
    md5Mismatch: false,
    MD5LastChecked: new Date(),
  });
  await db
    .collection("files")
    .insertOne({ _id: file, originalName: "reads.fq.gz", path: relative });
  await db
    .collection("ingestjobs")
    .insertOne({ runId: run, type: "run-ingest", status: "done", attempts: 1 });
  const manifest = {
    version: 1,
    entryId: 21,
    owner: "tester",
    projectId: String(project),
    sourcePrefix: "/tsl/data/tempWebUploadToSequences",
    runs: [
      {
        id: String(run),
        name: "run",
        sampleName: "sample",
        reads: [
          {
            sourcePath:
              "/tsl/data/tempWebUploadToSequences/source.fq.gz".replace(
                "source",
                "reads",
              ),
            md5,
          },
        ],
      },
    ],
  };
  const manifestPath = path.join(envHandle.base, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(path.join(envHandle.base, "empty.env"), "");
  fixture = {
    project,
    sample,
    run,
    file,
    read,
    target,
    relative,
    relativeRunPath,
    manifest,
    manifestPath,
    db,
  };
  fs.rmSync(path.join(envHandle.hpcDirectory, "reads.fq.gz"), { force: true });
});

const cli = (args = [], extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(__dirname, "../../scripts/inspect-power-submission.cjs"),
        "--manifest",
        fixture.manifestPath,
        "--env",
        path.join(envHandle.base, "empty.env"),
        "--json",
        ...args,
      ],
      {
        cwd: path.join(__dirname, "../.."),
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout,
        stderr,
        report: stdout ? JSON.parse(stdout) : null,
      }),
    );
  });
const snapshot = async () => {
  const names = (await fixture.db.listCollections().toArray())
    .map((c) => c.name)
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      indexes: await fixture.db.collection(name).indexes(),
      documents: await fixture.db.collection(name).find({}).toArray(),
    })),
  );
};

test("passes old-schema successful jobs with moved-away sources and changes no documents, indexes or file contents", async () => {
  const before = await snapshot();
  const result = await cli();
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(result.report.summary).toMatchObject({
    foundRuns: 1,
    sourceFilesPresent: 0,
    destinationFilesPresent: 1,
    storedChecksMatched: 1,
    freshlyHashedMatched: null,
  });
  expect(await snapshot()).toEqual(before);
  expect(fs.readFileSync(fixture.target, "utf8")).toBe(data);
});

test("accepts legacy relative Run.path as well as model-generated slash-prefixed paths", async () => {
  await fixture.db
    .collection("runs")
    .updateOne(
      { _id: fixture.run },
      { $set: { path: fixture.relativeRunPath } },
    );
  const result = await cli();
  expect(result.code).toBe(0);
});

test("still flags a genuinely different raw-file path and reports both compared values", async () => {
  const wrongPath = "group/project/different-sample/run/raw/reads.fq.gz";
  const target = path.join(envHandle.datastoreRoot, wrongPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  await fixture.db
    .collection("files")
    .updateOne({ _id: fixture.file }, { $set: { path: wrongPath } });
  const result = await cli();
  expect(result.code).toBe(1);
  const read = result.report.runs[0].reads[0];
  expect(read.destination.state).toBe("present");
  expect(read.findings).toContain(
    "File path differs from this run's raw-file destination",
  );
  expect(read.paths).toMatchObject({
    storedRunPath: "/" + fixture.relativeRunPath,
    storedFilePath: wrongPath,
    expectedFilePath: fixture.relative,
  });
});
test("fresh hashing detects corruption that stored digests alone cannot detect", async () => {
  // Same size and restored mtime make a metadata-only check insufficient.
  const original = fs.statSync(fixture.target);
  fs.writeFileSync(fixture.target, "x".repeat(data.length));
  fs.utimesSync(fixture.target, original.atime, original.mtime);
  const result = await cli(["--hash"]);
  expect(result.code).toBe(1);
  expect(result.report.summary.freshlyHashedMatched).toBe(0);
  expect(result.report.runs[0].reads[0].findings).toContain(
    "Fresh destination MD5 does not match submission",
  );
});
test("flags missing datastore bytes even when all stored statuses say complete", async () => {
  fs.unlinkSync(fixture.target);
  const result = await cli();
  expect(result.code).toBe(1);
  expect(result.report.summary.destinationFilesPresent).toBe(0);
});
test("flags a legacy complete status with a stored mismatch", async () => {
  await fixture.db
    .collection("reads")
    .updateOne(
      { _id: fixture.read },
      { $set: { destinationMd5: "0".repeat(32), md5Mismatch: true } },
    );
  const result = await cli();
  expect(result.code).toBe(1);
  expect(result.report.summary.storedChecksMatched).toBe(0);
});
test("identifies duplicate and unfinished records without operating the queue", async () => {
  // Reproduce a legacy database predating the unique (sample, name) index.
  // This is fixture setup only; the inspected CLI never drops/builds indexes.
  await fixture.db
    .collection("runs")
    .dropIndex("sample_1_name_1")
    .catch((error) => {
      if (error.code !== 27) throw error;
    });
  await fixture.db
    .collection("runs")
    .insertOne({ name: "run", sample: fixture.sample });
  await fixture.db
    .collection("ingestjobs")
    .updateOne({ runId: fixture.run }, { $set: { status: "claimed" } });
  const before = await snapshot();
  const result = await cli();
  expect(result.code).toBe(1);
  expect(result.report.runs[0].findings.join(" ")).toMatch(
    /Other matching run IDs/,
  );
  expect(result.report.runs[0].findings).toContain(
    "Expected one completed ingest job",
  );
  expect(await snapshot()).toEqual(before);
});
test("reports absent IDs rather than substituting similarly named runs", async () => {
  await fixture.db.collection("runs").deleteOne({ _id: fixture.run });
  const result = await cli();
  expect(result.code).toBe(1);
  expect(result.report.runs[0].findings).toContain(
    "Expected run ID is missing",
  );
});
test("passes a retained source and a fresh matching destination hash", async () => {
  fs.writeFileSync(path.join(envHandle.hpcDirectory, "reads.fq.gz"), data);
  const result = await cli(["--hash"]);
  expect(result.code).toBe(0);
  expect(result.report.summary).toMatchObject({
    sourceFilesPresent: 1,
    freshlyHashedMatched: 1,
  });
});
test("connection failures do not disclose Mongo credentials", async () => {
  const result = await cli([], {
    MONGODB_URI:
      "mongodb://sensitiveuser:sensitivepassword@127.0.0.1:1/private",
  });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("MongoDB connection/query failed");
  expect(result.stderr).not.toMatch(
    /sensitiveuser|sensitivepassword|mongodb:\/\//,
  );
}, 20000);
