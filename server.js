const app = require("./app");
const mongoose = require("mongoose");
const {
  initializeBackgroundJobs,
  stopBackgroundJobs,
} = require("./lib/background-jobs");
const { getBlockingTransfers } = require("./lib/active-transfers");

const PORT = process.env.PORT || 3000;
const mongoosePort = process.env.MONGODB_PORT || 27017;

// martin doesn't expose mongodb outside of the web server; you'd never want to
// make that available otherwise people could brute force attack. Even if you
// tried to do this, the server would probably complain. You probably dont want
// to tinker the live db, just the local db (e.g. modify a model file).
const MONGO_URI = `mongodb://localhost:${mongoosePort}/komondor`;

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

let server = null;
let shuttingDown = false;

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
 * Closes the HTTP listener, cron jobs and DB connection, then exits.
 *
 * A clean shutdown is refused while files are moving. Note that this only
 * buys time: PM2 follows SIGINT with SIGKILL after `kill_timeout`, which no
 * process can intercept. The real protection against a truncated file is in
 * File.moveToFolderAndSave, which copies to a `.part-` sibling and renames it
 * into place, so an abrupt kill can never leave a partial file under the real
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

  try {
    stopBackgroundJobs();
  } catch (err) {
    console.error("Error stopping background jobs:", err);
  }

  const finish = () => {
    mongoose.connection
      .close()
      .catch((err) => console.error("Error closing MongoDB connection:", err))
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

// will create database if it can't see one
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000, // 10 seconds
  })
  .then(() => {
    console.log("Connected to MongoDB");
    // Initialize background jobs after DB connection is established
    initializeBackgroundJobs();
  })
  .catch((err) => {
    // Every endpoint needs the database, so serving traffic without it would
    // only produce 500s. Exit and let the supervisor retry.
    console.error("Error connecting to MongoDB", err);
    shutdown(1);
  });

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

server = app.listen(PORT, () => console.log(`API running on port ${PORT}!`));

// Exported so the shutdown guard can be exercised directly; nothing else
// should call this — the signal handlers above are the entry point.
module.exports = { shutdown };
