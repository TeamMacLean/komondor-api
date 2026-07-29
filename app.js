const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

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

// Health check endpoint for monitoring and test automation
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
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
