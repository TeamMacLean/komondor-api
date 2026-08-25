/**
 * Tests for lib/ingest-queue.js — the durable replacement for the setImmediate()
 * closure that used to do run ingest in process memory.
 *
 * The failures that matter here are the ones the old code could not even
 * detect: two workers running the same ingest because a claim was not atomic,
 * and work left claimed by a process that was SIGKILLed mid-job. Both are
 * exercised against a fake store that matches, mutates and returns in a single
 * uninterruptible step, the way MongoDB's findOneAndUpdate does — a fake that
 * awaited in between would let a broken claim pass.
 *
 * One limit, stated plainly rather than left to be discovered: that store is a
 * hand-rolled fake, and every atomicity claim below is only as good as it. It
 * does discriminate the real fixes — each test here was checked by reverting
 * the change it covers and watching it go red — but it is a model of MongoDB,
 * not MongoDB. Nothing in this file is evidence about the server's own
 * atomicity guarantees, about write concern, or about what two processes on
 * two machines actually do to one collection. Those rest on the driver
 * behaving as documented, and only an integration test against a real mongod
 * can say otherwise.
 */

const mongoose = require("mongoose");
const os = require("os");
const fsp = require("fs").promises;
const _path = require("path");

jest.mock("../../models/IngestJob");
jest.mock("../../models/Run");
jest.mock("../../models/Read");
jest.mock("../../models/AdditionalFile");
// NOT mocked at this boundary for the "re-run after a partial failure: the
// real move-and-pair pipeline" tests below, which need the real
// lib/sortAssociatedFiles.js (and so the real lib/file-utils.js underneath
// it) — see the comment on that describe block for why. models/File is
// mocked instead, one layer further down, so those tests still run against
// no real database.
jest.mock("../../models/File");
jest.mock("../../lib/sortAssociatedFiles");
jest.mock("../../lib/md5-verification");
jest.mock("../../lib/utils/sendOverseerEmail");
jest.mock("../../lib/utils/sendEmail");

const IngestJob = require("../../models/IngestJob");
const Run = require("../../models/Run");
const Read = require("../../models/Read");
const AdditionalFile = require("../../models/AdditionalFile");
const File = require("../../models/File");
const {
  sortReadFiles,
  sortAdditionalFiles,
} = require("../../lib/sortAssociatedFiles");
const { verifyRunMd5 } = require("../../lib/md5-verification");
const sendOverseerEmail = require("../../lib/utils/sendOverseerEmail");
const { sendMd5VerificationEmail } = require("../../lib/utils/sendEmail");

const {
  enqueueRunIngest,
  requeueRunIngest,
  claimNextJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  runIngestJob,
  startIngestWorker,
  getLastTickAt,
  idempotencyKeyFor,
} = require("../../lib/ingest-queue");

// ---------------------------------------------------------------------------
// A minimal stand-in for the bits of MongoDB the queue relies on.
// ---------------------------------------------------------------------------

/** Whether a single field satisfies one filter condition. */
const matchesCondition = (value, condition) => {
  // `field: null` matches both null and missing in MongoDB, which is exactly
  // what "this job has no lease" has to mean.
  if (condition === null) {
    return value === null || value === undefined;
  }

  if (
    condition &&
    typeof condition === "object" &&
    !(condition instanceof Date)
  ) {
    return Object.entries(condition).every(([operator, operand]) => {
      if (operator === "$nin") {
        // $nin matches a missing field, unlike the range operators below —
        // which is what makes "claimed by nothing this process is running"
        // catch a job whose workerId was never written.
        return !operand.some(
          (candidate) => String(value) === String(candidate),
        );
      }
      if (value === null || value === undefined) {
        // Comparison operators are type-bracketed: a missing date matches
        // neither $lt nor $gt.
        return false;
      }
      if (operator === "$lt") return value < operand;
      if (operator === "$lte") return value <= operand;
      if (operator === "$gt") return value > operand;
      throw new Error(`Fake store does not implement ${operator}`);
    });
  }

  return String(value) === String(condition);
};

/** Whether a document satisfies a filter, including nested $or. */
const matchesFilter = (doc, filter) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") {
      return condition.some((sub) => matchesFilter(doc, sub));
    }
    return matchesCondition(doc[key], condition);
  });

/** Applies the $set / $inc operators the queue uses. */
const applyUpdate = (doc, update) => {
  Object.entries(update.$set || {}).forEach(([key, value]) => {
    doc[key] = value;
  });
  Object.entries(update.$inc || {}).forEach(([key, value]) => {
    doc[key] = (doc[key] || 0) + value;
  });
};

/**
 * Wires IngestJob's statics to an in-memory collection.
 *
 * findOneAndUpdate does all of its work synchronously before returning a
 * settled promise, which is what makes it a fair model of an atomic server-side
 * update: no other caller can observe the document between the match and the
 * write.
 *
 * @param {Array<object>} jobs - The documents in the collection.
 */
const useAtomicStore = (jobs) => {
  IngestJob.findOneAndUpdate = jest.fn((filter, update, options = {}) => {
    const candidates = jobs.filter((job) => matchesFilter(job, filter));

    if (options.sort) {
      const [key] = Object.keys(options.sort);
      candidates.sort((a, b) =>
        a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0,
      );
    }

    const job = candidates[0];
    if (!job) {
      return Promise.resolve(null);
    }

    applyUpdate(job, update);
    return Promise.resolve({ ...job });
  });

  IngestJob.updateMany = jest.fn((filter, update) => {
    const matched = jobs.filter((job) => matchesFilter(job, filter));
    matched.forEach((job) => applyUpdate(job, update));
    return Promise.resolve({ nModified: matched.length });
  });

  return jobs;
};

/** Lets queued microtasks settle without leaning on real timers. */
const flush = async (times = 25) => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

const runId = new mongoose.Types.ObjectId();
const jobId = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// A real datastore on disk.
//
// "Already ingested" has to mean the bytes are at the destination, so the
// fixtures for a re-run put them there — or leave them in the staging
// directory, which is what an attempt that saved its Read documents and then
// failed every move actually leaves behind.
// ---------------------------------------------------------------------------

const RUN_REL_PATH = "group/project/sample/run";
const ORIGINAL_DATASTORE_ROOT = process.env.DATASTORE_ROOT;

let tmpRoot;
let datastoreRoot;
let stagingDir;

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(_path.join(os.tmpdir(), "ingest-queue-"));
  datastoreRoot = _path.join(tmpRoot, "datastore");
  stagingDir = _path.join(tmpRoot, "staging");

  await fsp.mkdir(_path.join(datastoreRoot, RUN_REL_PATH, "raw"), {
    recursive: true,
  });
  await fsp.mkdir(_path.join(datastoreRoot, RUN_REL_PATH, "additional"), {
    recursive: true,
  });
  await fsp.mkdir(stagingDir, { recursive: true });

  process.env.DATASTORE_ROOT = datastoreRoot;
});

