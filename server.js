const { loadDotenv } = require("./lib/utils/loadDotenv");

// Loaded here so validateEnv sees .env; app.js's later call is a no-op.
loadDotenv();

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

// Required outright, not guarded: routes/runs.js (reached via ./app above)
// already requires this unconditionally, so a guard here could never run.
const ingestQueue = require("./lib/ingest-queue");

const PORT = process.env.PORT || 3000;

// Defaults to loopback in development; validateEnv refuses any other combination.
const HOST = resolveHost(process.env);

// Mongo is not exposed outside the web server; work against the local db.
// MONGODB_URI overrides the locally-assembled URI; both must name a database.
const MONGO_URI = resolveMongoUri(process.env);

// A worker that has stopped polling while the process still looks healthy is
// the case a liveness probe cannot see. Generous next to the poll interval.
const INGEST_TICK_STALE_MS =
  Number(process.env.INGEST_TICK_STALE_MINUTES || 15) * 60 * 1000;

// These log and then exit: a listener that only logged would suppress Node's
// own termination and leave the process serving traffic in an unknown state.
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  shutdown(1);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  shutdown(1);
});

// How long a started-but-not-yet-polled worker is given before readiness calls
// it stalled. Bounded, so a worker whose timer never fires cannot stay green.
const INGEST_FIRST_TICK_GRACE_MS = 60 * 1000;

// How long a refused shutdown keeps the process out of the load balancer.
// Longer than PM2's kill_timeout (30s), so the SIGKILL usually lands first.
const REFUSED_SHUTDOWN_DRAIN_MS = 45 * 1000;

let server = null;
let shuttingDown = false;
let ingestWorker = null;
let ingestWorkerStartedAt = null;
let refusedShutdownTimer = null;

// Past this a transfer counts as stalled: otherwise one copy hung on an
// unresponsive mount blocks every clean shutdown indefinitely.
const STALLED_TRANSFER_MS =
  Number(process.env.STALLED_TRANSFER_MINUTES || 360) * 60 * 1000;

/** Formats one transfer for the operator-facing warning. */
const describeTransfer = (transfer) =>
  `  - ${transfer.filename} (${transfer.id}), running for ${Math.round(
    transfer.ageMs / 60000,
  )} min`;

/** Reads the ingest worker's last poll time; null when nothing usable is reported. */
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
 * The worker options this process actually configures. Only what the
 * environment sets is passed on: lib/ingest-queue.js owns the defaults, and a
 * default repeated here would silently override it.
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
  // Recorded before the call, so the grace window covers the start itself.
  ingestWorkerStartedAt = Date.now();

  try {
    ingestWorker = ingestQueue.startIngestWorker(ingestWorkerOptions());
  } catch (err) {
    console.error("Error starting the ingest worker:", err);
  }

  // Registered even when the start above failed, so /ready reports the gap.
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
 * Drains for the length of a refused shutdown, then reports ready again if the
 * process is somehow still running. A refusal is not a decision to stay: the
 * SIGKILL usually follows, so new requests should stop arriving meanwhile.
 */
const drainForRefusedShutdown = () => {
  app.setDraining(true);

  if (refusedShutdownTimer) {
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

  // unref'd: this timer must never be the reason the process is still alive.
  if (typeof refusedShutdownTimer.unref === "function") {
    refusedShutdownTimer.unref();
  }
};

/**
 * Closes the HTTP listener, cron jobs and DB connection, then exits.
 *
 * Refusing while files move only buys time — PM2 follows SIGINT with SIGKILL.
 * The real protection is File.moveToFolderAndSave, which links rather than
 * renames, so a kill cannot leave a partial file under the real name.
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
    // Whatever sent the signal is probably about to SIGKILL this process, so
    // stop new work arriving even though we are refusing to exit.
    drainForRefusedShutdown();
    return;
  }

  if (transfers.length > 0) {
    // Going anyway: either a crash path (code !== 0) or every transfer is stalled.
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
    // An earlier refusal armed a timer to report ready again; a departing
    // process must not go back into the pool.
    clearTimeout(refusedShutdownTimer);
    refusedShutdownTimer = null;
  }

  // Set before anything is closed, so draining starts before requests can be
  // dropped. Idempotent: a refusal above may already have set it.
  app.setDraining(true);

  try {
    stopBackgroundJobs();
  } catch (err) {
    console.error("Error stopping background jobs:", err);
  }

  const finish = () => {
    // Worker first: leaving it polling a closing connection only produces errors.
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

  // Armed unconditionally, and deliberately not unref()'d: an unref'd timer
  // would let the loop drain and exit 0, reporting a crash as a clean shutdown.
  setTimeout(() => process.exit(code), 10000);

  if (server) {
    server.close(finish);
  } else {
    finish();
  }
}

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    // Deliberately not "shutting down": shutdown() may refuse.
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
    // A signal arrived while Mongo was connecting; do not accept requests this
    // process is already committed to dropping.
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
 * listen() sits inside the connect continuation so that nothing answers
 * requests (or /health) before the database is known to be reachable.
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
      process.exit(1);
      return;
    }

    // Two-argument then, not .catch: a failure in the success path below is not
    // a connection failure and must not be reported as one.
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
          initializeBackgroundJobs();
          startIngestWorker();
          listen();
        },
        (err) => {
          // Every endpoint needs the database, so exit and let the supervisor retry.
          console.error("Error connecting to MongoDB", err);
          shutdown(1);
        },
      );
  });

const started = start().catch((err) => {
  console.error("[FATAL] Startup failed:", err);
  process.exit(1);
});

// Exported for tests: the signal handlers above are the real entry point.
module.exports = { shutdown, started };
