/**
 * Executes the backlog inspector against real MongoDB. Pure validator tests
 * cannot prove that the CLI joins raw ingestjobs to the correct Run and
 * LibraryType collections before deciding that deployment is safe.
 */

const { spawn } = require("child_process");
const path = require("path");
const { configureEnv, restoreEnv } = require("./support/env");
const rootMongo = require("./support/mongo");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("ingest-backlog-cli");
  await rootMongo.connect();
});

afterAll(async () => {
  await rootMongo.disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await rootMongo.dropDatabase();
});

const runInspector = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "../../scripts/inspect-ingest-backlog.js")],
      {
        cwd: path.join(__dirname, "../.."),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

const validPayload = {
  rawFiles: [
    {
      name: "reads.fq",
      uploadName: "1".repeat(32),
      paired: false,
    },
  ],
  additionalFiles: [],
  rawFilesUploadInfo: { method: "local-filesystem" },
};

describe("inspect-ingest-backlog CLI", () => {
  test("treats a database with no durable queue as safe", async () => {
    const result = await runInspector();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/durable queue has never run here/i);
    expect(result.stderr).toBe("");
  });

  test("accepts a valid unfinished job and ignores settled malformed work", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.collection("librarytypes").insertOne({
      value: "FASTQ - Single",
      paired: false,
      indexed: false,
    });
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "FASTQ - Single",
    });
    await db.collection("ingestjobs").insertMany([
      { runId, status: "pending", payload: validPayload },
      { status: "done", payload: { rawFiles: "broken" } },
    ]);

    const result = await runInspector();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Checked 1 unfinished ingest job/i);
    expect(result.stdout).toMatch(/Nothing stored would be refused/i);
    expect(result.stderr).toBe("");
  });

  test("refuses a job whose Run references a deleted LibraryType", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "Renamed away",
    });
    await db.collection("ingestjobs").insertOne({
      runId,
      status: "failed",
      payload: validPayload,
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      /LibraryType "Renamed away".*does not exist/i,
    );
    expect(result.stdout).not.toMatch(/Nothing stored would be refused/i);
    expect(result.stderr).toBe("");
  });

  test("reports a malformed orphan runId as data, not a query failure", async () => {
    await rootMongo.mongoose.connection.db.collection("ingestjobs").insertOne({
      runId: "not-an-object-id",
      status: "pending",
      payload: validPayload,
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Run not-an-object-id.*does not exist/i);
    expect(result.stderr).toBe("");
  });

  test("casts legacy LibraryType booleans exactly like the worker", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.collection("librarytypes").insertOne({
      value: "Legacy numeric paired",
      paired: 1,
      indexed: 0,
    });
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "Legacy numeric paired",
    });
    await db.collection("ingestjobs").insertOne({
      runId,
      status: "pending",
      payload: validPayload,
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/paired library requires/i);
    expect(result.stderr).toBe("");
  });

  test("refuses duplicate exact-value LibraryType options", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.collection("librarytypes").insertMany([
      { value: "Ambiguous type", paired: true, indexed: false },
      { value: "Ambiguous type", paired: false, indexed: false },
    ]);
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "Ambiguous type",
    });
    await db.collection("ingestjobs").insertOne({
      runId,
      status: "pending",
      payload: validPayload,
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/ambiguous LibraryType.*2 option documents/i);
    expect(result.stderr).toBe("");
  });

  test("uses the collection collation when detecting ambiguous LibraryTypes", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.createCollection("librarytypes", {
      collation: { locale: "en", strength: 2 },
    });
    await db.collection("librarytypes").insertMany([
      { value: "ambiguous TYPE", paired: true, indexed: false },
      { value: "Ambiguous Type", paired: false, indexed: false },
    ]);
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "Ambiguous Type",
    });
    await db.collection("ingestjobs").insertOne({
      runId,
      status: "pending",
      payload: validPayload,
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/ambiguous LibraryType.*2 option documents/i);
    expect(result.stderr).toBe("");
  });

  test("refuses a paired-indexed payload with no index read", async () => {
    const db = rootMongo.mongoose.connection.db;
    const runId = new rootMongo.mongoose.Types.ObjectId();
    await db.collection("librarytypes").insertOne({
      value: "Paired indexed",
      paired: true,
      indexed: true,
    });
    await db.collection("runs").insertOne({
      _id: runId,
      libraryType: "Paired indexed",
    });
    await db.collection("ingestjobs").insertOne({
      runId,
      status: "pending",
      payload: {
        rawFiles: [
          {
            name: "R1.fq",
            uploadName: "1".repeat(32),
            sibling: "R2.fq",
            paired: true,
          },
          {
            name: "R2.fq",
            uploadName: "2".repeat(32),
            sibling: "R1.fq",
            paired: true,
          },
        ],
        additionalFiles: [],
        rawFilesUploadInfo: { method: "local-filesystem" },
      },
    });

    const result = await runInspector();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/requires at least one indexed raw file/i);
    expect(result.stderr).toBe("");
  });
});