afterAll(async () => {
  if (ORIGINAL_DATASTORE_ROOT === undefined) {
    delete process.env.DATASTORE_ROOT;
  } else {
    process.env.DATASTORE_ROOT = ORIGINAL_DATASTORE_ROOT;
  }

  if (tmpRoot) {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
});

/**
 * A populated document whose file really did land in the datastore.
 *
 * Carries an _id because the steps that follow the move work on the documents
 * themselves — linking a read to its sibling — and not just on their names.
 *
 * @param {string} originalName - The file's name in the request.
 * @param {string} subdir - "raw" for reads, "additional" for the rest.
 * @param {object} [overrides] - Extra document fields, e.g. an existing sibling.
 * @returns {Promise<object>} A stand-in for a Read/AdditionalFile document.
 */
const movedDoc = async (originalName, subdir, overrides = {}) => {
  const relPath = _path.join(RUN_REL_PATH, subdir, originalName);
  await fsp.writeFile(_path.join(datastoreRoot, relPath), "ACGT\n");
  return {
    _id: new mongoose.Types.ObjectId(),
    file: { originalName, path: relPath },
    ...overrides,
  };
};

/**
 * A document saved by an attempt whose move never happened.
 *
 * processSingleReadFile (lib/file-utils.js) saves the Read *before* calling
 * moveToFolderAndSave, so a batch where every move failed leaves exactly this:
 * a row in the database and a multi-GB file still sitting in staging.
 *
 * @param {string} originalName - The file's name in the request.
 * @returns {Promise<object>} A stand-in for a Read/AdditionalFile document.
 */
const unmovedDoc = async (originalName) => {
  const sourcePath = _path.join(stagingDir, originalName);
  await fsp.writeFile(sourcePath, "ACGT\n");
  return { file: { originalName, path: sourcePath } };
};

/** Wires Read.find().populate() to a fixed list of documents. */
const existingReads = (docs) => {
  Read.find.mockReturnValue({
    populate: jest.fn().mockResolvedValue(docs),
  });
};

/** Wires AdditionalFile.find().populate() to a fixed list of documents. */
const existingAdditionalFiles = (docs) => {
  AdditionalFile.find.mockReturnValue({
    populate: jest.fn().mockResolvedValue(docs),
  });
};

/** A claimed job as the worker would see it. */
const makeJob = (overrides = {}) => ({
  _id: jobId,
  type: "run-ingest",
  runId,
  requestId: "req-1",
  status: "claimed",
  attempts: 1,
  maxAttempts: 3,
  payload: {},
  ...overrides,
});

const makeRun = () => ({
  _id: runId,
  name: "Test Run",
  path: "group/project/sample/run",
});

beforeEach(() => {
  jest.clearAllMocks();

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  IngestJob.findOneAndUpdate = jest.fn().mockResolvedValue(null);
  IngestJob.findOne = jest.fn().mockResolvedValue(null);
  IngestJob.findById = jest.fn().mockResolvedValue(null);
  IngestJob.updateOne = jest.fn().mockResolvedValue({});
  IngestJob.updateMany = jest.fn().mockResolvedValue({ nModified: 0 });
  IngestJob.find = jest.fn().mockResolvedValue([]);

  Run.findById = jest.fn().mockResolvedValue(makeRun());
  Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});

  Read.find = jest.fn().mockReturnValue({
    populate: jest.fn().mockResolvedValue([]),
  });
  Read.updateOne = jest.fn().mockResolvedValue({ nModified: 1 });
  AdditionalFile.find = jest.fn().mockReturnValue({
    populate: jest.fn().mockResolvedValue([]),
  });

  sortReadFiles.mockResolvedValue(undefined);
  sortAdditionalFiles.mockResolvedValue(undefined);
  sendOverseerEmail.mockResolvedValue(undefined);
  sendMd5VerificationEmail.mockResolvedValue(undefined);
  verifyRunMd5.mockResolvedValue({
    success: true,
    filesVerified: 2,
    mismatches: 0,
    errors: 0,
    duration: 10,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("enqueueRunIngest", () => {
  test("records the work under a key derived from the run", async () => {
    const job = makeJob({ status: "pending", attempts: 0 });
    IngestJob.findOneAndUpdate.mockResolvedValue(job);

    const result = await enqueueRunIngest({
      runId,
      requestId: "req-1",
      payload: { rawFiles: [{ name: "reads.fq" }] },
    });

    expect(result).toBe(job);
    expect(IngestJob.findOneAndUpdate).toHaveBeenCalledWith(
      { idempotencyKey: idempotencyKeyFor(runId) },
      {
        $setOnInsert: expect.objectContaining({
          type: "run-ingest",
          runId,
          requestId: "req-1",
          status: "pending",
          attempts: 0,
          payload: { rawFiles: [{ name: "reads.fq" }] },
        }),
      },
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  test("uses $setOnInsert so a repeat enqueue does not requeue the files", async () => {
    // The second call must land on the existing job rather than overwrite its
    // status back to pending — that would re-run an ingest already in flight.
    IngestJob.findOneAndUpdate.mockResolvedValue(makeJob());

    await enqueueRunIngest({ runId, payload: {} });

    const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
    expect(update.$set).toBeUndefined();
    expect(update.$setOnInsert).toBeDefined();
  });

  test("returns the existing job when two enqueues race the unique index", async () => {
    const existing = makeJob({ status: "pending" });
    const duplicate = new Error("E11000 duplicate key error");
    duplicate.code = 11000;
    IngestJob.findOneAndUpdate.mockRejectedValue(duplicate);
    IngestJob.findOne.mockResolvedValue(existing);

    const result = await enqueueRunIngest({ runId, payload: {} });

    expect(result).toBe(existing);
    expect(IngestJob.findOne).toHaveBeenCalledWith({
      idempotencyKey: idempotencyKeyFor(runId),
    });
  });

  test("propagates any other write failure, so the route can refuse the request", async () => {
    IngestJob.findOneAndUpdate.mockRejectedValue(new Error("mongo is down"));

    await expect(enqueueRunIngest({ runId, payload: {} })).rejects.toThrow(
      "mongo is down",
    );
  });

  test("refuses to queue work with no run to attach it to", async () => {
    await expect(enqueueRunIngest({ payload: {} })).rejects.toThrow(
      "requires a runId",
    );
  });
});

describe("requeueRunIngest", () => {
  // The operator-facing retry. Before it existed a permanently failed ingest
  // had no retry at all: enqueueRunIngest is $setOnInsert, so a re-POST to
  // /runs/new finds the dead job and changes nothing.
  test("resets a failed job to pending and returns it", async () => {
    const requeued = makeJob({ status: "pending", attempts: 0 });
    IngestJob.findOneAndUpdate.mockResolvedValue(requeued);

    const result = await requeueRunIngest({ runId, requestId: "req-retry" });

    expect(result).toBe(requeued);
    expect(IngestJob.findOneAndUpdate).toHaveBeenCalledWith(
      { idempotencyKey: idempotencyKeyFor(runId), status: "failed" },
      {
        $set: {
          status: "pending",
          attempts: 0,
          lastError: null,
          workerId: null,
          leaseExpiresAt: null,
          requestId: "req-retry",
        },
      },
      { new: true },
    );
  });

  test("puts attempts back to zero, or the retry is re-failed unattempted", async () => {
    // claimNextJob increments attempts as it claims and fails outright
    // anything already past maxAttempts, so a job left at 3/3 would be marked
    // failed again on the very next poll without the ingest ever being run.
    IngestJob.findOneAndUpdate.mockResolvedValue(makeJob());

    await requeueRunIngest({ runId });

    const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
    expect(update.$set.attempts).toBe(0);
  });

  test("matches the status inside the update, not before it", async () => {
    // A job a worker has claimed in the meantime must not be dragged back to
    // pending underneath it. Only an atomic match can promise that.
    IngestJob.findOneAndUpdate.mockResolvedValue(makeJob());

    await requeueRunIngest({ runId });

    expect(IngestJob.find).not.toHaveBeenCalled();
    expect(IngestJob.findOne).not.toHaveBeenCalled();
    const [filter] = IngestJob.findOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe("failed");
  });

  test("clears the lease so the next poll can claim it", async () => {
    IngestJob.findOneAndUpdate.mockResolvedValue(makeJob());

    await requeueRunIngest({ runId });

    const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
    expect(update.$set.leaseExpiresAt).toBeNull();
    expect(update.$set.workerId).toBeNull();
  });

  test("returns null when no failed job matched", async () => {
    IngestJob.findOneAndUpdate.mockResolvedValue(null);

    await expect(requeueRunIngest({ runId })).resolves.toBeNull();
  });

  test("refuses to requeue with no run to look one up by", async () => {
    await expect(requeueRunIngest({})).rejects.toThrow("requires a runId");
  });
});

describe("claimNextJob", () => {
  test("two workers racing for one job: exactly one gets it", async () => {
    useAtomicStore([
      { _id: jobId, status: "pending", attempts: 0, createdAt: new Date(1) },
    ]);

    const [first, second] = await Promise.all([
      claimNextJob({ workerId: "worker-a", leaseMs: 1000 }),
      claimNextJob({ workerId: "worker-b", leaseMs: 1000 }),
    ]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]._id).toEqual(jobId);
  });

  test("claims with a single atomic write, never find-then-update", async () => {
    // A find() followed by an update() is the bug this test exists to prevent:
    // both workers would read the same pending job before either wrote a claim.
    useAtomicStore([
      { _id: jobId, status: "pending", attempts: 0, createdAt: new Date(1) },
    ]);

    await claimNextJob({ workerId: "worker-a", leaseMs: 1000 });

    expect(IngestJob.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(IngestJob.find).not.toHaveBeenCalled();
    expect(IngestJob.updateOne).not.toHaveBeenCalled();
  });

  test("stamps the worker, the lease and the attempt onto the job", async () => {
    const jobs = useAtomicStore([
      { _id: jobId, status: "pending", attempts: 0, createdAt: new Date(1) },
    ]);
    const before = Date.now();

    const claimed = await claimNextJob({
      workerId: "worker-a",
      leaseMs: 60000,
    });

    expect(claimed.status).toBe("claimed");
    expect(claimed.workerId).toBe("worker-a");
    expect(claimed.attempts).toBe(1);
    expect(jobs[0].leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 60000,
    );
  });

  test("takes the oldest job first", async () => {
    const older = new mongoose.Types.ObjectId();
    useAtomicStore([
      { _id: jobId, status: "pending", attempts: 0, createdAt: new Date(2000) },
      { _id: older, status: "pending", attempts: 0, createdAt: new Date(1000) },
    ]);

    const claimed = await claimNextJob({ workerId: "worker-a", leaseMs: 1000 });

    expect(claimed._id).toEqual(older);
  });

  test("takes over a job whose lease expired with the worker that held it", async () => {
    // The SIGKILL case: nothing released this claim from the inside, and
    // nothing ever will.
    useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "dead-worker",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(1),
      },
    ]);

    const claimed = await claimNextJob({ workerId: "worker-b", leaseMs: 1000 });

    expect(claimed.workerId).toBe("worker-b");
    expect(claimed.attempts).toBe(2);
  });

  test("leaves a job whose lease is still live alone", async () => {
    useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "worker-a",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(1),
      },
    ]);

    expect(
      await claimNextJob({ workerId: "worker-b", leaseMs: 1000 }),
    ).toBeNull();
  });

  test("leaves a retry whose backoff has not elapsed", async () => {
    useAtomicStore([
      {
        _id: jobId,
        status: "pending",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() + 30000),
        createdAt: new Date(1),
      },
    ]);

    expect(
      await claimNextJob({ workerId: "worker-a", leaseMs: 1000 }),
    ).toBeNull();
  });

  test("claims a retry once its backoff has elapsed", async () => {
    useAtomicStore([
      {
        _id: jobId,
        status: "pending",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1),
        createdAt: new Date(1),
      },
    ]);

    const claimed = await claimNextJob({ workerId: "worker-a", leaseMs: 1000 });

    expect(claimed.attempts).toBe(2);
  });

  test("returns null when the queue is empty", async () => {
    useAtomicStore([]);

    expect(await claimNextJob({ workerId: "worker-a" })).toBeNull();
  });
});

