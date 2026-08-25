/**
 * A unit of deferred work the API has already accepted. The row outlives the
 * process that created it, so a restart mid-ingest leaves a trace of the work
 * that is still owed.
 */

const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const STATUSES = ["pending", "claimed", "done", "failed"];

const schema = new Schema(
  {
    // Stored, not assumed, so another kind of work can share the queue.
    type: { type: String, required: true },

    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true },

    // The accepting request, so the worker's logs can be grepped alongside it.
    requestId: { type: String },

    // Derived from runId (idempotencyKeyFor in lib/ingest-queue.js): a repeated
    // enqueue collides here instead of moving the same files twice. Sparse, or
    // the unique index treats every key-less document as a duplicate.
    idempotencyKey: { type: String, unique: true, sparse: true },

    // Copied from the request body: the request is what cannot survive a restart.
    payload: { type: Schema.Types.Mixed },

    status: { type: String, enum: STATUSES, default: "pending", index: true },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: String },

    // host:pid:bootId — one *boot* of one process, because a restarted worker
    // can be handed its predecessor's pid. workerHost is diagnostic only.
    workerId: { type: String },
    workerHost: { type: String },

    // claimed: when the holder's claim lapses. The worker's heartbeat renews
    //   it, so a lapsed lease means the holder stopped, not that the job is slow.
    // pending: the earliest time the job may be claimed (retry backoff).
    leaseExpiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

// Covers the claim query: filter on status/leaseExpiresAt, sort by createdAt.
schema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });

const IngestJob = model("IngestJob", schema);

module.exports = IngestJob;
