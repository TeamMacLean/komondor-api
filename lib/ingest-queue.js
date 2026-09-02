/**
 * A durable queue for run ingest: moving uploaded files into the datastore,
 * notifying the overseer, and kicking off MD5 verification. Acceptance is a
 * database row first (enqueueRunIngest); a worker then claims the row under a
 * lease, so a killed worker's claim can be recovered on the next boot.
 *
 * Must not require routes/runs.js: the route depends on the queue, not vice
 * versa.
 */

const os = require("os");
const crypto = require("crypto");
const fs = require("fs").promises;

const IngestJob = require("../models/IngestJob");
const Run = require("../models/Run");
const Read = require("../models/Read");
const AdditionalFile = require("../models/AdditionalFile");
const { cleanDirectoryName, resolveWithinReal } = require("./utils/safePath");
const { sortReadFiles, sortAdditionalFiles } = require("./sortAssociatedFiles");
const { verifyRunMd5 } = require("./md5-verification");
const sendOverseerEmail = require("./utils/sendOverseerEmail");
const { sendMd5VerificationEmail } = require("./utils/sendEmail");

const RUN_INGEST_TYPE = "run-ingest";

const DEFAULT_MAX_ATTEMPTS = 3;

// How long a claim is held before another worker may take the job over. A
// heartbeat lease, not an estimate of the work: the worker renews it on poll.
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

// How long one job may hold the worker before it stops counting as progress
// for readiness. The lease keeps renewing regardless — see heartbeat() — this
// bound only controls when /ready stops treating the worker as draining the
// queue. Unbounded, /ready would stay green forever behind a wedged job.
const DEFAULT_MAX_JOB_MS = 6 * 60 * 60 * 1000;

// Nothing renews a lease but a poll, so a lease shorter than a few polls lapses
// under a healthy worker. Reachable by configuration, not only by mistake.
const MIN_LEASE_POLLS = 6;

// Polling interval. Ingest is not latency-sensitive: the client has its 201.
const DEFAULT_INTERVAL_MS = 5000;

// Retry backoff: 30s, then 60s, then 120s... capped. A failing ingest is
// usually a full disk or an unresponsive mount; hammering it makes it worse.
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

// Only ever set from a database round-trip that says the queue is still moving:
// a timer tick would report health while nothing drains.
let lastTickAt = null;

/** Records that the worker got an answer out of the queue. */
const recordProgress = () => {
  lastTickAt = new Date();
};

// Fresh per process start: host:pid cannot name one boot, because a restarted
// worker may be handed the dead one's pid.
const BOOT_ID = crypto.randomBytes(8).toString("hex");

// Diagnostic only — deliberately not part of any query (see recoverStaleJobs).
const WORKER_HOST = os.hostname();

// The workers started in this process. Proves a worker is alive, never that one
// is dead, so it only keeps our own claims out of the recovery sweep.
const liveWorkerIds = new Set();

/**
 * The idempotency key for a run's ingest job, derived from the run alone so a
 * repeated enqueue lands on the existing job rather than moving files twice.
 *
 * @param {mongoose.Types.ObjectId|string} runId - The run being ingested.
 * @returns {string} The key stored on IngestJob.idempotencyKey.
 */
const idempotencyKeyFor = (runId) => `${RUN_INGEST_TYPE}:${String(runId)}`;

/** A human-readable message for whatever was thrown. */
const describeError = (error) =>
  (error && error.message) || String(error || "unknown error");

/** How long to wait before the next attempt, given the attempts made so far. */
const backoffFor = (attempts) =>
  Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);

/** Identifies this process in claims, so a stuck job names something real. */
const defaultWorkerId = () => `${WORKER_HOST}:${process.pid}:${BOOT_ID}`;

/**
 * How many documents an update matched, or null when the shape is unrecognised.
 * Never 0 for unknown: mongoose 5 and the driver disagree on the field name,
 * and reading an unrecognised shape as 0 fails every fenced write.
 */
const matchedCount = (result) => {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (typeof result.matchedCount === "number") {
    return result.matchedCount;
  }
  if (typeof result.n === "number") {
    return result.n;
  }
  return null;
};

/**
 * The filter for a write against a claimed job, fenced on the claim itself.
 * Matching on _id alone lets a worker whose lease lapsed mid-move close a job
 * out from under the worker that has since taken it over.
 */