describe("recoverStaleJobs", () => {
  test("returns a claim whose holder stopped renewing its lease", async () => {
    // What a SIGKILL mid-ingest leaves behind. The lease is a liveness record
    // written by the process being asked about: its holder renews it on every
    // poll (see the heartbeat tests below), so a lapsed one says that holder
    // stopped. That answer is scoped the way the question is — it holds across
    // processes and across machines, neither of which this process can see
    // into.
    const stillRenewing = new mongoose.Types.ObjectId();
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: `${os.hostname()}:412:0123456789abcdef`,
        workerHost: os.hostname(),
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      },
      {
        // Another host's worker, still renewing. Nothing this process knows
        // says that one is dead — and nothing it can find out would.
        _id: stillRenewing,
        status: "claimed",
        workerId: "komondor-02:99:fedcba9876543210",
        workerHost: "komondor-02",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() + 60000),
        updatedAt: new Date(),
      },
    ]);

    const recovered = await recoverStaleJobs({ leaseMs: 60000 });

    expect(recovered).toBe(1);
    expect(jobs[0]).toMatchObject({
      status: "pending",
      workerId: null,
      // Cleared, so the recovered job is claimable at once rather than
      // serving out a backoff nobody is waiting on.
      leaseExpiresAt: null,
    });
    expect(jobs[1].status).toBe("claimed");
  });

  test("leaves a claim another process on this host is still renewing", async () => {
    // The attack this lost to before, run for real by a reviewer: a second
    // module instance's startup recovery yanked the first's in-flight claim,
    // because "on my host and not in my in-memory set of workers" was read as
    // "dead". It is not — the set is process-scoped and knows nothing about
    // any other process. Both instances then ran the same ingest; the claim
    // fence keeps the job row consistent and does exactly nothing for the
    // files or for the duplicate File/Read documents.
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        // This host, a pid and boot id this process has never heard of: what
        // a perfectly healthy sibling worker looks like from here.
        workerId: `${os.hostname()}:9184:aaaabbbbccccdddd`,
        workerHost: os.hostname(),
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() + 4 * 60 * 1000),
        updatedAt: new Date(),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 5 * 60 * 1000 })).toBe(0);
    expect(jobs[0].status).toBe("claimed");
  });

  test("recovers a claim stamped by a hostname that no longer exists", async () => {
    // A container or pod comes back under a new name after every restart, so
    // the dead worker's host never matches the new one's. When recovery
    // depended on that match, this deployment had no recovery at all and the
    // job sat until the lease ran out — the original bug, fully intact, for
    // anything without a stable hostname.
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "komondor-api-7d9f-2xk:1:0011223344556677",
        workerHost: "komondor-api-7d9f-2xk",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1),
        updatedAt: new Date(),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(1);
    expect(jobs[0].status).toBe("pending");
  });

  test("leaves a job held by a worker still live in this process", async () => {
    // The one direction an in-memory set can answer honestly: this process
    // knows which workers it started. The lease here has already lapsed — the
    // worker is overrunning, or the database was briefly unreachable — and the
    // job is still not ours to reclaim while we are the ones inside it. Some
    // other process may take it over; we would only be racing ourselves.
    const worker = startIngestWorker({
      intervalMs: 60000,
      leaseMs: 60000,
      workerId: "live-worker",
    });

    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "live-worker",
        workerHost: os.hostname(),
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(0);
    expect(jobs[0].status).toBe("claimed");

    await worker.stop();

    // Once that worker is gone its claims are nobody's.
    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(1);
    expect(jobs[0].status).toBe("pending");
  });

  test("still ages out an expired lease from an unknown host", async () => {
    // Nothing here identifies the holder, so the lease is all there is to go on.
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "komondor-02:1:abc",
        workerHost: "komondor-02",
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(Date.now() - 1000),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(1);
    expect(jobs[0].status).toBe("pending");
  });

  test("ages out a claim that never got a lease written", async () => {
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "dead-worker",
        attempts: 1,
        leaseExpiresAt: null,
        updatedAt: new Date(Date.now() - 120000),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(1);
    expect(jobs[0].status).toBe("pending");
  });

  test("leaves a lease-less claim that is still recent", async () => {
    const jobs = useAtomicStore([
      {
        _id: jobId,
        status: "claimed",
        workerId: "worker-a",
        attempts: 1,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    ]);

    expect(await recoverStaleJobs({ leaseMs: 60000 })).toBe(0);
    expect(jobs[0].status).toBe("claimed");
  });

  test("counts modified documents from either driver's result shape", async () => {
    IngestJob.updateMany.mockResolvedValue({ modifiedCount: 4 });
    expect(await recoverStaleJobs({ leaseMs: 1000 })).toBe(4);

    IngestJob.updateMany.mockResolvedValue({ nModified: 2 });
    expect(await recoverStaleJobs({ leaseMs: 1000 })).toBe(2);
  });
});

