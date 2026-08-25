const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const fs = require("fs").promises;
const { constants: fsConstants } = require("fs");
const { loadDotenv } = require("./lib/utils/loadDotenv");
loadDotenv();

const authRoutes = require("./routes/auth");
const projectsRoutes = require("./routes/projects");
const samplesRoutes = require("./routes/samples");
const runRoutes = require("./routes/runs");
const searchRoutes = require("./routes/search");
const groupRoutes = require("./routes/groups");
const directoryFilesRoutes = require("./routes/directory-files");
const readFileRoutes = require("./routes/read-file");
const userRoutes = require("./routes/users");
const accessionRoutes = require("./routes/accessions");
const newsRoutes = require("./routes/news");
const uploadRoutes = require("./routes/uploads");
const optionRoutes = require("./routes/options");
const testRoutes = require("./routes/test");
const getUserFromRequest = require("./lib/utils/getUserFromRequest");
const { generateRequestId } = require("./routes/_utils");
const { uploadPath } = require("./lib/utils/uploadPath");

// jsonwebtoken error names that mean "the client's token is bad", not "the server broke".
const JWT_ERROR_NAMES = new Set([
  "JsonWebTokenError",
  "TokenExpiredError",
  "NotBeforeError",
]);

const app = express();

const HEADERS = [
  "Authorization",
  "Content-Type",
  "Location",
  "Tus-Extension",
  "Tus-Max-Size",
  "Tus-Resumable",
  "Tus-Version",
  "Upload-Defer-Length",
  "Upload-Length",
  "Upload-Metadata",
  "Upload-Offset",
  "X-HTTP-Method-Override",
  "X-Requested-With",
];
const EXPOSED_HEADERS = HEADERS.join(", ");
var corsOptions = {
  origin: process.env.WEB_APP_URL,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200,
  exposedHeaders: EXPOSED_HEADERS,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

/**
 * Attaches req.user when the request carries a valid bearer token.
 *
 * A malformed or expired token is *not* a server error: it is reported as 401
 * so clients know to re-authenticate. Previously the rejection was passed to
 * next(err) and surfaced as a 500, which made every request from a client with
 * a stale token look like an API outage.
 */
app.use((req, res, next) => {
  getUserFromRequest(req)
    .then((user) => {
      if (user) {
        req.user = user;
      }
      next();
    })
    .catch((err) => {
      if (JWT_ERROR_NAMES.has(err && err.name)) {
        return res.status(401).send({
          error: "Invalid or expired authentication token",
          detail: err.message,
        });
      }
      next(err);
    });
});

// Mongoose's numeric connection states, spelled out for the readiness body.
// 99 ("uninitialized") exists too and falls through to the generic branch.
const MONGO_READY_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

// Mounts every write path depends on. Read at request time rather than at
// import: they are what readiness is reporting on, so a probe must see the
// current value and the current state of the disk, not a snapshot from boot.
const REQUIRED_MOUNTS = ["DATASTORE_ROOT", "HPC_TRANSFER_DIRECTORY"];

// Set by server.js at the start of a shutdown. A load balancer polling /ready
// then stops sending work while the process drains, instead of watching
// requests die mid-flight when the listener closes underneath them.
let draining = false;

// Dependencies that only server.js knows about (the ingest worker, today).
// Registering them keeps app.js free of requires for modules it does not use.
const extraReadinessChecks = new Map();

/**
 * Marks the process as draining, so /ready reports 503 from here on.
 * @param {boolean} value - True once shutdown has begun.
 */
app.setDraining = (value) => {
  draining = Boolean(value);
};

/**
 * Adds a dependency probe to /ready.
 * @param {string} name - Reported as the check's name.
 * @param {Function} check - Returns {ok, detail} or a promise of one.
 */
app.registerReadinessCheck = (name, check) => {
  extraReadinessChecks.set(name, check);
};

/** Reports whether the database connection is usable right now. */
const checkMongo = () => {
  const state = mongoose.connection.readyState;

  return {
    name: "mongodb",
    ok: state === 1,
    detail: MONGO_READY_STATES[state] || `readyState ${state}`,
  };
};

/**
 * Reports whether a mount is present and writable.
 *
 * The path is deliberately not echoed back: this endpoint is unauthenticated,
 * and the layout of the datastore is not something to hand out to anyone who
 * can reach it. The name says which mount it is, and the errno says what is
 * wrong with it.
 *
 * @param {string} name - Reported as the check's name.
 * @param {string} path - The directory to test.
 */
const checkMount = (name, path) => {
  if (!path) {
    return Promise.resolve({ name, ok: false, detail: "not configured" });
  }

  return fs
    .access(path, fsConstants.R_OK | fsConstants.W_OK)
    .then(() => ({ name, ok: true, detail: "accessible" }))
    .catch((err) => ({
      name,
      ok: false,
      detail: `not readable and writable (${err.code || err.message})`,
    }));
};

/** The mount named by an environment variable, read at request time. */
const checkEnvMount = (name) => checkMount(name, process.env[name]);

/**
 * Reports whether the tus upload staging directory is usable.
 *
 * Separate from REQUIRED_MOUNTS because it is not simply an env var: it has a
 * default (<cwd>/files), so it is resolved through lib/utils/uploadPath.js —
 * the single source of truth that routes/uploads.js, lib/file-utils.js and
 * models/File.js all read. Called per request for the same reason as the
 * others, which is also why uploadPath resolves lazily.
 *
 * It was missing from this probe, so a broken upload root reported ready while
 * every local-filesystem ingest failed — after the client had already been
 * told its upload was accepted.
 */
const checkUploadDirectory = () => checkMount("UPLOAD_DIRECTORY", uploadPath());

/** Runs a registered probe, treating a thrown error as a failed check. */
const runExtraCheck = (name, check) =>
  Promise.resolve()
    .then(() => check())
    .then((result) => ({
      name,
      ok: Boolean(result && result.ok),
      detail: (result && result.detail) || "",
    }))
    .catch((err) => ({ name, ok: false, detail: err.message }));

const runReadinessChecks = () =>
  Promise.all([
    Promise.resolve(checkMongo()),
    ...REQUIRED_MOUNTS.map(checkEnvMount),
    checkUploadDirectory(),
    ...Array.from(extraReadinessChecks, ([name, check]) =>
      runExtraCheck(name, check),
    ),
  ]);

/**
 * Liveness probe: "this process is up and answering".
 *
 * Deliberately checks nothing else. A liveness probe that fails when Mongo
 * blips has the supervisor restart a process whose restart cannot help, and
 * takes down the one component that was still working. Dependencies belong to
 * /ready, which is answered by a different question: should traffic come here?
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * Readiness probe: "this process can serve a request end to end".
 *
 * This endpoint used to be conflated with /health, which returned 200
 * unconditionally — including during the window where the listener was open
 * but mongoose.connect() had not resolved (or had failed and was about to exit
 * the process). Every deploy check therefore passed a few milliseconds before
 * the API started answering every route with a 500.
 *
 * The body names each failing check: a 503 that does not say what is wrong
 * sends whoever is paged to read the logs of a process that may not be logging.
 */
app.get("/ready", (req, res) => {
  if (draining) {
    return res.status(503).json({
      status: "not ready",
      failed: ["draining"],
      checks: [{ name: "draining", ok: false, detail: "shutting down" }],
    });
  }

  runReadinessChecks()
    .then((checks) => {
      const failed = checks.filter((check) => !check.ok);

      res.status(failed.length > 0 ? 503 : 200).json({
        status: failed.length > 0 ? "not ready" : "ready",
        failed: failed.map((check) => check.name),
        checks,
      });
    })
    .catch((err) => {
      // Answering 500 here would be read as "the probe is broken" rather than
      // "do not send traffic", which is what an unexpected failure means.
      res.status(503).json({
        status: "not ready",
        failed: ["readiness-check"],
        checks: [{ name: "readiness-check", ok: false, detail: err.message }],
      });
    });
});

app.use(authRoutes);
app.use(projectsRoutes);
app.use(samplesRoutes);
app.use(runRoutes);
app.use(searchRoutes);
app.use(groupRoutes);
app.use(directoryFilesRoutes);
app.use(readFileRoutes);
app.use(userRoutes);
app.use(accessionRoutes);
app.use(newsRoutes);
app.use(optionRoutes);
app.use(uploadRoutes);
app.use(testRoutes);

/**
 * 404 handler. Without this, unknown paths fall through to Express's default
 * handler and return an HTML body, which JSON-only clients cannot parse.
 */
app.use((req, res) => {
  res.status(404).send({
    error: "Not found",
    detail: `Cannot ${req.method} ${req.path}`,
  });
});

/**
 * Terminal error handler.
 *
 * Every response from this API is JSON; Express's built-in handler emits HTML
 * (including a stack trace outside production). This keeps the shape consistent
 * with `handleError` in routes/_utils.js so clients only parse one error format.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  const requestId = generateRequestId();
  console.error(`[${requestId}] Unhandled error on ${req.method} ${req.path}:`, err);

  if (res.headersSent) {
    return next(err);
  }

  if (JWT_ERROR_NAMES.has(err && err.name)) {
    return res.status(401).send({
      error: "Invalid or expired authentication token",
      detail: err.message,
      requestId,
    });
  }

  // body-parser tags payload failures with a status and marks them `type`.
  const status =
    typeof err.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;

  if (status === 500 && process.env.NODE_ENV === "production") {
    return res.status(500).send({
      error: "An internal server error occurred.",
      detail: err.message,
      requestId,
    });
  }

  res.status(status).send({
    error: err.message || "An unexpected error occurred.",
    detail: err.message,
    requestId,
  });
});

module.exports = app;
