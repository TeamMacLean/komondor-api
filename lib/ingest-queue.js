/**
 * A durable queue for run ingest: moving uploaded files into the datastore,
 * notifying the overseer, and kicking off MD5 verification.
 *
 * The route used to do all of that inside a setImmediate() closure fired after
 * res.status(201). That closure lived only in this process's memory, so the
 * window between "the client was told yes" and "the files are in place" was
 * unrecoverable: PM2 sends SIGINT and SIGKILLs 30s later (ecosystem.config.js),
 * and a deploy or crash in that window stranded the work with nothing left
 * anywhere to say it had ever been accepted.
 *
 * Here the acceptance is a row in the database first (enqueueRunIngest), and
 * the work is done by a worker that claims it under a lease. A killed worker
 * leaves its claim behind; recoverStaleJobs picks it up on the next boot. That
 * recovery is the reason this file exists — everything else is plumbing around
 * it.
 *
 * This module must not require routes/runs.js: the queue is what the route
 * depends on, never the other way round.
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

// How long a claim is held before another worker may take the job over.
//
// This is a heartbeat lease, not an estimate of how long the work takes. The
// worker renews it on every poll for as long as it is running the job (see
// heartbeat in startIngestWorker), so the only things that let it lapse are
// the worker dying, the worker overrunning MAX_JOB_MS, and the database being
// unreachable — all three of which are exactly when the job should move on.
//
// It used to be an hour, sized against a multi-terabyte move so that a live
// worker could not lose its claim mid-copy. Renewal makes that sizing
// unnecessary, and the hour was doing real harm: it was also the deadline a
// SIGKILLed worker's job had to wait out, and the attempt to short-circuit
// that wait by guessing at worker identity is what let one process yank a
// live sibling's claim (see recoverStaleJobs). Five minutes of missed
// renewals — sixty consecutive polls at the default interval — is a worker
// that has stopped, on any host, with nothing left to infer.
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

// How long one job may hold the worker before the worker stops vouching for it.
//
// A worker wedged inside a single job is the one failure a poll timer cannot
// show: the timer keeps firing, so everything driven by the timer keeps
// reporting health — which is precisely how the heartbeat, added to make
// /ready truthful, ended up renewing a stuck job's lease forever and
// reporting a fresh tick every five seconds while nothing drained. Past this
// bound the worker stops renewing the lease and stops recording progress, so
// the stall shows up in all three places that can act on it: /ready goes red
// (server.js), the claim lapses so another worker may take the job over, and
// the log names the job.
//
// Six hours matches server.js's STALLED_TRANSFER_MINUTES default — the same
// judgement about when work on this datastore has stopped being slow and
// started being stuck.
const DEFAULT_MAX_JOB_MS = 6 * 60 * 60 * 1000;

// A lease has to outlive several polls. Nothing renews it but the heartbeat on
// a tick, so a lease shorter than the poll interval lapses under a perfectly
// healthy worker. That pairing is reachable by configuration and not only by
// mistake: validateEnv accepts INGEST_POLL_MS up to five minutes and
// INGEST_LEASE_MINUTES down to one.
const MIN_LEASE_POLLS = 6;

// Polling interval. Ingest is not latency-sensitive — the client has already
// had its 201 — so this is set for a quiet log rather than a quick start.
const DEFAULT_INTERVAL_MS = 5000;

// Retry backoff: 30s, then 60s, then 120s... capped. A failing ingest is
// usually a full disk or an unresponsive mount, and hammering either makes it
// worse.
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

// Exposed via getLastTickAt() so a readiness probe can tell "idle" from
// "no longer draining the queue" without reading logs.
//
// Only ever set from a database round-trip that came back AND that says the
// queue is still moving: a claim query, or a lease renewal for a job that is
// still inside MAX_JOB_MS. Neither weaker rule works. Setting it from the
// interval callback reported health from a timer that fires whether or not
// the worker is doing anything; setting it from every lease renewal reported
// health from a job that had been wedged for days, which is the same lie one
// layer down.
let lastTickAt = null;

/** Records that the worker got an answer out of the queue. */
const recordProgress = () => {
  lastTickAt = new Date();
};