describe("completeJob", () => {
  test("closes the job and drops its lease", async () => {
    await completeJob(jobId);

    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId },
      {
        $set: {
          status: "done",
          workerId: null,
          workerHost: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      },
    );
  });

  test("fences the write on the worker that holds the claim", async () => {
    await completeJob(jobId, "worker-a");

    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId, workerId: "worker-a" },
      expect.anything(),
    );
  });

  test("refuses to close a job that has been taken over, and says so", async () => {
    // A worker whose lease expired mid-move is still running. Without the
    // fence it marks a job done that another worker is now doing, and the
    // second worker's failure lands on a job already recorded as finished.
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 0 });

    expect(await completeJob(jobId, "worker-a")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("no longer holds"),
    );
  });

  test("reports success when the fenced write lands", async () => {
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 1 });

    expect(await completeJob(jobId, "worker-a")).toBe(true);
  });
});

describe("failJob", () => {
  /** The $set of the first updateOne call. */
  const firstUpdate = () => IngestJob.updateOne.mock.calls[0][1].$set;

  test("returns the job to the queue with a backoff while attempts remain", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 1, maxAttempts: 3 }),
    );
    const before = Date.now();

    await failJob(jobId, new Error("mount is unresponsive"), { retry: true });

    const update = firstUpdate();
    expect(update.status).toBe("pending");
    expect(update.workerId).toBeNull();
    expect(update.lastError).toBe("mount is unresponsive");
    expect(update.leaseExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      30000,
    );
    expect(update.leaseExpiresAt.getTime() - before).toBeLessThan(35000);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("backs off further on each successive attempt", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 2, maxAttempts: 5 }),
    );
    const before = Date.now();

    await failJob(jobId, new Error("still unresponsive"));

    expect(
      firstUpdate().leaseExpiresAt.getTime() - before,
    ).toBeGreaterThanOrEqual(60000);
  });

  test("marks the run errored once the attempts are used up", async () => {
    // A job nobody will retry is work the API promised and will never do. It
    // has to surface somewhere an operator looks, which is the Run.
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 3, maxAttempts: 3 }),
    );

    await failJob(jobId, new Error("no space left on device"));

    expect(firstUpdate()).toMatchObject({
      status: "failed",
      lastError: "no space left on device",
      leaseExpiresAt: null,
    });
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
      $set: { status: "error", statusError: "no space left on device" },
    });
  });

  test("fails terminally when the caller says not to retry", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 1, maxAttempts: 3 }),
    );

    await failJob(jobId, new Error("payload is unusable"), { retry: false });

    expect(firstUpdate().status).toBe("failed");
    expect(Run.findByIdAndUpdate).toHaveBeenCalled();
  });

  test("accepts a plain string as the error", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 3, maxAttempts: 3 }),
    );

    await failJob(jobId, "something went wrong", { retry: false });

    expect(firstUpdate().lastError).toBe("something went wrong");
  });

  test("logs rather than throws when the job has gone", async () => {
    IngestJob.findById.mockResolvedValue(null);

    await expect(failJob(jobId, new Error("boom"))).resolves.toBeUndefined();
    expect(IngestJob.updateOne).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("no such job"),
    );
  });

  test("fences its write on the worker that holds the claim", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 1, maxAttempts: 3 }),
    );

    await failJob(jobId, new Error("mount is unresponsive"), {
      workerId: "worker-a",
    });

    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId, workerId: "worker-a" },
      expect.anything(),
    );
  });

  test("does not error the run from a worker whose job was taken over", async () => {
    // The takeover worker is mid-attempt. Marking the run errored from here
    // would report a failure for work that is still running.
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 3, maxAttempts: 3 }),
    );
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 0 });

    await failJob(jobId, new Error("no space left on device"), {
      workerId: "worker-a",
    });

    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("no longer holds"),
    );
  });

  test("still records the failed job when the run cannot be updated", async () => {
    IngestJob.findById.mockResolvedValue(
      makeJob({ attempts: 3, maxAttempts: 3 }),
    );
    Run.findByIdAndUpdate.mockRejectedValue(new Error("run write failed"));

    await expect(failJob(jobId, new Error("boom"))).resolves.toBeUndefined();
    expect(firstUpdate().status).toBe("failed");
  });
});

