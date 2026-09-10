/**
 * Real Mongo, real lib/ingest-queue.js: two workers racing to claim the same
 * job. claimNextJob is a single findOneAndUpdate specifically so this cannot
 * happen — an in-memory fake of Mongo would have to reimplement that
 * atomicity to prove anything here, which is exactly what would hide a
 * regression back to a find-then-update race.
 */

const { configureEnv, restoreEnv } = require("./support/env");
const {
  mongoose,
  connect,
  resetCollections,
  disconnect,
} = require("./support/mongo");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("ingest-concurrency");
  await connect();
});

afterAll(async () => {
  await disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await resetCollections();
});

describe("claimNextJob — concurrent claims on one pending job", () => {
  test("exactly one of two racing workers wins the claim", async () => {
    const {
      enqueueRunIngest,
      claimNextJob,
      IngestJob,
    } = require("../../lib/ingest-queue");

    const runId = new mongoose.Types.ObjectId();
    const queued = await enqueueRunIngest({
      runId,
      requestId: "it-race-1",
      payload: { rawFiles: [], additionalFiles: [] },
    });

    // Genuinely concurrent: both promises are created before either is
    // awaited, so both findOneAndUpdate calls are in flight together against
    // the real driver/server — not sequenced by test code.
    const [resultA, resultB] = await Promise.all([
      claimNextJob({ workerId: "worker-a" }),
      claimNextJob({ workerId: "worker-b" }),
    ]);

    const winners = [resultA, resultB].filter((r) => r !== null);
    const losers = [resultA, resultB].filter((r) => r === null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winnerId = winners[0].workerId;
    expect(["worker-a", "worker-b"]).toContain(winnerId);

    // The persisted row agrees with whichever result won — not just the
    // returned document, in case a bug returned a claim it never wrote.
    const persisted = await IngestJob.findById(queued._id);
    expect(persisted.status).toBe("claimed");
    expect(persisted.workerId).toBe(winnerId);

    // Claimed exactly once: a find-then-update race would let both workers
    // increment this, and a re-run under load would fail this assertion
    // even when the top-level "one winner" check above happened to pass.
    expect(persisted.attempts).toBe(1);
  });

  test("ten racing workers still produce exactly one winner", async () => {
    const {
      enqueueRunIngest,
      claimNextJob,
      IngestJob,
    } = require("../../lib/ingest-queue");

    const runId = new mongoose.Types.ObjectId();
    const queued = await enqueueRunIngest({
      runId,
      requestId: "it-race-2",
      payload: {},
    });

    const workerIds = Array.from({ length: 10 }, (_, i) => `worker-${i}`);
    const results = await Promise.all(
      workerIds.map((workerId) => claimNextJob({ workerId })),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);

    const persisted = await IngestJob.findById(queued._id);
    expect(persisted.attempts).toBe(1);
  });
});

describe("claimNextJob — recovery of a lapsed claim", () => {
  test("a lease that expired while claimed can be claimed by a new worker", async () => {
    const {
      enqueueRunIngest,
      claimNextJob,
      IngestJob,
    } = require("../../lib/ingest-queue");

    const runId = new mongoose.Types.ObjectId();
    const queued = await enqueueRunIngest({ runId, payload: {} });

    const firstClaim = await claimNextJob({
      workerId: "worker-dead",
      leaseMs: 5000,
    });
    expect(firstClaim).not.toBeNull();

    // Simulates the worker having died: the lease lapses without a heartbeat
    // or a completeJob/failJob call ever landing.
    await IngestJob.updateOne(
      { _id: queued._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
    );

    const secondClaim = await claimNextJob({ workerId: "worker-alive" });

    expect(secondClaim).not.toBeNull();
    expect(secondClaim.workerId).toBe("worker-alive");

    const persisted = await IngestJob.findById(queued._id);
    expect(persisted.workerId).toBe("worker-alive");
    // Both claims counted: a killed worker's attempt still costs a retry, or
    // a wedged job neither completes nor exhausts its retry budget.
    expect(persisted.attempts).toBe(2);
  });

  test("recoverStaleJobs returns an orphaned claim to pending before any claim races it", async () => {
    const {
      enqueueRunIngest,
      claimNextJob,
      recoverStaleJobs,
      IngestJob,
    } = require("../../lib/ingest-queue");

    const runId = new mongoose.Types.ObjectId();
    const queued = await enqueueRunIngest({ runId, payload: {} });

    await claimNextJob({ workerId: "worker-dead", leaseMs: 5000 });
    await IngestJob.updateOne(
      { _id: queued._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
    );

    const recovered = await recoverStaleJobs({ leaseMs: 5000 });
    expect(recovered).toBe(1);

    const persisted = await IngestJob.findById(queued._id);
    expect(persisted.status).toBe("pending");
    expect(persisted.workerId).toBeNull();
  });
});
