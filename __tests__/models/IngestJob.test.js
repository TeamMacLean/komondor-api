/**
 * Tests for the IngestJob schema — the record that makes accepted-but-unfinished
 * work survive a restart.
 *
 * No database: validateSync() and the declared index list are enough to pin the
 * two properties that matter. A wrong default here (a job that starts life as
 * anything but "pending", say) would strand work just as effectively as the
 * in-memory closure this model replaced.
 */

const mongoose = require("mongoose");

const IngestJob = require("../../models/IngestJob");

/** A minimally valid job document. */
const makeJob = (overrides = {}) =>
  new IngestJob({
    type: "run-ingest",
    runId: new mongoose.Types.ObjectId(),
    ...overrides,
  });

describe("IngestJob schema", () => {
  test("a new job starts pending, unclaimed and unattempted", () => {
    const job = makeJob();

    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.workerId).toBeUndefined();
    expect(job.leaseExpiresAt).toBeUndefined();
    expect(job.validateSync()).toBeUndefined();
  });

  test("requires the run it is ingesting", () => {
    const job = new IngestJob({ type: "run-ingest" });

    const error = job.validateSync();

    expect(error).toBeDefined();
    expect(error.errors.runId).toBeDefined();
  });

  test("requires a type", () => {
    const job = new IngestJob({ runId: new mongoose.Types.ObjectId() });

    const error = job.validateSync();

    expect(error).toBeDefined();
    expect(error.errors.type).toBeDefined();
  });

  test("rejects a status outside the lifecycle", () => {
    const job = makeJob({ status: "in_progress" });

    const error = job.validateSync();

    expect(error).toBeDefined();
    expect(error.errors.status).toBeDefined();
  });

  test("accepts every status the queue writes", () => {
    ["pending", "claimed", "done", "failed"].forEach((status) => {
      expect(makeJob({ status }).validateSync()).toBeUndefined();
    });
  });

  test("stores the request payload untouched", () => {
    // Mixed, so the shapes of rawFiles/additionalFiles are the route's problem
    // rather than something this model would silently drop on the way in.
    const payload = {
      rawFiles: [{ name: "reads_R1.fq", md5: "abc", sibling: "reads_R2.fq" }],
      additionalFiles: [{ name: "notes.txt" }],
      rawFilesUploadInfo: { method: "hpc-mv", relativePath: "batch-1" },
    };

    const job = makeJob({ payload });

    expect(job.payload).toEqual(payload);
    expect(job.validateSync()).toBeUndefined();
  });

  test("records the host a claim was made from, alongside the worker", () => {
    // Recovery asks "is the process that holds this claim still running?".
    // The workerId names one boot of one process and the host says whose
    // process list to answer that from, so both have to survive the restart
    // that goes looking.
    const job = makeJob({
      status: "claimed",
      workerId: "komondor-01:412:0123456789abcdef",
      workerHost: "komondor-01",
    });

    expect(job.workerHost).toBe("komondor-01");
    expect(job.validateSync()).toBeUndefined();
  });

  test("a job that was never claimed names no host", () => {
    // Jobs written before workerHost existed have none either, which is why
    // recovery still falls back to the lease for anything unattributed.
    expect(makeJob().workerHost).toBeUndefined();
  });

  test("keeps the requestId that accepted the work", () => {
    const job = makeJob({ requestId: "req-123" });

    expect(job.requestId).toBe("req-123");
  });

  describe("indexes", () => {
    const indexes = IngestJob.schema.indexes();

    /** The options declared for the first index matching `keys`. */
    const optionsFor = (keys) => {
      const match = indexes.find(
        ([indexKeys]) => JSON.stringify(indexKeys) === JSON.stringify(keys),
      );
      return match && match[1];
    };

    test("idempotencyKey is unique and sparse", () => {
      // Unique is what stops a retried enqueue queueing the same file moves
      // twice; sparse is what stops the index treating every key-less job as a
      // duplicate of the first one.
      const options = optionsFor({ idempotencyKey: 1 });

      expect(options).toBeDefined();
      expect(options.unique).toBe(true);
      expect(options.sparse).toBe(true);
    });

    test("status and leaseExpiresAt are indexed for the claim query", () => {
      expect(optionsFor({ status: 1 })).toBeDefined();
      expect(optionsFor({ leaseExpiresAt: 1 })).toBeDefined();
      expect(
        optionsFor({ status: 1, leaseExpiresAt: 1, createdAt: 1 }),
      ).toBeDefined();
    });
  });

  test("timestamps are enabled, so a lease-less claim can still be aged out", () => {
    expect(IngestJob.schema.options.timestamps).toBe(true);
  });
});