describe("runIngestJob", () => {
  test("moves raw and additional files with the arguments the route used", async () => {
    const payload = {
      rawFiles: [{ name: "reads_R1.fq" }],
      additionalFiles: [{ name: "notes.txt" }],
      rawFilesUploadInfo: { method: "hpc-mv", relativePath: "batch-1" },
      username: "submitter",
    };

    await runIngestJob(makeJob({ payload }));

    // The submitting user travels with the job: the ingest claims that
    // person's staged uploads at claim time, and lib/file-utils.js refuses a
    // claim on an upload somebody else staged.
    expect(sortReadFiles).toHaveBeenCalledWith(
      payload.rawFiles,
      runId,
      "group/project/sample/run",
      payload.rawFilesUploadInfo,
      "submitter",
    );
    expect(sortAdditionalFiles).toHaveBeenCalledWith(
      payload.additionalFiles,
      "run",
      runId,
      "group/project/sample/run",
      "submitter",
    );
  });

  test("does nothing with file processing when the payload carries no files", async () => {
    await runIngestJob(makeJob({ payload: {} }));

    expect(sortReadFiles).not.toHaveBeenCalled();
    expect(sortAdditionalFiles).not.toHaveBeenCalled();
    expect(sendOverseerEmail).toHaveBeenCalled();
  });

  test("emails the overseer only after the files are in place, then verifies MD5", async () => {
    await runIngestJob(
      makeJob({ payload: { rawFiles: [{ name: "reads_R1.fq" }] } }),
    );

    expect(sendOverseerEmail).toHaveBeenCalledWith({
      type: "Run",
      data: expect.objectContaining({ _id: runId }),
    });
    expect(sortReadFiles.mock.invocationCallOrder[0]).toBeLessThan(
      sendOverseerEmail.mock.invocationCallOrder[0],
    );
    expect(sendOverseerEmail.mock.invocationCallOrder[0]).toBeLessThan(
      verifyRunMd5.mock.invocationCallOrder[0],
    );
  });

  test("stays silent when MD5 verification finds nothing wrong", async () => {
    await runIngestJob(makeJob());

    expect(verifyRunMd5).toHaveBeenCalledWith(runId);
    expect(sendMd5VerificationEmail).not.toHaveBeenCalled();
  });

  test("emails when MD5 verification reports mismatches", async () => {
    verifyRunMd5.mockResolvedValue({
      filesVerified: 2,
      mismatches: 1,
      errors: 0,
      duration: 42,
    });

    await runIngestJob(makeJob());

    expect(sendMd5VerificationEmail).toHaveBeenCalledWith({
      runId,
      runName: "Test Run",
      filesVerified: 2,
      mismatches: 1,
      errors: 0,
      duration: 42,
    });
  });

  test("emails when MD5 verification could not read a file", async () => {
    verifyRunMd5.mockResolvedValue({
      filesVerified: 1,
      mismatches: 0,
      errors: 2,
      duration: 7,
    });

    await runIngestJob(makeJob());

    expect(sendMd5VerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ errors: 2 }),
    );
  });

  test("a failed overseer email does not fail the ingest", async () => {
    sendOverseerEmail.mockRejectedValue(new Error("smtp refused"));

    await expect(runIngestJob(makeJob())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[req-1] Failed to send overseer email for run " + runId + ":",
      expect.any(Error),
    );
  });

  test("a failed MD5 pass does not fail the ingest", async () => {
    // The files are already in place, and the 5-minute background job
    // re-verifies anything still marked pending.
    verifyRunMd5.mockRejectedValue(new Error("checksum read failed"));

    await expect(runIngestJob(makeJob())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[req-1] Failed to verify MD5 for run " + runId + ":",
      expect.any(Error),
    );
  });

  test("a failed MD5 notification does not fail the ingest", async () => {
    verifyRunMd5.mockResolvedValue({ mismatches: 1, errors: 0 });
    sendMd5VerificationEmail.mockRejectedValue(new Error("smtp refused"));

    await expect(runIngestJob(makeJob())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[req-1] Failed to send MD5 verification failure email for run " +
        runId +
        ":",
      expect.any(Error),
    );
  });

  test("re-throws when the files cannot be moved", async () => {
    // The route logged this and dropped it, which is precisely why a failed
    // ingest left no trace. Here it has to reach the worker.
    sortReadFiles.mockRejectedValue(new Error("no space left on device"));

    await expect(
      runIngestJob(makeJob({ payload: { rawFiles: [{ name: "reads.fq" }] } })),
    ).rejects.toThrow("no space left on device");

    expect(console.error).toHaveBeenCalledWith(
      "[req-1] Background processing failed for run " + runId + ":",
      expect.any(Error),
    );
  });

  test("throws when the run has been deleted since the job was queued", async () => {
    Run.findById.mockResolvedValue(null);

    await expect(runIngestJob(makeJob())).rejects.toThrow("no longer exists");
    expect(sortReadFiles).not.toHaveBeenCalled();
  });

  describe("re-run after a partial failure", () => {
    test("skips raw files a previous attempt already moved", async () => {
      // Both files are already in the datastore; moving them again cannot
      // succeed and must not be attempted.
      existingReads([
        await movedDoc("reads_R1.fq", "raw"),
        await movedDoc("reads_R2.fq", "raw"),
      ]);

      await runIngestJob(
        makeJob({
          payload: {
            rawFiles: [{ name: "reads_R1.fq" }, { name: "reads_R2.fq" }],
          },
        }),
      );

      expect(sortReadFiles).not.toHaveBeenCalled();

      // But the steps that come *after* the move are not skipped along with
      // it. sortReadFiles is processReadFiles, which moves the files and then
      // links paired siblings and writes the run's "complete" status; a kill
      // between the last move and the completeJob write is precisely what
      // produces this fixture. Skipping the whole call left a run whose files
      // were all delivered sitting at "pending" for good — indistinguishable
      // from one whose ingest never started, and beyond the reach of
      // POST /runs/:id/reingest, which requeues a "failed" job and answers 409
      // for the "done" one this path records.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
        $set: { status: "complete" },
      });

      // The rest of the job still runs: the earlier attempt died before it.
      expect(sendOverseerEmail).toHaveBeenCalled();
      expect(verifyRunMd5).toHaveBeenCalled();
    });

    test("links paired siblings the interrupted attempt never reached", async () => {
      // Step 5 of processReadFiles, owed for the same reason step 6 is: the
      // files are all in place, so nothing will call processReadFiles again,
      // so nothing else in the system will ever pair these two reads.
      const r1 = await movedDoc("paired_R1.fq", "raw");
      const r2 = await movedDoc("paired_R2.fq", "raw");
      existingReads([r1, r2]);

      await runIngestJob(
        makeJob({
          payload: {
            rawFiles: [
              { name: "paired_R1.fq", sibling: "paired_R2.fq" },
              { name: "paired_R2.fq", sibling: "paired_R1.fq" },
            ],
            rawFilesUploadInfo: { method: "hpc-mv" },
          },
        }),
      );

      expect(sortReadFiles).not.toHaveBeenCalled();
      expect(Read.updateOne).toHaveBeenCalledWith(
        { _id: r1._id },
        { $set: { sibling: r2._id } },
      );
      expect(Read.updateOne).toHaveBeenCalledWith(
        { _id: r2._id },
        { $set: { sibling: r1._id } },
      );
    });

    test("pairs a local-filesystem upload by its rowID, as file-utils does", async () => {
      // The other pairing rule: a local-filesystem upload names no sibling,
      // it puts both halves on one row of the submission form.
      const r1 = await movedDoc("row_R1.fq", "raw");
      const r2 = await movedDoc("row_R2.fq", "raw");
      existingReads([r1, r2]);

      await runIngestJob(
        makeJob({
          payload: {
            rawFiles: [
              { name: "row_R1.fq", paired: true, rowID: "row-7" },
              { name: "row_R2.fq", paired: true, rowID: "row-7" },
            ],
            rawFilesUploadInfo: { method: "local-filesystem" },
          },
        }),
      );

      expect(Read.updateOne).toHaveBeenCalledWith(
        { _id: r1._id },
        { $set: { sibling: r2._id } },
      );
      expect(Read.updateOne).toHaveBeenCalledWith(
        { _id: r2._id },
        { $set: { sibling: r1._id } },
      );
    });

    test("leaves an already-linked pair alone", async () => {
      // The ordinary case for a retry: the previous attempt got as far as the
      // pairing and died before the status write. Rewriting the same value
      // would be harmless, but a write that is not needed is a write that can
      // fail, and this path exists to finish a job, not to churn it.
      const r1 = await movedDoc("linked_R1.fq", "raw");
      const r2 = await movedDoc("linked_R2.fq", "raw");
      r1.sibling = r2._id;
      r2.sibling = r1._id;
      existingReads([r1, r2]);

      await runIngestJob(
        makeJob({
          payload: {
            rawFiles: [
              { name: "linked_R1.fq", sibling: "linked_R2.fq" },
              { name: "linked_R2.fq", sibling: "linked_R1.fq" },
            ],
            rawFilesUploadInfo: { method: "hpc-mv" },
          },
        }),
      );

      expect(Read.updateOne).not.toHaveBeenCalled();
      // Still finished, which is the whole point of coming back here.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
        $set: { status: "complete" },
      });
    });

    test("finalises after sortReadFiles's move completes, on a fresh run too", async () => {
      // processReadFiles no longer pairs or completes the run itself (see its
      // module doc comment) — finaliseReadStage always does, strictly after
      // the move, whether anything was pre-ingested or not. sortReadFiles is
      // mocked here (as everywhere in this describe block above the "real
      // move-and-pair pipeline" tests below), so it reports no newly-created
      // reads of its own; the single unpaired file needs no sibling link, but
      // the run still has to reach "complete".
      existingReads([await unmovedDoc("stranded.fq")]);

      await runIngestJob(
        makeJob({ payload: { rawFiles: [{ name: "stranded.fq" }] } }),
      );

      expect(sortReadFiles).toHaveBeenCalled();
      expect(Read.updateOne).not.toHaveBeenCalled();
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
        $set: { status: "complete" },
      });
    });

    test("does not mark a run complete when it never had raw files", async () => {
      // processReadFiles returns before its status write for an empty list,
      // and a run with no reads has never been marked complete by this path.
      // Finalising here would invent a state the ingest never produced.
      existingAdditionalFiles([]);

      await runIngestJob(
        makeJob({ payload: { additionalFiles: [{ name: "notes.txt" }] } }),
      );

      expect(sortAdditionalFiles).toHaveBeenCalled();
      expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    test("re-throws when the post-move steps fail, rather than reporting done", async () => {
      // Where the failure goes now that this code exists: out to the worker,
      // which retries the job and, once the attempts are gone, marks the run
      // errored with the message on it. Swallowing it would put the run back
      // in the state this whole change is about — files delivered, run stuck
      // at "pending", nothing left that will ever fix it.
      existingReads([await movedDoc("done.fq", "raw")]);
      Run.findByIdAndUpdate.mockRejectedValue(
        new Error("mongo is unreachable"),
      );

      await expect(
        runIngestJob(makeJob({ payload: { rawFiles: [{ name: "done.fq" }] } })),
      ).rejects.toThrow("mongo is unreachable");

      expect(sendOverseerEmail).not.toHaveBeenCalled();
    });

    test("re-attempts raw files whose Read exists but whose bytes never moved", async () => {
      // The failure this whole module exists to prevent, relocated into the
      // database: processSingleReadFile saves the Read before it moves
      // anything, so an attempt where every move failed (ENOSPC, EROFS, or the
      // no-clobber EEXIST) leaves rows behind for files still in staging.
      // Reading those rows as "ingested" marks the job done with the reads
      // never delivered, and nothing ever tries again.
      existingReads([
        await unmovedDoc("stranded_R1.fq"),
        await unmovedDoc("stranded_R2.fq"),
      ]);
      const rawFiles = [{ name: "stranded_R1.fq" }, { name: "stranded_R2.fq" }];

      await runIngestJob(makeJob({ payload: { rawFiles } }));

      expect(sortReadFiles).toHaveBeenCalledWith(
        rawFiles,
        runId,
        expect.any(String),
        undefined,
        undefined,
      );
    });

    test("re-attempts a raw file whose destination has since disappeared", async () => {
      // The document names a path inside the datastore, but there is nothing
      // there. Only a stat can tell the difference.
      existingReads([
        {
          file: {
            originalName: "vanished.fq",
            path: _path.join(RUN_REL_PATH, "raw", "vanished.fq"),
          },
        },
      ]);
      const rawFiles = [{ name: "vanished.fq" }];

      await runIngestJob(makeJob({ payload: { rawFiles } }));

      expect(sortReadFiles).toHaveBeenCalledWith(
        rawFiles,
        runId,
        expect.any(String),
        undefined,
        undefined,
      );
    });

    test("retries only the file a previous attempt did not finish, not the paired one that already succeeded", async () => {
      // The bug this fix closes: handing sortReadFiles the whole set,
      // including paired_R1.fq, re-runs processSingleReadFile on a file that
      // is already at its destination and already claimed by a Read — its
      // move collides, moveIntoDatastore's adoptAlreadyMovedFile correctly
      // refuses to hand the collision to anyone, and the job fails again on
      // exactly the file that already succeeded, forever. Pairing across the
      // retry boundary (with only paired_R2.fq handed to a REAL
      // sortReadFiles) is proved by the "real move-and-pair pipeline" tests
      // below, which is the only way to catch that collision at all — this
      // test proves planRawFileStage's decision, at the mocked boundary this
      // whole describe block otherwise uses.
      existingReads([await movedDoc("paired_R1.fq", "raw")]);
      const rawFiles = [
        { name: "paired_R1.fq", sibling: "paired_R2.fq" },
        { name: "paired_R2.fq", sibling: "paired_R1.fq" },
      ];

      await runIngestJob(makeJob({ payload: { rawFiles } }));

      expect(sortReadFiles).toHaveBeenCalledWith(
        [rawFiles[1]],
        runId,
        expect.any(String),
        undefined,
        undefined,
      );

      // The job still reaches "complete" — the whole point of the fix is
      // that a retry does not get stuck once every file is delivered.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
        $set: { status: "complete" },
      });
    });

    test("skips additional files one by one, having no pairing to preserve", async () => {
      existingAdditionalFiles([await movedDoc("notes.txt", "additional")]);

      await runIngestJob(
        makeJob({
          payload: {
            additionalFiles: [{ name: "notes.txt" }, { name: "protocol.pdf" }],
          },
        }),
      );

      expect(sortAdditionalFiles).toHaveBeenCalledWith(
        [{ name: "protocol.pdf" }],
        "run",
        runId,
        expect.any(String),
        undefined,
      );
    });

    test("re-attempts an additional file whose bytes never moved", async () => {
      // AdditionalFile's post-save hook moves the file and swallows the error,
      // so the row outliving a failed move is the normal case here, not a rare
      // one.
      existingAdditionalFiles([await unmovedDoc("stranded.txt")]);

      await runIngestJob(
        makeJob({ payload: { additionalFiles: [{ name: "stranded.txt" }] } }),
      );

      expect(sortAdditionalFiles).toHaveBeenCalledWith(
        [{ name: "stranded.txt" }],
        "run",
        runId,
        expect.any(String),
        undefined,
      );
    });

    test("skips the additional-file stage entirely when it already finished", async () => {
      existingAdditionalFiles([await movedDoc("done.txt", "additional")]);

      await runIngestJob(
        makeJob({ payload: { additionalFiles: [{ name: "done.txt" }] } }),
      );

      expect(sortAdditionalFiles).not.toHaveBeenCalled();
    });
  });
});

