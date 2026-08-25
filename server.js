const dotenv = require("dotenv");

// Loaded here, before anything is validated, so that validateEnv sees .env.
// app.js calls dotenv.config() too; the second call leaves already-set
// variables alone, so this changes nothing beyond when validation can run.
dotenv.config();

const {
  validateEnv,
  resolveHost,
  resolveMongoUri,
} = require("./lib/utils/validateEnv");
const app = require("./app");
const mongoose = require("mongoose");
const {
  initializeBackgroundJobs,
  stopBackgroundJobs,
} = require("./lib/background-jobs");
const { getBlockingTransfers } = require("./lib/active-transfers");

// A hard dependency, deliberately required outright.
//
// This used to be a guarded require, on the premise that the process should
// still boot on a checkout without lib/ingest-queue.js and report the gap via
// /ready. That guard could never run: `require("./app")` above pulls in
// routes/runs.js, which requires the same module unconditionally, so a missing
// or unparseable queue module has already thrown one line earlier. The
// try/catch read as resilience and provided none — worse than nothing, because
// it described a fallback path that did not exist.
//
// If the queue ever does become optional, it has to become optional in
// routes/runs.js first.
const ingestQueue = require("./lib/ingest-queue");

const PORT = process.env.PORT || 3000;

// Defaults to loopback in development, where routes/auth.js accepts hardcoded
// credentials; see lib/utils/validateEnv.js, which refuses to start any other
// combination.
const HOST = resolveHost(process.env);

// martin doesn't expose mongodb outside of the web server; you'd never want to
// make that available otherwise people could brute force attack. Even if you
// tried to do this, the server would probably complain. You probably dont want
// to tinker the live db, just the local db (e.g. modify a model file).
//
// MONGODB_URI overrides the locally-assembled URI; both go through the same
// validation, which insists on a database name.
const MONGO_URI = resolveMongoUri(process.env);

// A worker that has not polled in this long has stopped doing its job while
// the process carries on looking healthy — the case a liveness probe cannot
// see. Generous next to the poll interval (seconds): the tick is recorded only
// by a completed database round-trip (a claim query that returned, or a lease
// heartbeat that landed), and a slow round-trip is not a stalled queue. The
// 15-minute default still holds for a long ingest, which heartbeats every poll
// interval for its whole duration and so keeps reporting fresh.
const INGEST_TICK_STALE_MS =
  Number(process.env.INGEST_TICK_STALE_MINUTES || 15) * 60 * 1000;

// Node already terminates on an unhandled rejection. These handlers exist to
// log the cause first — registering a listener that only logged would suppress
// that default and leave the process serving traffic in an unknown state.
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  shutdown(1);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  // The process state is no longer trustworthy — let the supervisor restart it.
  shutdown(1);
});

// A worker that has started but has not recorded a poll yet is given this long
// before readiness calls it stalled. The first tick lands one poll interval
// after the start (seconds), so this is generous — but bounded, because a
// worker whose timer never fires reports "no poll recorded" forever, and
// treating that as healthy is how a queue nothing drains keeps a green /ready.
const INGEST_FIRST_TICK_GRACE_MS = 60 * 1000;

// How long a refused shutdown keeps the process out of the load balancer.
//
// Longer than PM2's kill_timeout (30s, ecosystem.config.js), so the SIGKILL
// that normally follows lands while the process is still draining. If it does
// not — an operator's own SIGINT, a supervisor that does not follow through —
// the process is still serving fine, so it goes back into the pool rather than
// sitting unready forever with nothing to bring it back.
const REFUSED_SHUTDOWN_DRAIN_MS = 45 * 1000;

let server = null;
let shuttingDown = false;
let ingestWorker = null;
let ingestWorkerStartedAt = null;
let refusedShutdownTimer = null;