const claimFilter = (jobId, workerId) =>
  workerId ? { _id: jobId, workerId } : { _id: jobId };

/** Whether a fenced write landed; false only when the claim is provably gone. */
const fencedWriteLanded = (result, jobId, workerId, what) => {
  if (!workerId || matchedCount(result) !== 0) {
    return true;
  }

  console.error(
    `[Ingest Queue] Worker ${workerId} no longer holds job ${jobId} — its claim was taken over. Refusing to ${what}.`,
  );
  return false;
};

/**
 * Records that a run's files are owed, before any of them are touched.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.runId - The saved Run.
 * @param {string} [params.requestId] - The accepting request, for log correlation.
 * @param {object} [params.payload] - { rawFiles, additionalFiles, rawFilesUploadInfo }.
 * @returns {Promise<mongoose.Document>} The queued (or already queued) job.
 */
const enqueueRunIngest = async ({ runId, requestId, payload } = {}) => {
  if (!runId) {
    throw new Error("enqueueRunIngest requires a runId");
  }

  const idempotencyKey = idempotencyKeyFor(runId);

  try {
    // Upsert, not create-and-catch: a duplicate enqueue returns the existing
    // job instead of failing a request over work already recorded.
    return await IngestJob.findOneAndUpdate(
      { idempotencyKey },
      {
        $setOnInsert: {
          idempotencyKey,
          type: RUN_INGEST_TYPE,
          runId,
          requestId,
          payload: payload || {},
          status: "pending",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // Two upserts raced; the job exists either way.
    if (error && error.code === 11000) {
      return IngestJob.findOne({ idempotencyKey });
    }
    throw error;
  }
};

/**
 * Returns a permanently failed run-ingest job to the queue.
 *
 * `status: 'failed'` is matched inside the atomic update: a job claimed in the
 * meantime must not be dragged back to pending under its worker. `attempts`
 * resets to zero, or claimNextJob re-fails it without re-attempting.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.runId - The run to re-ingest.
 * @param {string} [params.requestId] - The asking request, for log correlation.
 * @returns {Promise<mongoose.Document|null>} The requeued job, or null.
 */
const requeueRunIngest = async ({ runId, requestId } = {}) => {
  if (!runId) {
    throw new Error("requeueRunIngest requires a runId");
  }

  return IngestJob.findOneAndUpdate(
    { idempotencyKey: idempotencyKeyFor(runId), status: "failed" },
    {
      $set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        workerId: null,
        leaseExpiresAt: null,
        requestId,
      },
    },
    { new: true },
  );
};

/**
 * Takes exclusive ownership of one job, or returns null if there is nothing to
 * do. MUST stay a single findOneAndUpdate: find-then-update leaves a gap in
 * which a second worker sees the same job, and both then run the same ingest.
 *
 * @param {object} params
 * @param {string} params.workerId - Identifies the claiming process.
 * @param {number} [params.leaseMs] - How long the claim is held.
 * @returns {Promise<mongoose.Document|null>} The claimed job, or null.
 */
const claimNextJob = async ({ workerId, leaseMs = DEFAULT_LEASE_MS } = {}) => {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  const job = await IngestJob.findOneAndUpdate(
    {
      $or: [
        {
          // Never claimed, or a retry past its backoff. A missing date matches
          // neither $lt nor $gt in MongoDB, so it has to be spelled out.
          status: "pending",
          $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: now } }],
        },
        {
          // Held by a worker that never came back. Nothing else releases this.
          status: "claimed",
          leaseExpiresAt: { $lt: now },
        },
      ],
    },
    {
      $set: {
        status: "claimed",
        workerId,
        workerHost: WORKER_HOST,
        leaseExpiresAt,
      },
      // Counted at claim time: a worker killed mid-job records nothing, and
      // that attempt must still count or the job retries forever.
      $inc: { attempts: 1 },
    },
    { new: true, sort: { createdAt: 1 } },
  );

  return job || null;
};

/**
 * Marks a job done and releases its lease.
 *
 * @param {mongoose.Types.ObjectId|string} jobId - The job to close.
 * @param {string} [workerId] - The worker closing it; the write is fenced on it.
 * @returns {Promise<boolean>} False when the claim had already moved on.
 */