describe("re-run after a partial failure: the real move-and-pair pipeline", () => {
  // Every "re-run after a partial failure" test above mocks
  // lib/sortAssociatedFiles wholesale, which proves planRawFileStage's
  // DECISION to skip an already-ingested file — but it cannot catch the
  // collision that decision exists to avoid, because the mock never runs the
  // real moveIntoDatastore or adoptAlreadyMovedFile. This describe block does
  // not mock that boundary: sortReadFiles here delegates to the real
  // lib/sortAssociatedFiles.js and lib/file-utils.js, with only the Mongoose
  // models faked (as every file-utils test in this repo already does) and the
  // filesystem real.
  //
  // The scenario reproduces the bug directly: a 2-file paired batch where
  // file 1 already succeeded on an earlier attempt (its bytes sit at their
  // destination, and a Read row already claims its File document — that
  // claim is exactly what stops adoptAlreadyMovedFile from reconciling a
  // collision) and file 2 was never attempted. Before the fix,
  // planRawFileStage handed BOTH files back to sortReadFiles; re-creating and
  // re-moving file 1 collided with its own already-delivered bytes, and
  // because its File document is claimed, adoptAlreadyMovedFile correctly
  // refused to reconcile it — so the whole batch rejected, forever, on the
  // file that had already succeeded.
  let hpcRoot;
  const ORIGINAL_HPC_TRANSFER_DIRECTORY = process.env.HPC_TRANSFER_DIRECTORY;

  beforeEach(async () => {
    // lib/ingest-queue.js's own `require("./sortAssociatedFiles")` resolved
    // to the automock at module-load time; delegating THIS mock's
    // implementation to the real module is what makes runIngestJob's call
    // reach the real processReadFiles / moveIntoDatastore /
    // adoptAlreadyMovedFile chain instead of the automock.
    const { sortReadFiles: realSortReadFiles } = jest.requireActual(
      "../../lib/sortAssociatedFiles",
    );
    sortReadFiles.mockImplementation(realSortReadFiles);

    hpcRoot = await fsp.mkdtemp(_path.join(os.tmpdir(), "ingest-queue-hpc-"));
    process.env.HPC_TRANSFER_DIRECTORY = hpcRoot;

    // runIngestJob re-fetches the Run itself (see processReadFiles step 2),
    // so the module-level makeRun() stand-in needs getRelativePath added.
    Run.findById = jest.fn().mockResolvedValue({
      ...makeRun(),
      getRelativePath: jest.fn().mockResolvedValue(RUN_REL_PATH),
    });

    // A File whose move is real fs work relative to the shared datastoreRoot,
    // not a call into models/File.js: this is the same "fake the model,
    // exercise the real orchestration" boundary __tests__/lib/file-utils.test.js
    // already uses, applied here so runIngestJob's own retry planning is what
    // gets proven, not a second copy of moveToFolderAndSave's own logic.
    File.mockImplementation((data) => ({
      save: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        originalName: data.originalName,
        path: data.path,
        moveToFolderAndSave: jest
          .fn()
          .mockImplementation(async function (relNewPath) {
            const destAbs = _path.join(datastoreRoot, relNewPath);
            const sourceAbs = this.path;

            const sourceStat = await fsp.stat(sourceAbs).catch(() => null);
            if (!sourceStat) {
              // What a re-attempted, already-delivered file actually hits:
              // its earlier move already unlinked the staging copy.
              throw new Error(
                `Cannot move ${sourceAbs} to ${destAbs}: no such source file`,
              );
            }

            const destExists = await fsp
              .stat(destAbs)
              .then(() => true)
              .catch(() => false);
            if (destExists) {
              throw new Error(
                `Cannot move ${sourceAbs} to ${destAbs}: destination already exists`,
              );
            }

            await fsp.mkdir(_path.dirname(destAbs), { recursive: true });
            await fsp.rename(sourceAbs, destAbs);
            this.path = relNewPath;
          }),
      }),
    }));
  });

  afterEach(async () => {
    if (ORIGINAL_HPC_TRANSFER_DIRECTORY === undefined) {
      delete process.env.HPC_TRANSFER_DIRECTORY;
    } else {
      process.env.HPC_TRANSFER_DIRECTORY = ORIGINAL_HPC_TRANSFER_DIRECTORY;
    }
    if (hpcRoot) {
      await fsp.rm(hpcRoot, { recursive: true, force: true });
    }
  });

  test("moves only the remaining file, links the pair, and completes the run", async () => {
    const r1 = await movedDoc("retry_R1.fq", "raw");
    existingReads([r1]);

    // adoptAlreadyMovedFile's collision recovery, wired for file 1's
    // destination only: an occupant File document that a Read already
    // claims, which is exactly the "correctly refuses" case this fix must
    // stop reaching for an already-delivered file — and exactly what the
    // pre-fix planRawFileStage (which handed the whole set back on every
    // retry) makes this test hit instead, if reverted.
    const file1DestRelPath = _path.join(RUN_REL_PATH, "raw", "retry_R1.fq");
    const file1OccupantId = new mongoose.Types.ObjectId();
    File.findOne = jest
      .fn()
      .mockImplementation((filter) =>
        Promise.resolve(
          filter && filter.path === file1DestRelPath
            ? { _id: file1OccupantId }
            : null,
        ),
      );
    File.deleteOne = jest.fn().mockResolvedValue({});
    Read.exists = jest
      .fn()
      .mockImplementation(({ file }) =>
        Promise.resolve(String(file) === String(file1OccupantId)),
      );
    AdditionalFile.exists = jest.fn().mockResolvedValue(false);

    // file 2's source is staged; file 1's is deliberately NOT — an
    // already-delivered file's earlier move already unlinked its staging
    // copy, and the fix must never look for it again.
    await fsp.mkdir(_path.join(hpcRoot, "batch"), { recursive: true });
    await fsp.writeFile(_path.join(hpcRoot, "batch", "retry_R2.fq"), "ACGT\n");

    let newReadId = null;
    Read.mockImplementation(() => ({
      save: jest.fn().mockImplementation(async () => {
        newReadId = new mongoose.Types.ObjectId();
        return { _id: newReadId };
      }),
    }));

    const rawFiles = [
      { name: "retry_R1.fq", sibling: "retry_R2.fq", relativePath: "batch" },
      { name: "retry_R2.fq", sibling: "retry_R1.fq", relativePath: "batch" },
    ];

    await runIngestJob(
      makeJob({
        payload: { rawFiles, rawFilesUploadInfo: { method: "hpc-mv" } },
      }),
    );

    // file 1 was never re-created or re-moved: exactly one File document
    // this attempt, and it is file 2's.
    expect(File).toHaveBeenCalledTimes(1);
    expect(File).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: "retry_R2.fq" }),
    );
    expect(sortReadFiles).toHaveBeenCalledWith(
      [rawFiles[1]],
      runId,
      expect.any(String),
      { method: "hpc-mv" },
      undefined,
    );

    // file 2's bytes really landed at their destination.
    const movedBytes = await fsp
      .readFile(
        _path.join(datastoreRoot, RUN_REL_PATH, "raw", "retry_R2.fq"),
        "utf8",
      )
      .catch(() => null);
    expect(movedBytes).toBe("ACGT\n");

    // Both reads end up linked as siblings — one already existing, one
    // freshly created — which is the union finaliseReadStage now builds.
    expect(newReadId).not.toBeNull();
    expect(Read.updateOne).toHaveBeenCalledWith(
      { _id: r1._id },
      { $set: { sibling: newReadId } },
    );
    expect(Read.updateOne).toHaveBeenCalledWith(
      { _id: newReadId },
      { $set: { sibling: r1._id } },
    );

    // And the run reaches "complete": the retry is not stuck forever on the
    // file that had already succeeded.
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(runId, {
      $set: { status: "complete" },
    });
  });
});