// A transfer running longer than this is treated as stalled rather than
// active. Without it, a single copy hung on an unresponsive mount would block
// every clean shutdown indefinitely, with SIGKILL as the only way out.
const STALLED_TRANSFER_MS =
  Number(process.env.STALLED_TRANSFER_MINUTES || 360) * 60 * 1000;

/** Formats one transfer for the operator-facing warning. */
const describeTransfer = (transfer) =>
  `  - ${transfer.filename} (${transfer.id}), running for ${Math.round(
    transfer.ageMs / 60000,
  )} min`;

/**
 * Reads the ingest worker's last poll time.
 *
 * Normalising rather than trusting: the queue reports a Date, but "no tick
 * yet" is null, and anything unparseable has to land in the same bucket as
 * null — absence of evidence, never a fresh poll.
 *
 * @returns {number|null} Epoch milliseconds, or null when nothing is reported.
 */
const readIngestTick = () => {
  const reported = ingestQueue.getLastTickAt();
  const ms = reported instanceof Date ? reported.getTime() : Number(reported);

  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/** The /ready entry for the ingest worker. */
const ingestWorkerReadiness = () => {
  if (!ingestWorker) {
    return { ok: false, detail: "not running" };
  }

  const lastTickAt = readIngestTick();

  if (lastTickAt === null) {
    // No poll recorded. Expected for the first poll interval after start — a
    // second or two — and failing readiness for the length of our own startup
    // would take a working API out of the pool for no reason. Past the grace
    // window it is not "starting up" any more, it is a worker that has never
    // reported doing its job, which is the same fault as one that stopped.
    const startingForMs = Date.now() - ingestWorkerStartedAt;

    return {
      ok: startingForMs <= INGEST_FIRST_TICK_GRACE_MS,
      detail: `running; no poll recorded ${Math.round(startingForMs / 1000)}s after start`,
    };
  }

  const ageMs = Date.now() - lastTickAt;

  return {
    ok: ageMs <= INGEST_TICK_STALE_MS,
    detail: `last tick ${Math.round(ageMs / 1000)}s ago`,
  };
};

/**
 * The worker options this process actually configures.
 *
 * Only what the environment sets is passed on. lib/ingest-queue.js owns the
 * defaults — its lease length is reasoned about against how long an ingest of
 * a multi-terabyte read takes — and a default repeated here would silently
 * override that.
 *
 * Number() is safe here: validateEnv has already refused to start on a value
 * that does not parse or falls outside its bounds, which is what stops a typo
 * becoming a 1ms poll loop or a NaN lease that fails every claim.
 *
 * @returns {Object} Options for startIngestWorker.
 */
const ingestWorkerOptions = () => {
  const options = {};

  if (process.env.INGEST_POLL_MS) {
    options.intervalMs = Number(process.env.INGEST_POLL_MS);
  }
  if (process.env.INGEST_LEASE_MINUTES) {
    options.leaseMs = Number(process.env.INGEST_LEASE_MINUTES) * 60 * 1000;
  }

  return options;
};

/** Starts the ingest worker and adds it to the readiness report. */
const startIngestWorker = () => {
  // Recorded before the call, so the first-tick grace window covers the start
  // itself rather than beginning after it.
  ingestWorkerStartedAt = Date.now();

  try {
    ingestWorker = ingestQueue.startIngestWorker(ingestWorkerOptions());
  } catch (err) {
    console.error("Error starting the ingest worker:", err);
  }

  // Registered even when the start above failed, so /ready reports the missing
  // worker rather than staying quiet about a queue that is not being drained.
  app.registerReadinessCheck("ingest-worker", ingestWorkerReadiness);
};

/** Stops the ingest worker. Never rejects: shutdown must continue regardless. */
const stopIngestWorker = () => {
  if (!ingestWorker || typeof ingestWorker.stop !== "function") {
    return Promise.resolve();
  }

  return Promise.resolve()
    .then(() => ingestWorker.stop())
    .catch((err) => console.error("Error stopping the ingest worker:", err));
};

/**
 * Takes the process out of the load balancer for the length of a refused
 * shutdown, then puts it back if it is somehow still running.
 *
 * A refusal is not a decision to stay: the signal that prompted it is almost
 * always PM2's SIGINT, and the SIGKILL arrives 30s later. Staying ready across
 * that window means new requests keep arriving right up to the kill. Draining
 * costs nothing if the kill lands, and the timer below covers the case where
 * it does not.
 */
const drainForRefusedShutdown = () => {
  app.setDraining(true);

  if (refusedShutdownTimer) {
    // A second refusal restarts the window rather than inheriting the tail of
    // the first one's.
    clearTimeout(refusedShutdownTimer);
  }

  refusedShutdownTimer = setTimeout(() => {
    refusedShutdownTimer = null;

    if (shuttingDown) {
      // A later shutdown went ahead. It is leaving; it stays drained.
      return;
    }

    console.warn(
      `[WARNING] Still running ${Math.round(
        REFUSED_SHUTDOWN_DRAIN_MS / 1000,
      )}s after refusing to shut down; reporting ready again.`,
    );
    app.setDraining(false);
  }, REFUSED_SHUTDOWN_DRAIN_MS);

  // unref'd, unlike the exit timer in shutdown(): this one exists to bring a
  // surviving process back, so it must never be the reason the process is
  // still alive to come back to.
  if (typeof refusedShutdownTimer.unref === "function") {
    refusedShutdownTimer.unref();
  }
};

/**
 * Closes the HTTP listener, cron jobs and DB connection, then exits.
 *
 * A clean shutdown is refused while files are moving. Note that this only
 * buys time: PM2 follows SIGINT with SIGKILL after `kill_timeout`, which no
 * process can intercept. The real protection against a truncated file is in
 * File.moveToFolderAndSave, which copies to a `.part-` sibling and then LINKS
 * it into place (link, not rename: rename would silently overwrite an existing
 * destination), so an abrupt kill can never leave a partial file under the real
 * name. See ecosystem.config.js.
 *
 * @param {number} code - The exit code to use.
 */
function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  const {
    all: transfers,
    inFlight,
    stalled,
  } = getBlockingTransfers(STALLED_TRANSFER_MS);

  if (inFlight.length > 0 && code === 0) {
    console.warn(
      `\n[WARNING] Attempted to shut down, but ${inFlight.length} file transfer(s) are currently in progress!`,
    );
    console.warn(`Active transfers:`);
    inFlight.forEach((t) => console.warn(describeTransfer(t)));
    if (stalled.length > 0) {
      console.warn(
        `(${stalled.length} further transfer(s) ignored: no progress for over ${Math.round(
          STALLED_TRANSFER_MS / 60000,
        )} min, so they are treated as stalled.)`,
      );
    }
    console.warn(
      `\nShutdown aborted. Retry once they finish, or force it with: kill -9 ${process.pid}\n`,
    );
    // Refusing to exit is not refusing to leave: whatever sent the signal is
    // most likely about to SIGKILL this process, so stop new work arriving in
    // the meantime. Reversed after REFUSED_SHUTDOWN_DRAIN_MS if the kill never
    // comes, so a process that keeps running does not stay unready forever.
    drainForRefusedShutdown();
    return;
  }

  if (transfers.length > 0) {
    // Going anyway: either this is a crash path (code !== 0), where the
    // process state is untrustworthy, or every transfer looks stalled.
    console.warn(
      `[WARNING] Exiting with ${transfers.length} file transfer(s) still tracked:`,
    );
    transfers.forEach((t) => console.warn(describeTransfer(t)));
    console.warn(
      "Interrupted copies are left as .part- files, which the API ignores; the source files are untouched.",
    );
  }

  shuttingDown = true;

  if (refusedShutdownTimer) {
    // An earlier refusal armed a timer to report ready again. This shutdown is
    // going ahead, so that timer must not put a departing process back into
    // the pool. (It also checks `shuttingDown`; this just stops it firing.)
    clearTimeout(refusedShutdownTimer);
    refusedShutdownTimer = null;
  }

  // Set before anything is closed, so the drain window starts before requests
  // can be dropped. Idempotent: a refusal above may already have set it.
  app.setDraining(true);

  try {
    stopBackgroundJobs();
  } catch (err) {
    console.error("Error stopping background jobs:", err);
  }

  const finish = () => {
    // The worker holds jobs and talks to Mongo, so it goes first; leaving it
    // polling a closing connection only produces errors on the way out.
    stopIngestWorker()
      .then(() =>
        mongoose.connection
          .close()
          .catch((err) =>
            console.error("Error closing MongoDB connection:", err),
          ),
      )
      .finally(() => process.exit(code));
  };

  // Armed unconditionally: neither draining connections nor closing the DB
  // connection is guaranteed to settle, and shutdown must always terminate.
  // Deliberately not unref()'d — an unref'd timer lets the loop drain and the
  // process exit 0, which would report a fatal crash as a clean shutdown.
  setTimeout(() => process.exit(code), 10000);

  if (server) {
    server.close(finish);
  } else {
    finish();
  }
}

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    // Deliberately not "shutting down" — shutdown() may refuse, and a log
    // line claiming otherwise sends operators looking for a process that
    // never left.
    console.log(`Received ${signal}`);
    shutdown(0);
  });
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

