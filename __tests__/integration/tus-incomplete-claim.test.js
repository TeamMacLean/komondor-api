/**
 * Real Mongo, real filesystem: an incomplete tus upload (a short blob, with a
 * sidecar declaring a larger size) must not be claimable into a Run.
 *
 * lib/upload-quota.js exports assertUploadComplete() for exactly this check
 * ("without this, a caller could link a 1%-uploaded blob into a project as if
 * it were the whole file" — its own docstring). This file proves the
 * user-facing property through the real claim path: enqueue -> claim ->
 * lib/ingest-queue.js runIngestJob(), exactly how routes/runs.js and the real
 * worker reach it — not lib/file-utils.js processReadFiles() in isolation,
 * which no longer owns marking a Run "complete" (see its own docstring:
 * lib/ingest-queue.js's finaliseReadStage does that, once, for a fresh run
 * and a retry alike).
 */

const fs = require("fs");
const path = require("path");

const { configureEnv, restoreEnv } = require("./support/env");
const { connect, resetCollections, disconnect } = require("./support/mongo");
const { makeRunChain, writeStagedUpload } = require("./support/fixtures");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("tus-incomplete-claim");
  await connect();
});

afterAll(async () => {
  await disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await resetCollections();
});

/** The datastore path a successfully-moved raw file would land at. */
const expectedDatastoreDestination = async (run, originalName) => {
  const relPath = await run.getRelativePath();
  return path.join(process.env.DATASTORE_ROOT, relPath, "raw", originalName);
};

/** Enqueues, claims, and runs one ingest job for a single raw file — the real
 * production path from an accepted request through to files landing (or not)
 * in the datastore. */
const ingestOneFile = async (run, uploadId, originalName) => {
  const { enqueueRunIngest, claimNextJob, runIngestJob } = require("../../lib/ingest-queue");

  const queued = await enqueueRunIngest({
    runId: run._id,
    payload: {
      rawFiles: [{ uploadName: uploadId, name: originalName, paired: false }],
      additionalFiles: [],
      rawFilesUploadInfo: { method: "local-filesystem" },
      username: "it-owner",
    },
  });

  const job = await claimNextJob({ workerId: "worker-1" });
  expect(job).not.toBeNull();
  expect(String(job._id)).toBe(String(queued._id));

  return runIngestJob(job);
};

describe("claiming an incomplete tus upload into a Run", () => {
  test("a short blob whose sidecar declares a larger size is refused, not silently moved", async () => {
    const { run } = await makeRunChain();

    const uploadId = await writeStagedUpload({
      directory: process.env.UPLOAD_DIRECTORY,
      declaredSize: 1000,
      blobBytes: 100,
      declaredOffset: 100, // the client genuinely only sent 100 of 1000 bytes
      owner: "it-owner",
    });

    const originalName = "incomplete-reads.fastq.gz";

    await expect(
      ingestOneFile(run, uploadId, originalName),
    ).rejects.toThrow();

    const destination = await expectedDatastoreDestination(run, originalName);
    const landedInDatastore = await fs.promises
      .access(destination)
      .then(() => true)
      .catch(() => false);

    expect(landedInDatastore).toBe(false);

    const Run = require("../../models/Run");
    const persisted = await Run.findById(run._id);
    expect(persisted.status).not.toBe("complete");
  });

  test("a sidecar that claims completion but whose blob was truncated on disk is also refused", async () => {
    // The subtler half of the same bug: offset === size in the sidecar (so an
    // ownership-only or offset-only check reads this as "done"), but the
    // actual bytes on disk are short — a stalled or truncated write. Only
    // checking the real file's size on disk catches this one.
    const { run } = await makeRunChain();

    const uploadId = await writeStagedUpload({
      directory: process.env.UPLOAD_DIRECTORY,
      declaredSize: 1000,
      blobBytes: 100,
      declaredOffset: 1000, // sidecar claims the upload finished
      owner: "it-owner",
    });

    const originalName = "truncated-reads.fastq.gz";

    await expect(
      ingestOneFile(run, uploadId, originalName),
    ).rejects.toThrow();

    const destination = await expectedDatastoreDestination(run, originalName);
    const landedInDatastore = await fs.promises
      .access(destination)
      .then(() => true)
      .catch(() => false);

    expect(landedInDatastore).toBe(false);
  });

  test("control: a genuinely complete upload IS claimed successfully", async () => {
    // Proves the two refusals above are really about incompleteness, not
    // about something generically broken in this test's setup.
    const { run } = await makeRunChain();

    const uploadId = await writeStagedUpload({
      directory: process.env.UPLOAD_DIRECTORY,
      declaredSize: 100,
      blobBytes: 100,
      declaredOffset: 100,
      owner: "it-owner",
    });

    const originalName = "complete-reads.fastq.gz";

    await ingestOneFile(run, uploadId, originalName);

    const destination = await expectedDatastoreDestination(run, originalName);
    const landedInDatastore = await fs.promises
      .access(destination)
      .then(() => true)
      .catch(() => false);

    expect(landedInDatastore).toBe(true);

    const Run = require("../../models/Run");
    const persisted = await Run.findById(run._id);
    expect(persisted.status).toBe("complete");
  });
});