// A fresh identity per process start, mixed into every claim.
//
// A claim must name one specific run of one specific process, because that is
// what the fence on every subsequent write compares against (see claimFilter).
// Neither half of host:pid can carry that on its own: a supervisor restarting
// a worker may hand the new process the pid the dead one had, and a container
// or pod comes back under a different hostname every deploy. The random boot
// id is the part that means something, and it means it without reference to
// the host — which is what lets a pod that returns under a new name still tell
// its own claims from a stranger's.
const BOOT_ID = crypto.randomBytes(8).toString("hex");

// Stamped onto claims so whoever reads this collection at 3am knows which
// machine to log into. Deliberately not part of any query: see recoverStaleJobs.
const WORKER_HOST = os.hostname();

// The workers started in this process and not yet stopped.
//
// This set can prove a worker is alive. It cannot prove one is dead — it knows
// nothing about any other process, on this host or any other. recoverStaleJobs
// used it in that second direction and reclaimed a live sibling process's job;
// it is now used only to keep this process's own claims out of the recovery
// sweep. Added to before the worker's first claim, removed when it stops.
const liveWorkerIds = new Set();

/**
 * The idempotency key for a run's ingest job.
 *
 * Derived from the run alone, so a second enqueue for the same run — a client
 * retry, or the route re-entered after a dropped connection — lands on the
 * existing job instead of queueing the same file moves twice.
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
 * How many documents an update matched, when the driver says.
 *
 * The two mongoose 5 shapes disagree (`n` from the legacy write result,
 * `matchedCount` from the driver's), and a caller that guessed wrong would
 * read every successful fenced write as a lost claim. Unknown is reported as
 * null rather than 0, so an unrecognised shape is never mistaken for a miss.
 *
 * @param {object} result - Whatever updateOne resolved with.
 * @returns {?number} The matched count, or null if it cannot be read.
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
 *
 * A worker whose lease lapsed mid-move is still running, and its job may have
 * been taken over. Matching on _id alone lets it mark that job done or failed
 * out from under the worker now doing it.
 *
 * @param {mongoose.Types.ObjectId|string} jobId - The job being written.
 * @param {string} [workerId] - The worker that believes it holds the claim.
 * @returns {object} A mongo filter.
 */
const claimFilter = (jobId, workerId) =>
  workerId ? { _id: jobId, workerId } : { _id: jobId };

/**
 * Whether a fenced write actually landed, complaining loudly when it did not.
 *
 * @param {object} result - Whatever updateOne resolved with.
 * @param {mongoose.Types.ObjectId|string} jobId - The job written to.
 * @param {string} [workerId] - The worker that attempted the write.
 * @param {string} what - What the write was trying to do, for the log.
 * @returns {boolean} False only when the claim is provably gone.
 */
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
    // Upsert rather than create-and-catch: this is the write that has to
    // happen before the route replies, and $setOnInsert means a duplicate
    // enqueue returns the existing job rather than failing the request over
    // work that is already safely recorded.
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
    // Two upserts racing on the same key: one inserts, the other is rejected
    // by the unique index. The job exists either way, which is all the caller
    // needs to know.
    if (error && error.code === 11000) {
      return IngestJob.findOne({ idempotencyKey });
    }
    throw error;
  }
};