/** Opens the listener, unless a signal has already started a shutdown. */
const listen = () => {
  if (shuttingDown) {
    // A signal arrived while Mongo was still connecting. Opening the socket
    // now would accept requests this process is already committed to dropping.
    console.warn(
      "Shutdown began before startup finished; not opening the listener",
    );
    return;
  }

  server = app.listen(PORT, HOST, () =>
    console.log(`API running on ${HOST}:${PORT}!`),
  );
};

/**
 * Validates the configuration, connects, then starts serving — in that order.
 *
 * The listener used to open at require time, alongside the connect() call and
 * with no ordering between them, so the process answered requests (and /health
 * answered "ok") during the window before the database was reachable, and kept
 * answering for a moment after connect() had failed and exit was queued.
 *
 * @returns {Promise<void>} Resolves once the server is listening or has given up.
 */
const start = () =>
  validateEnv(process.env).then(({ ok, errors, warnings }) => {
    warnings.forEach((warning) => console.warn(`[CONFIG] ${warning}`));

    if (!ok) {
      console.error(
        `[FATAL] Refusing to start: ${errors.length} configuration problem(s):`,
      );
      errors.forEach((error) => console.error(`  - ${error}`));
      // Nothing is listening or connected yet, so there is nothing to drain.
      process.exit(1);
      return;
    }

    // Two-argument then rather than .catch: a failure thrown by the success
    // path below is not a connection failure and must not be reported as one.
    return mongoose
      .connect(MONGO_URI, {
        useNewUrlParser: true,
        useCreateIndex: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 10000, // 10 seconds
      })
      .then(
        () => {
          console.log("Connected to MongoDB");
          // Background work first, then the socket: both are ready before the
          // first request can arrive.
          initializeBackgroundJobs();
          startIngestWorker();
          listen();
        },
        (err) => {
          // Every endpoint needs the database, so serving traffic without it
          // would only produce 500s. Exit and let the supervisor retry.
          console.error("Error connecting to MongoDB", err);
          shutdown(1);
        },
      );
  });

const started = start().catch((err) => {
  // Startup has no partial success worth keeping: nothing is listening, and
  // the unhandledRejection handler would report this as a runtime fault.
  console.error("[FATAL] Startup failed:", err);
  process.exit(1);
});

// `shutdown` is exported so the shutdown guard can be exercised directly, and
// `started` so a test can wait for the startup sequence instead of racing it;
// nothing else should call either — the signal handlers above are the entry
// point.
module.exports = { shutdown, started };
