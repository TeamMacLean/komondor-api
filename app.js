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

const globalCors = cors(corsOptions);

// The /uploads mount runs its own cors(), plus a middleware advertising the
// tus capability headers (Tus-Max-Size and friends). This one, mounted first,
// ANSWERS the OPTIONS preflight and ends the request — so an OPTIONS to
// /uploads returned 200 with the right origin and no tus headers at all, and
// the router's own capability middleware never ran. The router's test suite
// mounts the router alone, so its topology could not show this.
//
// The fix is `preflightContinue`, not a skip. Skipping CORS for /uploads
// entirely looks equivalent and is not: routes/uploads.js guards the mount
// with `router.use(TUS_ROUTE, requireUploadAuth, uploadApp)`, so an
// unauthenticated request is answered 401 BEFORE reaching uploadApp's own
// cors() — and with the global one skipped, that 401 carried no CORS headers
// at all. A JWT expiring mid-upload would then show the browser an opaque
// CORS failure instead of "Authentication required", which the web app
// cannot tell apart from the network dying. Setting the headers and letting
// the preflight through gives both halves.
const uploadsCors = cors({ ...corsOptions, preflightContinue: true });

// Case-insensitively: Express routes case-insensitively by default, so
// /Uploads reaches the tus mount. A case-sensitive predicate here would send
// it down the wrong branch — the same bug this fixes, one capital letter away.
const isUploadPath = (path) => {
  const lower = String(path).toLowerCase();
  return lower === "/uploads" || lower.startsWith("/uploads/");
};

app.use((req, res, next) =>
  isUploadPath(req.path)
    ? uploadsCors(req, res, next)
    : globalCors(req, res, next),
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

/**
 * Attaches req.user when the request carries a valid bearer token.
 * A malformed or expired token is answered 401, not passed to next() as a 500.
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
const MONGO_READY_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

// Mounts every write path depends on, read at request time so a probe sees the
// current state of the disk rather than a snapshot from boot.
const REQUIRED_MOUNTS = ["DATASTORE_ROOT", "HPC_TRANSFER_DIRECTORY"];

// Set by server.js at the start of a shutdown, so a load balancer polling
// /ready stops sending work before the listener closes underneath it.
let draining = false;

// Dependencies only server.js knows about (the ingest worker, today).
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
 * Reports whether a mount is present and writable. The path is deliberately not
 * echoed back into the response: /ready is unauthenticated.
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
 * Reports whether the tus upload staging directory is usable. Separate from
 * REQUIRED_MOUNTS because it has a default, so it is resolved through
 * lib/utils/uploadPath.js — the path every other module actually uses.
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
 * Liveness probe: "this process is up and answering", and deliberately nothing
 * else — a liveness check that fails when Mongo blips gets the process
 * restarted, which cannot help. Dependencies belong to /ready.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * Readiness probe: "this process can serve a request end to end". The body
 * names each failing check, so a 503 says which dependency is at fault.
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
      // 503, not 500: an unexpected failure still means "do not send traffic".
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
 * 404 handler: Express's default returns HTML, which JSON-only clients cannot parse.
 */
app.use((req, res) => {
  res.status(404).send({
    error: "Not found",
    detail: `Cannot ${req.method} ${req.path}`,
  });
});

/**
 * Terminal error handler. Express's built-in one emits HTML; this keeps the JSON
 * shape consistent with `handleError` in routes/_utils.js.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  const requestId = generateRequestId();
  console.error(
    `[${requestId}] Unhandled error on ${req.method} ${req.path}:`,
    err,
  );

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