/**
 * Returns a permanently failed run-ingest job to the queue.
 *
 * The queue owns what "queued again" means, so the reset lives here rather
 * than in the route that asks for it; routes/runs.js prefers this export and
 * falls back to performing the same write itself only if it is absent.
 *
 * One atomic findOneAndUpdate, with `status: 'failed'` matched inside the
 * update rather than checked beforehand: a job a worker has claimed in the
 * meantime must not be dragged back to pending underneath it, and only an
 * atomic match can promise that.
 *
 * `attempts` goes back to zero deliberately. claimNextJob increments attempts
 * as it claims and fails outright anything already past maxAttempts, so a job
 * left at its exhausted count would simply be re-failed on the next poll with
 * the ingest never re-attempted.
 *
 * `leaseExpiresAt` is cleared so the job is claimable immediately. Backoff
 * exists to keep a worker off a full disk; an operator asking for this retry
 * has already been the wait.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.runId - The run to re-ingest.
 * @param {string} [params.requestId] - The asking request, for log correlation.
 * @returns {Promise<mongoose.Document|null>} The requeued job, or null when no
 *   failed job matched.
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
 * Takes exclusive ownership of one job, or returns null if there is nothing
 * to do.
 *
 * This MUST stay a single findOneAndUpdate. A find() followed by an update()
 * leaves a gap in which a second worker runs the same find and sees the same
 * pending job, because nothing has been written yet — both then "claim" it and
 * both run the ingest, moving the same files twice and racing on the Run's
 * status. The whole point of a queue is that the claim and the read are one
 * indivisible operation, which only the atomic findOneAndUpdate gives.
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
          // Never claimed, or a retry whose backoff deadline has passed. An
          // unset leaseExpiresAt is claimable now; the comparison operators
          // are type-bracketed in MongoDB, so a missing date matches neither
          // $lt nor $gt and has to be spelled out.
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
      // The host is stamped alongside the worker for the operator reading a
      // stuck job, not for recovery: "which machine claimed this" turned out
      // to be a question no other process can act on (see recoverStaleJobs).
      $set: {
        status: "claimed",
        workerId,
        workerHost: WORKER_HOST,
        leaseExpiresAt,
      },
      // Counted at claim time, not at failure time: a worker that is killed
      // mid-job never records anything, and an attempt that costs a SIGKILL
      // still has to count towards the limit or the job retries forever.
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
 * @param {string} [workerId] - The worker closing it, which the write is
 *   fenced on: a claim that has since been taken over cannot be closed here.
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
 * @param {string} [options.workerId] - The worker reporting the failure, which
 *   the write is fenced on.
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
          // Pending, but not before this: see the field's comment on
          // IngestJob. The claim query honours it, so a hot retry loop against
          // a full disk is not possible.
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

  // Nothing below this point may run for a claim that has moved on: the run is
  // about to be marked errored, and the worker that took the job over is still
  // working on it.
  if (!fencedWriteLanded(failedResult, jobId, workerId, "fail it")) {
    return;
  }

  console.error(
    `[Ingest Queue] Job ${jobId} for run ${job.runId} failed permanently after ${job.attempts} attempt(s): ${message}`,
  );

  // A permanently failed job is work the API told a client it had accepted and
  // will now never do. Push that onto the Run so it surfaces where every other
  // broken ingest does — status "error" with a message the frontend already
  // shows — rather than leaving it at "pending", which is indistinguishable
  // from an ingest that is still coming.
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
 * Returns jobs orphaned by a dead worker to the queue.
 *
 * THIS IS THE POINT OF THE WHOLE MODULE. A worker that is SIGKILLed mid-ingest
 * leaves its job sitting in "claimed" with a lease nobody will ever release
 * from the inside. Called at startup (startIngestWorker does it before its
 * first claim), this hands that work back to the queue, so a deploy landing
 * mid-ingest costs a retry instead of losing the files. It is a sweep, not the
 * only path: claimNextJob's own expiry branch takes over a lease that lapses
 * while this process is already running. The sweep exists so the backlog left
 * by the previous process is dealt with in one write, before the first poll.
 *
 * The evidence is the lease, and nothing but the lease. A claimed job's lease
 * is renewed by whoever holds it on every poll (see heartbeat in
 * startIngestWorker), so a lapsed lease means the holder stopped renewing it.
 * That is a liveness record written by the process being asked about, which is
 * the only kind of answer scoped the same way the question is: it works across
 * processes, across hosts, and across a hostname that changed while the job
 * sat there. DEFAULT_LEASE_MS is short for this reason — the wait is now
 * minutes, not the hour that made a recovery pass feel necessary in the first
 * place.
 *
 * This used to ask something else entirely: "was this claimed by a process on
 * MY host that is not in MY in-memory set of live workers?" Both halves were
 * wrong. The set is process-scoped, so a second process on the same host was
 * declared dead and its in-flight claim yanked out from under it — two workers
 * on one set of multi-GB reads, which the claim fence does not prevent because
 * the fence protects the job row, not the filesystem. And the host half meant
 * that a deployment whose hostname changes across a restart, which is every
 * container, matched nothing at all: there the original bug was fully intact.
 *
 * liveWorkerIds survives here only as a guard over this process's own claims —
 * the one thing an in-memory set can honestly answer. A job our own worker is
 * overrunning is left alone for another process to take over, because we are
 * still inside it.
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
      // Never a claim held by a worker running in this process. $nin matches a
      // missing workerId too, which is a claim whose worker died between the
      // two halves of its own stamp.
      workerId: { $nin: Array.from(liveWorkerIds) },
      $or: [
        { leaseExpiresAt: { $lt: now } },
        {
          // A claim with no lease at all — a crash between the two writes, or
          // a document from before leases existed. There is no deadline to
          // check, so fall back to how long it has sat untouched.
          leaseExpiresAt: null,
          updatedAt: { $lt: new Date(now.getTime() - leaseMs) },
        },
      ],
    },
    {
      // Cleared, not preserved: this work has already waited for a process
      // that is gone, so it should be claimable immediately rather than
      // serving out a backoff nobody is waiting on.
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
 * Whether a File document's bytes really are in the datastore.
 *
 * "A Read row exists" is emphatically not the same question.
 * processSingleReadFile (lib/file-utils.js) saves the Read *before* it calls
 * moveToFolderAndSave, so an attempt where every move failed — a full disk, a
 * read-only mount, or the EEXIST that the no-clobber promotion raises — leaves
 * a full set of Read documents behind for files still sitting in staging.
 * Reading those as "ingested" made a retry sort nothing, email the overseer and
 * mark the job done, with multi-GB reads never delivered and no further attempt
 * possible. That is precisely the failure this queue was built to remove — the
 * API saying yes for work that never happened — moved out of process memory and
 * into the database.
 *
 * So the evidence is the file itself. `path` holds the staging location until
 * moveToFolderAndSave rewrites it to the datastore-relative destination, and a
 * staging path re-rooted at the datastore points at somewhere the file is not,
 * so an unmoved file fails the stat. A file that *is* found is whole: both move
 * paths reach the final name through link(), the cross-device one only after
 * comparing the copy's byte count with the source's, so a truncated read never
 * appears under the real name.
 *
 * @param {object} file - A populated File document.
 * @returns {Promise<boolean>} True only if something is at the destination.
 */
