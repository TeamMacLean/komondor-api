/**
 * A unit of deferred work the API has already accepted.
 *
 * Before this existed, run ingest happened in a setImmediate() closure that
 * only ever lived in process memory: the client got its 201 and the file
 * movement started, but nothing anywhere recorded that the work was owed. PM2
 * sends SIGINT and then SIGKILLs after kill_timeout (see ecosystem.config.js),
 * so a deploy landing in that window stranded the ingest permanently, with no
 * trace of it beyond a run stuck at "pending".
 *
 * A row here is that trace. It outlives the process that created it, which is
 * the entire point of the model.
 */

const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const STATUSES = ["pending", "claimed", "done", "failed"];

const schema = new Schema(
  {
    // "run-ingest" is the only kind so far. It is stored rather than assumed
    // so a second kind of deferred work can share the queue and its recovery
    // without a migration.
    type: { type: String, required: true },

    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true },

    // Carried from the request that accepted the work so every line the worker
    // logs can be grepped alongside the route's own [requestId] lines — the
    // job runs long after the request has gone, and without this there is
    // nothing tying the two together.
    requestId: { type: String },

    // Derived from runId (see idempotencyKeyFor in lib/ingest-queue.js), so a
    // repeated enqueue — a client retrying, or the route being re-entered for
    // a run that already exists — collides on this index instead of queueing
    // the same file moves a second time.
    //
    // Sparse because a unique index would otherwise treat every key-less
    // document as a duplicate of the first one.
    idempotencyKey: { type: String, unique: true, sparse: true },

    // { rawFiles, additionalFiles, rawFilesUploadInfo }: the parts of the
    // request body the ingest needs. Copied rather than referenced, because
    // the request object is exactly the thing that does not survive a restart.
    payload: { type: Schema.Types.Mixed },

    status: { type: String, enum: STATUSES, default: "pending", index: true },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: String },

    // Which process holds the claim, and which machine that process is on.
    //
    // workerId names one *boot* of one process (host:pid:bootId — see
    // defaultWorkerId in lib/ingest-queue.js), not just the host and pid: a
    // restarted worker can be handed its predecessor's pid, and recovery has
    // to be able to tell "the process that claimed this is still running" from
    // "something with the same name is". workerHost is stored separately so
    // that question can be asked with a query rather than by parsing ids.
    //
    // Both are absent on jobs claimed before this existed, which is why
    // recoverStaleJobs still falls back to the lease for anything unattributed.
    workerId: { type: String },
    workerHost: { type: String },

    // Deliberately means two related things, depending on `status`:
    //
    //   claimed: when this worker's exclusive hold lapses and the job may be
    //            taken over. A lease is the only thing that can release a job
    //            held by a process that was SIGKILLed — such a process never
    //            gets to unlock anything on its way out.
    //
    //   pending: the earliest time the job may be claimed, which is how retry
    //            backoff is expressed (see failJob). Unset means claimable now,
    //            which is what a fresh job and a recovered job both look like.
    leaseExpiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

// The claim is a single findOneAndUpdate filtering on status and
// leaseExpiresAt and sorting by createdAt. Without this index that query scans
// every job ever run, and the collection only grows.
schema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });

const IngestJob = model("IngestJob", schema);

module.exports = IngestJob;