describe("startIngestWorker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Queues one claimable job in the fake store and returns it. */
  const queueOneJob = (overrides = {}) =>
    useAtomicStore([
      {
        _id: jobId,
        type: "run-ingest",
        runId,
        requestId: "req-1",
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        payload: { rawFiles: [{ name: "reads.fq" }] },
        createdAt: new Date(1),
        ...overrides,
      },
    ]);

  test("recovers orphaned jobs before it claims anything", async () => {
    queueOneJob();

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    expect(IngestJob.updateMany).toHaveBeenCalled();
    expect(IngestJob.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      IngestJob.findOneAndUpdate.mock.invocationCallOrder[0],
    );
  });

  test("claims, ingests and completes a queued job", async () => {
    queueOneJob();

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    expect(sortReadFiles).toHaveBeenCalled();
    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      // Fenced on the claim: a worker that lost its lease must not be able to
      // close a job another worker has taken over.
      { _id: jobId, workerId: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "done" }),
      }),
    );
  });

  test("hands a failed ingest to failJob rather than losing it", async () => {
    const jobs = queueOneJob();
    sortReadFiles.mockRejectedValue(new Error("no space left on device"));
    IngestJob.findById.mockImplementation(() => Promise.resolve(jobs[0]));

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId, workerId: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "pending",
          lastError: "no space left on device",
        }),
      }),
    );
  });

  test("gives up on a job that has already used every attempt", async () => {
    // Reachable only through lease expiry: a worker that is killed never gets
    // to record its own failure, so the attempt counter is the only limit.
    const jobs = queueOneJob({
      status: "pending",
      attempts: 3,
      maxAttempts: 3,
    });
    IngestJob.findById.mockImplementation(() => Promise.resolve(jobs[0]));

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    expect(sortReadFiles).not.toHaveBeenCalled();
    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId, workerId: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        $set: expect.objectContaining({ status: "error" }),
      }),
    );
  });

  test("stop() waits for the job in flight before returning", async () => {
    queueOneJob();
    let releaseTheMove;
    sortReadFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTheMove = resolve;
        }),
    );

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    expect(sortReadFiles).toHaveBeenCalled();

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await flush();

    // Returning here would abandon a job that holds a lease and is mid-move.
    expect(stopped).toBe(false);
    expect(IngestJob.updateOne).not.toHaveBeenCalled();

    releaseTheMove();
    await stopping;

    expect(stopped).toBe(true);
    expect(IngestJob.updateOne).toHaveBeenCalledWith(
      { _id: jobId, workerId: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "done" }),
      }),
    );
  });

  test("stop() ends the polling", async () => {
    useAtomicStore([]);

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    const claimsBefore = IngestJob.findOneAndUpdate.mock.calls.length;
    jest.advanceTimersByTime(100);
    await flush();

    expect(IngestJob.findOneAndUpdate.mock.calls.length).toBe(claimsBefore);
  });

  test("does not start a second job while one is still running", async () => {
    queueOneJob();
    sortReadFiles.mockImplementation(() => new Promise(() => {}));

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(50);
    await flush();

    expect(IngestJob.findOneAndUpdate).toHaveBeenCalledTimes(1);

    // Left mid-job on purpose; stop() would wait for a move that never ends.
    jest.clearAllTimers();
  });

  test("records each poll for the readiness probe", async () => {
    useAtomicStore([]);

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 1000 });
    jest.advanceTimersByTime(10);
    await flush();
    const firstTick = getLastTickAt();

    jest.advanceTimersByTime(10);
    await flush();
    await worker.stop();

    expect(firstTick).toBeInstanceOf(Date);
    expect(getLastTickAt().getTime()).toBeGreaterThanOrEqual(
      firstTick.getTime(),
    );
  });

  test("extends the lease while a job runs, and counts that as progress", async () => {
    // A long ingest must not be reported as a stall — but the evidence has to
    // be a write the worker actually completed, not the timer firing, and it
    // only counts while the job is inside its runtime bound. maxJobMs is
    // passed explicitly here so that bound is visible: "still renewing" is a
    // claim about a job that has not overrun, never about one that has.
    queueOneJob();
    sortReadFiles.mockImplementation(() => new Promise(() => {}));
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 1 });

    startIngestWorker({ intervalMs: 10, leaseMs: 60000, maxJobMs: 60000 });
    jest.advanceTimersByTime(10);
    await flush();
    const afterClaim = getLastTickAt();

    jest.advanceTimersByTime(10);
    await flush();

    const [filter, update] = IngestJob.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: jobId, workerId: expect.any(String) });
    expect(update.$set.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(getLastTickAt().getTime()).toBeGreaterThan(afterClaim.getTime());

    // Left mid-job on purpose; stop() would wait for a move that never ends.
    jest.clearAllTimers();
  });

  test("keeps renewing the lease but stops reporting fresh progress once a job overruns its bound", async () => {
    // The wedged worker, which a reviewer reproduced: the worker hung inside
    // one job, and /ready stayed green the whole time because the heartbeat
    // — fired by the same timer it replaced — refreshed the tick forever, so
    // the staleness check server.js documents could never fire.
    //
    // The old fix for that let the lease lapse too, past maxJobMs, "so
    // another worker can take it over" — but this deployment is pinned to a
    // single fork-mode process (see ecosystem.config.js): there is no second
    // worker for that to mean anything other than an unsafe takeover of a job
    // that is still genuinely running, mid-transfer, with none of its
    // filesystem or database writes protected by anything but the lease.
    // Nothing here can kill a hung worker, and letting the lease lapse cannot
    // either — it only invites a takeover that is never safe in this
    // deployment. What it can still do is stop vouching for the job on the
    // one signal that is safe to give up: the tick goes stale, which is what
    // turns /ready red, while the lease keeps renewing so the claim never
    // lapses.
    queueOneJob();
    sortReadFiles.mockImplementation(() => new Promise(() => {}));
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 1 });

    startIngestWorker({ intervalMs: 10, leaseMs: 60000, maxJobMs: 50 });
    jest.advanceTimersByTime(10);
    await flush();
    const afterClaim = getLastTickAt();

    // Inside the bound: a long job is not a stalled one.
    jest.advanceTimersByTime(30);
    await flush();
    expect(IngestJob.updateOne).toHaveBeenCalled();
    expect(getLastTickAt().getTime()).toBeGreaterThan(afterClaim.getTime());

    // Past it.
    jest.advanceTimersByTime(60);
    await flush();
    const renewals = IngestJob.updateOne.mock.calls.length;
    const frozenTick = getLastTickAt();

    jest.advanceTimersByTime(1000);
    await flush();

    // A hundred more ticks: the lease keeps renewing on every one of them —
    // the claim must never lapse — but not one of them counts as progress
    // any more, so the tick stays exactly where it froze.
    expect(IngestJob.updateOne.mock.calls.length).toBeGreaterThan(renewals);
    const [, lastUpdate] = IngestJob.updateOne.mock.calls.at(-1);
    expect(lastUpdate.$set.leaseExpiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(getLastTickAt().getTime()).toBe(frozenTick.getTime());
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`Job ${jobId} has held worker`),
    );
    // The wording a reviewer would have to trust is correct: no false claim
    // that the lease is lapsing or that another worker can take the job.
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/no longer renewing|another worker can take/),
    );

    jest.clearAllTimers();
  });

  test("keeps renewing the lease of the job it is draining on stop()", async () => {
    // The lease is minutes now, not an hour, so a drain that outlasts it would
    // invite a second worker onto the files this one is still moving. The
    // timer therefore outlives the decision to stop: it claims nothing more,
    // but it keeps renewing what it still holds.
    queueOneJob();
    let releaseTheMove;
    sortReadFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTheMove = resolve;
        }),
    );
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 1 });

    const worker = startIngestWorker({ intervalMs: 10, leaseMs: 60000 });
    jest.advanceTimersByTime(10);
    await flush();

    const stopping = worker.stop();
    await flush();

    const claimsAtStop = IngestJob.findOneAndUpdate.mock.calls.length;
    jest.advanceTimersByTime(30);
    await flush();

    const renewals = IngestJob.updateOne.mock.calls.filter(
      ([, update]) => update.$set && update.$set.leaseExpiresAt,
    );
    expect(renewals.length).toBeGreaterThan(0);
    // Draining, not working: nothing new is claimed on the way out.
    expect(IngestJob.findOneAndUpdate.mock.calls.length).toBe(claimsAtStop);

    releaseTheMove();
    await stopping;

    // And once the drain is done the timer really is gone.
    const renewalsAfterStop = IngestJob.updateOne.mock.calls.length;
    jest.advanceTimersByTime(100);
    await flush();
    expect(IngestJob.updateOne.mock.calls.length).toBe(renewalsAfterStop);
  });

  test("stops reporting fresh ticks when the queue is unreachable mid-job", async () => {
    // The condition server.js says /ready detects. Recording the tick before
    // the in-flight guard reports the timer, which fires whether or not the
    // worker is still doing anything — so a wedged worker looked healthy
    // forever and the staleness check could never fire.
    queueOneJob();
    sortReadFiles.mockImplementation(() => new Promise(() => {}));
    IngestJob.updateOne.mockRejectedValue(new Error("mongo is unreachable"));

    startIngestWorker({ intervalMs: 10, leaseMs: 60000 });
    jest.advanceTimersByTime(10);
    await flush();
    const afterClaim = getLastTickAt();

    jest.advanceTimersByTime(1000);
    await flush();

    expect(getLastTickAt().getTime()).toBe(afterClaim.getTime());

    jest.clearAllTimers();
  });

  test("does not extend a lease it has already lost", async () => {
    queueOneJob();
    sortReadFiles.mockImplementation(() => new Promise(() => {}));
    IngestJob.updateOne.mockResolvedValue({ matchedCount: 0 });

    startIngestWorker({ intervalMs: 10, leaseMs: 60000 });
    jest.advanceTimersByTime(10);
    await flush();
    const afterClaim = getLastTickAt();

    jest.advanceTimersByTime(10);
    await flush();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("no longer holds"),
    );
    expect(getLastTickAt().getTime()).toBe(afterClaim.getTime());

    jest.clearAllTimers();
  });
});