const isAtDestination = async (file) => {
  if (!file || typeof file.path !== "string" || file.path.trim() === "") {
    return false;
  }

  const root = process.env.DATASTORE_ROOT;
  if (!root) {
    // Unknowable rather than false, but reported as false: without a datastore
    // the ingest cannot run at all, and claiming a file is in place is the one
    // answer that loses data.
    return false;
  }

  // Leading slashes are stripped for the same reason models/File.js strips
  // them: getRelativePath() has always returned "/group/project/...", and
  // path.join() quietly treated that as relative.
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
 * The documents whose files are already in the datastore, by original name.
 *
 * A Map rather than a Set of names because the documents themselves are needed
 * once the files are in place but the steps that follow the move are not (see
 * finaliseReadStage). A name that appears twice resolves to the later
 * document: a retry that re-attempted a file leaves the earlier File/Read pair
 * behind on purpose (see planRawFileStage), and the newer pair is the one its
 * move wrote.
 *
 * @param {Array<object>} docs - Read or AdditionalFile documents, file populated.
 * @returns {Promise<Map<string, object>>} The docs that need no second attempt.
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
 * What is left of a run's raw-file stage: the files still to move, and whether
 * the steps that follow the last move still have to be run.
 *
 * Two questions, deliberately separate. Answering only the first is how the
 * previous version of this went wrong: it returned an empty list when every
 * file was already in place, and runIngestJob read that as "skip the whole
 * stage". But the stage is sortReadFiles -> processReadFiles
 * (lib/file-utils.js), which moves the files *and then* links paired siblings
 * and writes the run's "complete" status. A kill between the last file landing
 * and the completeJob write therefore came back to a retry that delivered
 * nothing, linked nothing, and then marked the job done — leaving the run at
 * "pending" with nothing left to run. POST /runs/:id/reingest cannot repair
 * that: it only requeues a job whose status is "failed", so it answers 409 for
 * a job that recorded itself as done (routes/runs.js). "Pending forever with
 * the files sitting right there" is the exact state this queue exists to
 * abolish.
 *
 * A second pass over a file that already moved cannot succeed: the source is
 * gone and the destination is occupied, and File.moveToFolderAndSave refuses
 * to "recover" either case precisely so that a retry can never truncate or
 * clobber a read that is already safely in the datastore. So a retry has to
 * recognise its own earlier work rather than repeat it — by the bytes being at
 * the destination, never by a document existing (see isAtDestination).
 *
 * A file whose Read was saved but never moved is therefore re-attempted, and
 * that re-attempt writes a second File and Read for it. The stale pair is left
 * behind deliberately: the alternative is deleting documents on a retry path,
 * and an orphan row an operator can see beats a read nobody ever delivers.
 *
 * All-or-nothing on purpose. Sibling reads are paired within a single
 * processReadFiles pass (lib/file-utils.js) by looking siblings up among the
 * files in that pass, so handing it half a pair fails the lookup for the half
 * that was already done. A partly ingested set is therefore re-attempted
 * whole — noisy, and it will fail again, but it fails loudly with the run
 * marked errored rather than quietly mis-pairing reads. A set that is entirely
 * ingested is skipped — but only the moving is skipped, never the pairing and
 * the status write, which is what `finalise` is for.
 *
 * @param {mongoose.Types.ObjectId|string} runId - The run being ingested.
 * @param {Array<object>} rawFiles - The raw files from the job payload.
 * @returns {Promise<{toMove: Array<object>, finalise: boolean,
 *   ingestedReads: Map<string, object>}>} The files to hand to sortReadFiles,
 *   whether the post-move steps are owed, and the Reads already in place.
 */
const planRawFileStage = async (runId, rawFiles) => {
  if (!rawFiles || rawFiles.length === 0) {
    // No raw files were ever owed, so there is no stage and nothing to
    // finalise. processReadFiles returns early on an empty list for the same
    // reason, and a run with no reads has never been marked complete here.
    return { toMove: [], finalise: false, ingestedReads: new Map() };
  }

  const existingReads = await Read.find({ run: runId }).populate("file");
  const ingestedReads = await ingestedByName(existingReads);

  if (ingestedReads.size === 0) {
    return { toMove: rawFiles, finalise: false, ingestedReads };
  }

  const remaining = rawFiles.filter((file) => !ingestedReads.has(file.name));

  if (remaining.length === 0) {
    console.log(
      `[Ingest Queue] Run ${runId}: all ${rawFiles.length} raw file(s) are already in the datastore; running the steps that follow the move`,
    );
    return { toMove: [], finalise: true, ingestedReads };
  }

  if (remaining.length !== rawFiles.length) {
    console.warn(
      `[Ingest Queue] Run ${runId}: ${rawFiles.length - remaining.length} of ${rawFiles.length} raw file(s) are already ingested. Retrying the whole set, because reads are paired within a single pass.`,
    );
  }

  return { toMove: rawFiles, finalise: false, ingestedReads };
};

/**
 * The sibling links a raw-file payload describes, as pairs of original names.
 *
 * Mirrors what processSingleReadFile records for linkPairedReads
 * (lib/file-utils.js): an hpc-mv file names its sibling outright, while a
 * local-filesystem upload pairs the two files sharing a rowID. Each link is
 * directed, exactly as it is there — a file that names no sibling gets none
 * written for it, even if something else names it.
 *
 * linkPairedReads is now exported, but calling it from here is still not a
 * drop-in: it takes `pairingInfo` records that already carry the `readId`s it
 * writes, whereas this runs over the raw payload files, where only the names
 * exist. Converging the two means lifting the two rules out over a normalised
 * input, not having one call the other. **Until that happens this function and
 * linkPairedReads have to be read together: if the pairing rules change there,
 * they must change here.**
 *
 * @param {Array<object>} rawFiles - The raw files from the job payload.
 * @param {string} uploadMethod - "hpc-mv" or "local-filesystem".
 * @returns {Array<Array<string>>} [readName, siblingName] pairs.
 */
const siblingLinks = (rawFiles, uploadMethod) => {
  const files = (rawFiles || []).filter((file) => file && file.name);

  if (uploadMethod === "hpc-mv") {
    return files
      .filter((file) => file.sibling)
      .map((file) => [file.name, file.sibling]);
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
      // The same complaint linkPairedReads makes, for the same reason: a row
      // that is not a pair cannot be paired, and guessing would link the wrong
      // two reads.
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
 * Runs the steps processReadFiles performs after its last file lands, for a
 * retry that found every file already there.
 *
 * Only reached when the stage moved nothing (see planRawFileStage). When
 * sortReadFiles does run, it does all of this itself and this must not run as
 * well.
 *
 * A failure here is thrown, not swallowed: runIngestJob's catch turns it into
 * a retry and, once the attempts are gone, into a run marked "error" with the
 * message on it. That is the point — every way out of this function is a state
 * an operator can see, and "pending with no job left to run" is not one of
 * them.
 *
 * @param {mongoose.Types.ObjectId|string} runId - The run being ingested.
 * @param {Array<object>} rawFiles - The raw files from the job payload.
 * @param {object} [uploadInfo] - The payload's rawFilesUploadInfo.
 * @param {Map<string, object>} ingestedReads - Reads whose bytes are in place.
 * @returns {Promise<void>}
 */
const finaliseReadStage = async (
  runId,
  rawFiles,
  uploadInfo,
  ingestedReads,
) => {
  const method = (uploadInfo && uploadInfo.method) || "local-filesystem";

  const updates = [];
  siblingLinks(rawFiles, method).forEach(([name, siblingName]) => {
    const read = ingestedReads.get(name);
    const sibling = ingestedReads.get(siblingName);

    if (!read || !sibling) {
      // Every name in rawFiles has an ingested Read by construction — a stage
      // is only finalised when all of them do — so a miss means the payload
      // named a sibling that was never among this run's raw files. Loud, but
      // not fatal: the bytes are all delivered, and refusing to finish would
      // strand the run at "pending" to fix a broken cross-reference.
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
      `[Ingest Queue] Run ${runId}: linked ${updates.length} paired read(s) the previous attempt did not reach`,
    );
  }

  // Step 6 of processReadFiles. Without it a run whose files are all in the
  // datastore sits at "pending" for good, which reads as an ingest that never
  // started.
  await Run.findByIdAndUpdate(runId, { $set: { status: "complete" } });
};

/**
 * The additional files this run has not already ingested.
 *
 * Filtered per file, unlike the raw files above: additional files have no
 * sibling linking, so each one stands entirely on its own and skipping one
 * cannot affect another. There is nothing to finalise here either —
 * processAdditionalFiles moves files and writes rows, and stops. The run's
 * status belongs to the read stage.
 *
 * Skipped on the same evidence, too. AdditionalFile's post-save hook moves the
 * file and then swallows whatever the move threw, so a row surviving a failed
 * move is the ordinary case here rather than a rare one.
 *
 * @param {mongoose.Types.ObjectId|string} runId - The run being ingested.
 * @param {Array<object>} additionalFiles - The additional files from the payload.
 * @returns {Promise<Array<object>>} The files to hand to sortAdditionalFiles.
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
 * Does the actual ingest for one claimed job.
 *
 * This is the body of the old setImmediate() closure in routes/runs.js, with
 * its sequencing and its error handling kept as they were: files first, then
 * the overseer email, then MD5 verification, with a failure in either of the
 * last two logged and swallowed rather than failing the ingest.
 *
 * The one deliberate difference is the outer catch. The route logged and
 * dropped it, because there was nothing left to tell; here it is re-thrown so
 * the worker can retry the job or mark it failed. Dropping it is what made
 * the original bug invisible.
 *
 * @param {mongoose.Document} job - The claimed IngestJob.
 * @returns {Promise<void>}
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
    if (rawStage.toMove.length > 0) {
      fileProcessingPromises.push(
        sortReadFiles(
          rawStage.toMove,
          run._id,
          run.path,
          rawFilesUploadInfo,
          payload.username,
        ),
      );
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

    // The read stage is more than the moves. When sortReadFiles was skipped
    // because every file was already delivered, the pairing and the run's
    // "complete" status are still owed — and nothing else in the system will
    // ever write them.
    if (rawStage.finalise) {
      await finaliseReadStage(
        run._id,
        rawFiles,
        rawFilesUploadInfo,
        rawStage.ingestedReads,
      );
    }

    // Send email after file processing succeeds. Awaited rather than left
    // floating, so the job is not marked done while a notification is still
    // in flight — its failure is still only logged.
    await sendOverseerEmail({ type: "Run", data: run }).catch((err) => {
      console.error(
        `[${requestId}] Failed to send overseer email for run ${run._id}:`,
        err,
      );
    });

    // Trigger MD5 verification after files are moved
    await verifyRunMd5(run._id)
      .then(async (result) => {
        // ONLY send emails if there is a problem (silent success)
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
        // Not fatal to the job: the files are already in place, and the
        // 5-minute background job re-verifies anything still marked pending.
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
 *
 * Progress, not attendance: a completed claim query, or a lease renewal for a
 * job that has not yet overrun MAX_JOB_MS. The interval callback firing proves
 * nothing, and neither does a lease renewal on its own — both happen just as
 * reliably around a worker that has been stuck inside one job for days, which
 * is the state /ready exists to notice (see server.js).
 *
 * @returns {?Date} The time of the last completed round-trip.
 */
const getLastTickAt = () => lastTickAt;

/**
 * Starts polling for ingest jobs, after returning any orphaned work to the
 * queue.
 *
 * One job at a time: this process is pinned to a single PM2 instance (see
 * ecosystem.config.js) and an ingest is IO-bound on the datastore mount, so
 * overlapping jobs would compete for the same disk rather than finish sooner.
 *
 * @param {object} [options]
 * @param {number} [options.intervalMs] - How often to poll.
 * @param {number} [options.leaseMs] - How long a claim is held between
 *   renewals. Raised to MIN_LEASE_POLLS polls if it is shorter than that,
 *   because only a poll renews it.
 * @param {number} [options.maxJobMs] - How long one job may run before the
 *   worker stops renewing its lease and stops reporting progress.
 * @param {string} [options.workerId] - Overrides the default host:pid:boot
 *   identity. Whatever is passed is what recoverStaleJobs treats as live.
 * @returns {{stop: function(): Promise<void>}} A handle that drains on stop.
 */
const startIngestWorker = (options = {}) => {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    maxJobMs = DEFAULT_MAX_JOB_MS,
    workerId = defaultWorkerId(),
  } = options;

  // See MIN_LEASE_POLLS: a lease the heartbeat cannot reach in time is one a
  // live worker loses, which is the failure the lease exists to prevent.
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

  // Registered before the recovery below runs, so this worker's own claims are
  // never mistaken for a dead process's. Removed again by stop().
  liveWorkerIds.add(workerId);

  // Startup recovery, before the first claim rather than alongside it: work
  // orphaned by the previous process is the oldest and most at risk, and every
  // tick waits on this so a poll cannot get in ahead of it.
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
   * Pushes the lease on the job in flight out, and records the round-trip —
   * for as long as the job is still inside its runtime bound.
   *
   * A long ingest must not look like a stall, so the worker says so with a
   * write it actually completed rather than with a timer that fires either
   * way. But "the worker is alive" and "the queue is draining" are different
   * claims, and a heartbeat that renews forever makes the first stand in for
   * the second: a worker hung inside one job kept its lease indefinitely, so
   * no other worker could take the job, and kept reporting fresh ticks, so
   * /ready stayed green while a queued job behind it was never claimed. That
   * was observed, not theorised.
   *
   * Past maxJobMs this stops doing both. The lease then lapses on its own
   * schedule and the job becomes claimable by another worker; the tick goes
   * stale and /ready turns red within INGEST_TICK_STALE_MS (server.js). The
   * hung worker is not killed — nothing here can do that — but it stops being
   * the reason nobody else can see the problem.
   *
   * @returns {Promise<void>}
   */
  const heartbeat = async () => {
    const jobId = currentJobId;
    if (!jobId || heartbeatInFlight) {
      return;
    }

    const runningForMs = Date.now() - currentJobStartedAt;
    if (runningForMs > maxJobMs) {
      if (!overrunReported) {
        overrunReported = true;
        console.error(
          `[Ingest Queue] Job ${jobId} has held worker ${workerId} for ${Math.round(
            runningForMs / 60000,
          )} min, past the ${Math.round(
            maxJobMs / 60000,
          )} min bound. No longer renewing its lease or reporting progress: the claim lapses within ${Math.round(
            leaseMs / 60000,
          )} min so another worker can take it over, and readiness will report this worker as not draining the queue.`,
        );
      }
      return;
    }

    heartbeatInFlight = true;
    try {
      const result = await IngestJob.updateOne(claimFilter(jobId, workerId), {
        $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
      });

      if (fencedWriteLanded(result, jobId, workerId, "extend its lease")) {
        recordProgress();
      }
    } catch (error) {
      // Left unrecorded on purpose: an unreachable queue is exactly the
      // condition the staleness check should surface.
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
    // The claim query came back, which is the whole of what an idle worker can
    // prove about itself.
    recordProgress();

    if (!job) {
      return;
    }

    if (job.attempts > job.maxAttempts) {
      // Claiming increments attempts, so this is a claim past the limit. It is
      // reachable only via lease expiry: failJob would have marked the job
      // failed itself, but a worker that is killed never gets to call it.
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
    // The clock the overrun bound is measured against. Set from the claim, not
    // from the first heartbeat, so a job that hangs before its first tick is
    // bounded like any other.
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
      // Busy, not idle. Heartbeating says so to the queue and to /ready in the
      // one way that cannot be said by a timer that fires regardless — and
      // stops saying it once the job has overrun. Checked before `stopped`
      // because a draining worker still holds a live claim: dropping the
      // heartbeat at the top of stop() would let the lease lapse mid-drain and
      // invite a second worker onto the files this one is still moving.
      heartbeat();
      return;
    }

    if (stopped) {
      return;
    }

    inFlight = processOne()
      .catch((error) => {
        // Only reachable if the queue itself is unusable (Mongo down, say).
        // The interval keeps running: the next tick is the retry.
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

      // Deregistered here rather than after the drain below: from this point
      // the worker claims nothing new, and anything it still holds when the
      // process goes is orphaned work for the next boot to recover.
      liveWorkerIds.delete(workerId);

      try {
        // Waiting matters: the in-flight job holds a lease and is moving
        // files. Returning before it settles would leave the claim behind and
        // put the job through the lease-expiry path on the next boot for no
        // reason.
        const pending = inFlight;
        if (pending) {
          await pending;
        }
      } finally {
        // Stopped last, not first: the timer is what renews the lease on the
        // job being drained (see tick), and the lease is now measured in
        // minutes rather than an hour.
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
  RUN_INGEST_TYPE,
  DEFAULT_LEASE_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_JOB_MS,
};