const completeJob = async (jobId, workerId) => {
  const result = await IngestJob.updateOne(claimFilter(jobId, workerId), {
    $set: {
      status: "done",
      workerId: null,
      workerHost: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });

  return fencedWriteLanded(result, jobId, workerId, "mark it done");
};

/**
 * Records a failed attempt: back on the queue with a backoff if there are
 * attempts left, otherwise terminally failed.
 *
 * @param {mongoose.Types.ObjectId|string} jobId - The job that failed.
 * @param {Error|string} error - What went wrong.
 * @param {object} [options]
 * @param {boolean} [options.retry=true] - Whether another attempt is worth making.
 * @param {string} [options.workerId] - The reporting worker; fences the write.
 * @returns {Promise<void>}
 */
const failJob = async (jobId, error, options = {}) => {
  const { retry = true, workerId } = options;
  const message = describeError(error);

  const job = await IngestJob.findById(jobId);
  if (!job) {
    console.error(
      `[Ingest Queue] Cannot record a failure for job ${jobId}: no such job. The error was: ${message}`,
    );
    return;
  }

  if (retry && job.attempts < job.maxAttempts) {
    const backoffMs = backoffFor(job.attempts);

    const retryResult = await IngestJob.updateOne(
      claimFilter(jobId, workerId),
      {
        $set: {
          status: "pending",
          workerId: null,
          workerHost: null,
          lastError: message,
          // A backoff deadline the claim query honours: no hot retry loop.
          leaseExpiresAt: new Date(Date.now() + backoffMs),
        },
      },
    );

    if (!fencedWriteLanded(retryResult, jobId, workerId, "requeue it")) {
      return;
    }

    console.warn(
      `[Ingest Queue] Job ${jobId} for run ${job.runId} failed on attempt ${job.attempts}/${job.maxAttempts}, retrying in ${Math.round(
        backoffMs / 1000,
      )}s: ${message}`,
    );
    return;
  }

  const failedResult = await IngestJob.updateOne(claimFilter(jobId, workerId), {
    $set: {
      status: "failed",
      workerId: null,
      workerHost: null,
      leaseExpiresAt: null,
      lastError: message,
    },
  });

  // Nothing below may run for a claim that has moved on: the run is about to be
  // marked errored while another worker is still working the job.
  if (!fencedWriteLanded(failedResult, jobId, workerId, "fail it")) {
    return;
  }

  console.error(
    `[Ingest Queue] Job ${jobId} for run ${job.runId} failed permanently after ${job.attempts} attempt(s): ${message}`,
  );

  // Surfaced on the Run: "pending" reads as an ingest that is still coming.
  try {
    await Run.findByIdAndUpdate(job.runId, {
      $set: { status: "error", statusError: message },
    });
  } catch (updateError) {
    console.error(
      `[Ingest Queue] Failed to mark run ${job.runId} as errored after a permanent job failure:`,
      updateError,
    );
  }
};

/**
 * Returns jobs orphaned by a dead worker to the queue, at startup and before
 * the first claim: a worker killed mid-ingest leaves a claim nobody can release
 * from the inside.
 *
 * Staleness is judged by the lease, never by worker identity: liveWorkerIds
 * cannot see another process's workers, so judging by it yanks a live sibling's
 * claim mid-move.
 *
 * @param {object} [params]
 * @param {number} [params.leaseMs] - Fallback age for claims with no lease recorded.
 * @returns {Promise<number>} How many jobs were returned to pending.
 */
const recoverStaleJobs = async ({ leaseMs = DEFAULT_LEASE_MS } = {}) => {
  const now = new Date();

  const result = await IngestJob.updateMany(
    {
      status: "claimed",
      // Never this process's own workers. $nin matches a missing workerId too:
      // a worker that died between the two halves of its own stamp.
      workerId: { $nin: Array.from(liveWorkerIds) },
      $or: [
        { leaseExpiresAt: { $lt: now } },
        {
          // No lease to check (a crash between the two writes, or a document
          // predating leases): fall back to how long it has sat untouched.
          leaseExpiresAt: null,
          updatedAt: { $lt: new Date(now.getTime() - leaseMs) },
        },
      ],
    },
    {
      // Lease cleared: this work has already waited out a dead process.
      $set: {
        status: "pending",
        workerId: null,
        workerHost: null,
        leaseExpiresAt: null,
      },
    },
  );

  if (!result) {
    return 0;
  }

  // nModified is the mongoose 5 shape; modifiedCount is the driver's.
  return result.nModified || result.modifiedCount || 0;
};

/**
 * Whether a File document's bytes really are in the datastore. "A Read row
 * exists" is not the same question: the Read is saved before the move, so a
 * failed move leaves rows for files still in staging, and treating those as
 * ingested marks the job done with the files never delivered.
 */
const isAtDestination = async (file) => {
  if (!file || typeof file.path !== "string" || file.path.trim() === "") {
    return false;
  }

  const root = process.env.DATASTORE_ROOT;
  if (!root) {
    // Fail closed: claiming a file is in place is the answer that loses data.
    return false;
  }

  // Leading slashes stripped as models/File.js does: getRelativePath() returns
  // "/group/project/...", which path.join() quietly treats as relative.
  const destination = await resolveWithinReal(
    root,
    cleanDirectoryName(file.path),
  );
  if (!destination) {
    return false;
  }

  return fs
    .stat(destination)
    .then((stats) => stats.isFile())
    .catch(() => false);
};

/**
 * The documents whose files are already in the datastore, by original name. A
 * duplicated name resolves to the later document: a retry leaves the earlier
 * File/Read pair behind, and the newer pair is the one whose move wrote.
 *
 * @param {Array<object>} docs - Read or AdditionalFile documents, file populated.
 */
const ingestedByName = async (docs) => {
  const checked = await Promise.all(
    (docs || []).map(async (doc) => {
      const file = doc && doc.file;
      if (!file || !file.originalName) {
        return null;
      }
      return (await isAtDestination(file)) ? [file.originalName, doc] : null;
    }),
  );

  return new Map(checked.filter(Boolean));
};

/**
 * The original names of a run's files whose bytes are genuinely at their
 * datastore destination. Exposed so POST /runs/:id/reingest can refuse a
 * correction that would change an already-delivered file: the retry planner
 * matches delivered files by NAME, so a corrected upload id or checksum under
 * a name already delivered is silently skipped rather than applied.
 *
 * Split by list, not pooled. A raw read and an additional file are separate
 * rows with separate destinations and are planned separately, so they share
 * only a namespace, not an identity — a run may legitimately carry the same
 * name in both. Reproduced: with one flat set, a delivered raw "shared.fastq"
 * made an UNDELIVERED additional "shared.fastq" un-correctable, 409ing a
 * reingest that was never touching the delivered file at all.
 *
 * @param {mongoose.Types.ObjectId|string} runId - The run to inspect.
 * @returns {Promise<{raw: Set<string>, additional: Set<string>}>} Delivered
 *   original names, per list.
 */
const deliveredFileNames = async (runId) => {
  const [reads, additional] = await Promise.all([
    Read.find({ run: runId }).populate("file"),
    AdditionalFile.find({ run: runId }).populate("file"),
  ]);

  const [deliveredReads, deliveredAdditional] = await Promise.all([
    ingestedByName(reads),
    ingestedByName(additional),
  ]);

  return {
    raw: new Set(deliveredReads.keys()),
    additional: new Set(deliveredAdditional.keys()),
  };
};

/**
 * What is left of a run's raw-file stage: the files still to move, and the
 * Reads a previous attempt already delivered (by original file name).
 *
 * A retry moves only what is not already at its destination. Re-moving a file
 * that is already there is not merely wasted work: processSingleReadFile
 * would create a second File document for it, its move would collide with
 * the one already occupying that destination path, and moveIntoDatastore's
 * own collision recovery (adoptAlreadyMovedFile) correctly refuses to hand
 * that second document to anyone, because the first is already claimed by the
 * Read the earlier attempt saved — so re-attempting an already-delivered file
 * cannot ever succeed. Every file that has genuinely never been attempted
 * still moves together, exactly as before: ingestedReads is empty, so nothing
 * is filtered out.
 *
 * Pairing siblings and writing the run's "complete" status need every file,
 * not just the ones this attempt moves, so that step is never done here —
 * see finaliseReadStage, which the caller always runs from the union of
 * ingestedReads and whatever this attempt's own move goes on to create.
 *
 * @returns {Promise<{toMove: Array<object>, finalise: boolean,
 *   ingestedReads: Map<string, object>}>} Files still to move, whether a
 *   raw-file stage exists here to finalise at all, and the Reads already in
 *   place.
 */
const planRawFileStage = async (runId, rawFiles) => {
  if (!rawFiles || rawFiles.length === 0) {
    // No raw files were owed, so there is no stage and nothing to finalise.
    return { toMove: [], finalise: false, ingestedReads: new Map() };
  }

  const existingReads = await Read.find({ run: runId }).populate("file");
  const ingestedReads = await ingestedByName(existingReads);

  const toMove = rawFiles.filter((file) => !ingestedReads.has(file.name));

  if (toMove.length !== rawFiles.length) {
    const already = rawFiles.length - toMove.length;
    console.log(
      `[Ingest Queue] Run ${runId}: ${already} of ${rawFiles.length} raw file(s) already in the datastore; ${
        toMove.length > 0
          ? `moving the remaining ${toMove.length}`
          : "nothing left to move"
      }`,
    );
  }

  return { toMove, finalise: true, ingestedReads };
};

/**
 * The sibling links a raw-file payload describes, as pairs of original names.
 *
 * The only place this is decided, for every raw file whether freshly moved or
 * already ingested by an earlier attempt. finaliseReadStage is the only caller
 * and the only place a raw file gets paired — file-utils.js used to keep a
 * second copy of these rules for its own within-batch pairing, which is what
 * let a partial retry's pairing silently go wrong; that copy is gone.
 *
 * `sibling` is the contract for BOTH upload methods. It used to be read only
 * for hpc-mv, with local-filesystem pairing on `rowID` instead — and an audit
 * established that nothing has ever sent a rowID: komondor-web builds a
 * sibling map and emits `sibling` + `paired` for both sources
 * (components/uploads/FileProcessor.vue), komondor-power emits `sibling` from
 * read_siblingFullHpcPath, and the only rowID in either codebase is in
 * commented-out web code and in this API's own tests. So every paired
 * local-filesystem upload has been landing UNPAIRED, silently, for as long as
 * that split has existed — the invented contract was enforced against a
 * client that never spoke it.
 *
 * rowID is still honoured when present, for any caller that adopted it from
 * the API's documented shape, but it is a fallback rather than the rule.
 *
 * @returns {Array<Array<string>>} [readName, siblingName] pairs.
 */
const siblingLinks = (rawFiles, uploadMethod) => {
  const files = (rawFiles || []).filter((file) => file && file.name);

  // Declared siblings first, for either method. Only mutual declarations are
  // linked: routes/runs.js refuses anything else at the door, and a
  // half-declared pair reaching here from a payload stored before that rule
  // must not be guessed at.
  const byName = new Map(files.map((file) => [file.name, file]));
  const declared = files.filter(
    (file) =>
      typeof file.sibling === "string" &&
      byName.get(file.sibling) &&
      byName.get(file.sibling).sibling === file.name,
  );

  if (declared.length > 0 || uploadMethod === "hpc-mv") {
    return declared.map((file) => [file.name, file.sibling]);
  }

  const byRow = new Map();
  files.forEach((file) => {
    if (!file.paired || file.rowID === undefined || file.rowID === null) {
      return;
    }
    const row = String(file.rowID);
    byRow.set(row, (byRow.get(row) || []).concat(file));
  });

  const links = [];
  byRow.forEach((group, row) => {
    if (group.length !== 2) {
      // Guessing at a row that is not a pair links the wrong two reads.
      console.error(
        `[Ingest Queue] Expected 2 paired reads for rowID ${row}, found ${group.length}; leaving them unpaired.`,
      );
      return;
    }
    links.push([group[0].name, group[1].name], [group[1].name, group[0].name]);
  });

  return links;
};

/**
 * Pairs siblings and marks the run "complete" — the steps a raw-file stage
 * owes once every one of its files is accounted for, whether that is because
 * this attempt just moved it or an earlier attempt already delivered it. The
 * only place either step happens: processReadFiles moves files but does not
 * pair or finalise them itself, because it only ever sees the files it was
 * handed, and a retry may be handed just the ones still missing (see
 * planRawFileStage) — so it cannot know a sibling that landed on an earlier
 * attempt, or on this one, is not part of its own argument list. Always run
 * once the move (if any) has completed, for a fresh run exactly as much as a
 * retry: the two are the same case here, not two.
 *
 * @param {mongoose.Types.ObjectId} runId
 * @param {Array<object>} rawFiles - The job's full raw-file payload. Pairing
 *   is decided from the request (see siblingLinks), not from which Read rows
 *   happen to exist yet.
 * @param {object} uploadInfo - { method }.
 * @param {Map<string, object>} ingestedReads - Reads a previous attempt
 *   already delivered, by original file name (from planRawFileStage).
 * @param {Array<object>} newlyCreated - pairingInfo records for whatever this
 *   attempt's own move just created (processReadFiles's return value), or []
 *   when nothing needed to move.
 */
const finaliseReadStage = async (
  runId,
  rawFiles,
  uploadInfo,
  ingestedReads,
  newlyCreated,
) => {
  const method = (uploadInfo && uploadInfo.method) || "local-filesystem";

  // One name -> Read lookup spanning both sources: a pair can now have one
  // sibling already in the database and the other just moved.
  const readsByName = new Map(ingestedReads);
  (newlyCreated || []).forEach((info) => {
    if (info && info.fileName) {
      readsByName.set(info.fileName, {
        _id: info.readId,
        // A freshly created Read never had a sibling set at creation time.
        sibling: undefined,
      });
    }
  });

  const updates = [];
  siblingLinks(rawFiles, method).forEach(([name, siblingName]) => {
    const read = readsByName.get(name);
    const sibling = readsByName.get(siblingName);

    if (!read || !sibling) {
      // Loud but not fatal: the bytes are all delivered, so a broken
      // cross-reference must not strand the run at "pending".
      console.error(
        `[Ingest Queue] Run ${runId}: cannot link ${name} to sibling ${siblingName} — no ingested read for ${read ? siblingName : name}. Leaving it unpaired.`,
      );
      return;
    }

    if (String(read.sibling || "") !== String(sibling._id)) {
      updates.push(
        Read.updateOne({ _id: read._id }, { $set: { sibling: sibling._id } }),
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    console.log(
      `[Ingest Queue] Run ${runId}: linked ${updates.length} paired read(s)`,
    );
  }

  // Without this the run sits at "pending" for good once moving is done.
  await Run.findByIdAndUpdate(runId, { $set: { status: "complete" } });
};

/**
 * The additional files this run has not already ingested. Filtered per file,
 * unlike the raw files above: they have no sibling linking, so skipping one
 * cannot affect another. Skipping goes on the bytes, not the row —
 * AdditionalFile's post-save hook swallows whatever the move threw.
 */
const pendingAdditionalFiles = async (runId, additionalFiles) => {
  if (!additionalFiles || additionalFiles.length === 0) {
    return [];
  }

  const existing = await AdditionalFile.find({ run: runId }).populate("file");
  const ingested = await ingestedByName(existing);

  if (ingested.size === 0) {
    return additionalFiles;
  }

  const remaining = additionalFiles.filter((file) => !ingested.has(file.name));

  if (remaining.length !== additionalFiles.length) {
    console.log(
      `[Ingest Queue] Run ${runId}: skipping ${additionalFiles.length - remaining.length} already-ingested additional file(s)`,
    );
  }

  return remaining;
};

/**
 * Does the actual ingest for one claimed job: files first, then the overseer
 * email, then MD5 verification, with a failure in either of the last two logged
 * and swallowed. The outer catch re-throws so the worker can retry or fail it.
 *
 * @param {mongoose.Document} job - The claimed IngestJob.
 */
const runIngestJob = async (job) => {
  const requestId = job.requestId || `job:${job._id}`;

  const run = await Run.findById(job.runId);
  if (!run) {
    throw new Error(
      `Cannot ingest job ${job._id}: run ${job.runId} no longer exists`,
    );
  }

  const payload = job.payload || {};
  const { rawFiles, additionalFiles, rawFilesUploadInfo } = payload;

  try {
    const fileProcessingPromises = [];

    const rawStage = await planRawFileStage(run._id, rawFiles);
    // Captured separately from fileProcessingPromises so its resolved value
    // — what this attempt just created — reaches finaliseReadStage below.
    const rawFilesPromise =
      rawStage.toMove.length > 0
        ? sortReadFiles(
            rawStage.toMove,
            run._id,
            run.path,
            rawFilesUploadInfo,
            payload.username,
          )
        : null;
    if (rawFilesPromise) {
      fileProcessingPromises.push(rawFilesPromise);
    }

    const additionalFilesToSort = await pendingAdditionalFiles(
      run._id,
      additionalFiles,
    );
    if (additionalFilesToSort.length > 0) {
      fileProcessingPromises.push(
        sortAdditionalFiles(
          additionalFilesToSort,
          "run",
          run._id,
          run.path,
          payload.username,
        ),
      );
    }

    if (fileProcessingPromises.length > 0) {
      await Promise.all(fileProcessingPromises);
    }

    // Pairing and "complete" are owed whenever a raw-file stage exists at
    // all — moves or not — from the union of what this attempt just moved
    // and what an earlier attempt already delivered.
    if (rawStage.finalise) {
      await finaliseReadStage(
        run._id,
        rawFiles,
        rawFilesUploadInfo,
        rawStage.ingestedReads,
        // Already settled by the Promise.all above; awaiting again just
        // reads its value.
        rawFilesPromise ? await rawFilesPromise : [],
      );
    }

    // Awaited so the job is not marked done with a notification in flight.
    await sendOverseerEmail({ type: "Run", data: run }).catch((err) => {
      console.error(
        `[${requestId}] Failed to send overseer email for run ${run._id}:`,
        err,
      );
    });

    await verifyRunMd5(run._id)
      .then(async (result) => {
        if (result.mismatches > 0 || (result.errors && result.errors > 0)) {
          try {
            await sendMd5VerificationEmail({
              runId: run._id,
              runName: run.name,
              filesVerified: result.filesVerified,
              mismatches: result.mismatches,
              errors: result.errors || 0,
              duration: result.duration,
            });
          } catch (emailError) {
            console.error(
              `[${requestId}] Failed to send MD5 verification failure email for run ${run._id}:`,
              emailError,
            );
          }
        }
      })
      .catch((error) => {
        // Not fatal: the background job re-verifies anything left pending.
        console.error(
          `[${requestId}] Failed to verify MD5 for run ${run._id}:`,
          error,
        );
      });
  } catch (bgError) {
    console.error(
      `[${requestId}] Background processing failed for run ${run._id}:`,
      bgError,
    );
    throw bgError;
  }
};

/**
 * When the worker last got an answer out of the queue. Null before the first.
 * Progress, not attendance: a timer tick, or a lease renewal on a job past
 * MAX_JOB_MS, would keep /ready green around a wedged worker (see server.js).
 *
 * @returns {?Date} The time of the last completed round-trip.
 */
const getLastTickAt = () => lastTickAt;

/**
 * Starts polling for ingest jobs, after returning any orphaned work to the
 * queue. One job at a time: an ingest is IO-bound on the datastore mount, so
 * overlapping jobs compete for the same disk rather than finish sooner.
 *
 * @param {object} [options]
 * @param {number} [options.intervalMs] - How often to poll.
 * @param {number} [options.leaseMs] - Lease length; raised to MIN_LEASE_POLLS polls.
 * @param {number} [options.maxJobMs] - How long one job may run before the
 *   worker stops counting it as progress for readiness. Never stops renewing
 *   its lease — see heartbeat().
 * @param {string} [options.workerId] - Overrides the host:pid:boot identity.
 * @returns {{stop: function(): Promise<void>}} A handle that drains on stop.
 */
const startIngestWorker = (options = {}) => {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    maxJobMs = DEFAULT_MAX_JOB_MS,
    workerId = defaultWorkerId(),
  } = options;

  // See MIN_LEASE_POLLS: only a poll renews the lease.
  const leaseMs = Math.max(
    options.leaseMs || DEFAULT_LEASE_MS,
    MIN_LEASE_POLLS * intervalMs,
  );

  let inFlight = null;
  let stopped = false;
  let currentJobId = null;
  let currentJobStartedAt = null;
  let overrunReported = false;
  let heartbeatInFlight = false;

  // Registered before the recovery below, so our own claims read as live.
  liveWorkerIds.add(workerId);

  // Before the first claim: every tick waits on this recovery.
  const recovered = recoverStaleJobs({ leaseMs })
    .then((count) => {
      if (count > 0) {
        console.log(
          `[Ingest Queue] Returned ${count} ingest job(s) orphaned by a previous shutdown to the queue`,
        );
      }
      return count;
    })
    .catch((error) => {
      console.error("[Ingest Queue] Startup recovery failed:", error);
      return 0;
    });

  /**
   * Pushes the lease on the job in flight out, unconditionally, for as long as
   * a job is claimed — including past maxJobMs. This is a single fork-mode
   * process (see ecosystem.config.js): nothing here can ever legitimately need
   * a second worker to take over a job the first has not actually died on, so
   * letting the lease lapse could only invite an unsafe takeover, never a
   * useful one. What maxJobMs still controls is whether renewing counts as
   * progress: past it, recordProgress() is skipped, so getLastTickAt() goes
   * stale and /ready reports this worker as not draining the queue, even
   * though its claim on the job never lapses.
   */
  const heartbeat = async () => {
    const jobId = currentJobId;
    if (!jobId || heartbeatInFlight) {
      return;
    }

    const runningForMs = Date.now() - currentJobStartedAt;
    const overrun = runningForMs > maxJobMs;

    if (overrun && !overrunReported) {
      overrunReported = true;
      console.error(
        `[Ingest Queue] Job ${jobId} has held worker ${workerId} for ${Math.round(
          runningForMs / 60000,
        )} min, past the ${Math.round(
          maxJobMs / 60000,
        )} min bound. Still renewing its lease, so no other worker can take it over; no longer counted as progress, so readiness will report this worker as not draining the queue until the job finishes.`,
      );
    }

    heartbeatInFlight = true;
    try {
      const result = await IngestJob.updateOne(claimFilter(jobId, workerId), {
        $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
      });

      // Past the bound, the write still happens (see above) — only whether it
      // counts as progress changes.
      if (
        fencedWriteLanded(result, jobId, workerId, "extend its lease") &&
        !overrun
      ) {
        recordProgress();
      }
    } catch (error) {
      // No recordProgress(): an unreachable queue is what staleness surfaces.
      console.error(
        `[Ingest Queue] Failed to extend the lease on job ${jobId}:`,
        error,
      );
    } finally {
      heartbeatInFlight = false;
    }
  };

  const processOne = async () => {
    await recovered;

    const job = await claimNextJob({ workerId, leaseMs });
    // The claim query came back, which is all an idle worker can prove.
    recordProgress();

    if (!job) {
      return;
    }

    if (job.attempts > job.maxAttempts) {
      // Past the limit, reachable only via lease expiry: a killed worker never
      // gets to call failJob.
      await failJob(
        job._id,
        new Error(
          `Ingest gave up after ${job.attempts - 1} attempt(s); the last one did not report back`,
        ),
        { retry: false, workerId },
      );
      return;
    }

    console.log(
      `[Ingest Queue] Worker ${workerId} claimed job ${job._id} for run ${job.runId} (attempt ${job.attempts}/${job.maxAttempts})`,
    );

    currentJobId = job._id;
    // From the claim, not the first heartbeat, so a job that hangs early is
    // still bounded.
    currentJobStartedAt = Date.now();
    overrunReported = false;

    try {
      await runIngestJob(job);
      if (await completeJob(job._id, workerId)) {
        console.log(
          `[Ingest Queue] Job ${job._id} for run ${job.runId} completed`,
        );
      }
    } catch (error) {
      await failJob(job._id, error, { retry: true, workerId });
    } finally {
      currentJobId = null;
      currentJobStartedAt = null;
    }
  };

  const tick = () => {
    if (inFlight) {
      // Checked before `stopped`: a draining worker still holds a live claim,
      // and a lease lapsing mid-drain invites a second worker onto its files.
      heartbeat();
      return;
    }

    if (stopped) {
      return;
    }

    inFlight = processOne()
      .catch((error) => {
        // Only reachable if the queue itself is unusable; the next tick retries.
        console.error("[Ingest Queue] Worker poll failed:", error);
      })
      .then(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(tick, intervalMs);
  // A pending poll must never be the reason the process stays alive.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  console.log(
    `[Ingest Queue] Worker ${workerId} started (poll every ${intervalMs}ms, lease ${Math.round(
      leaseMs / 1000,
    )}s)`,
  );

  return {
    /**
     * Stops polling and waits for the job in progress.
     * @returns {Promise<void>}
     */
    async stop() {
      stopped = true;

      // Deregistered before the drain: what it still holds is the next boot's
      // recovery.
      liveWorkerIds.delete(workerId);

      try {
        // Waited on: returning early leaves a live claim behind for no reason.
        const pending = inFlight;
        if (pending) {
          await pending;
        }
      } finally {
        // Cleared last: the timer renews the lease on the job being drained.
        clearInterval(timer);
      }
    },
  };
};

module.exports = {
  IngestJob,
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
  deliveredFileNames,
  // Exported for the cross-repo contract test: this is the pairing rule, and
  // it silently disagreed with what every client actually sends.
  siblingLinks,
  RUN_INGEST_TYPE,
  DEFAULT_LEASE_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_JOB_MS,
};
