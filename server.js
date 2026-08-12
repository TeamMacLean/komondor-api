const app = require("./app");
const mongoose = require("mongoose");
const {
  initializeBackgroundJobs,
  stopBackgroundJobs,
} = require("./lib/background-jobs");
const { getActiveTransfers } = require("./lib/active-transfers");

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

/**
 * Closes the HTTP listener, cron jobs and DB connection, then exits.
 * @param {number} code - The exit code to use.
 */
function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  
  const transfers = getActiveTransfers();
  if (transfers.length > 0 && code === 0) {
    console.warn(`\n[WARNING] Attempted to shut down, but ${transfers.length} file transfer(s) are currently in progress!`);
    console.warn(`If you shut down now, these massive genomic files will be truncated and corrupted.`);
    console.warn(`Active transfers:`);
    transfers.forEach(t => console.warn(`  - ${t.filename} (${t.id})`));
    console.warn(`\nShutdown aborted. To force shutdown and kill the transfers, run: pm2 restart komondor-api --force (or send SIGKILL).\n`);
    return;
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
    console.log(`Received ${signal}, shutting down`);
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
