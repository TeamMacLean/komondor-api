const express = require("express");
const cors = require("cors");
const _path = require("path");
const { Server, EVENTS, TUS_VERSION } = require("@tus/server");
const { FileStore } = require("@tus/file-store");

const { isAuthenticated } = require("./middleware");
const quota = require("../lib/upload-quota");

const router = express.Router();

const TUS_ROUTE = "/uploads";

// Shared with lib/file-utils.js and models/File.js; all three must name the
// same directory or a claimed upload cannot be moved out of it.
const { uploadPath } = require("../lib/utils/uploadPath");

// Upload ids are Uid.rand(): 16 random bytes as hex.
const UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/;

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

// Not `origin: "*"`: that let any page on the internet drive an upload with a
// user's credentials.
const corsOptions = {
  origin: process.env.WEB_APP_URL,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  exposedHeaders: EXPOSED_HEADERS,
};

// tus sets Access-Control-Allow-Origin itself, overwriting cors(), and
// defaults to "*" unless told otherwise.
const ALLOWED_ORIGINS = process.env.WEB_APP_URL
  ? [process.env.WEB_APP_URL]
  : undefined;

/**
 * Builds a tus-protocol error carrying this API's JSON error shape. tus aborts
 * a request by throwing a plain object with `status_code` and `body`, not an
 * Error, so these are thrown rather than returned.
 * @param {number} status - The HTTP status to send.
 * @param {string} message - The client-facing reason.
 * @returns {{status_code: number, body: string}} A throwable tus error.
 */
const uploadError = (status, message) => ({
  status_code: status,
  body: JSON.stringify({ error: message }),
});

/**
 * Extracts the upload id from the request URL, refusing anything that is not
 * one of our own ids: the default implementation joins the last path segment
 * onto the upload directory, so an encoded "..%2F.." would escape it.
 * @param {object} req - The incoming request.
 * @param {string} [lastPath] - The decoded final path segment.
 * @returns {string|undefined} The upload id, or undefined to 404.
 */
const getFileIdFromRequest = (req, lastPath) =>
  typeof lastPath === "string" && UPLOAD_ID_PATTERN.test(lastPath)
    ? lastPath
    : undefined;

/**
 * The owner recorded when the upload was created. The tus metadata is
 * authoritative because it is on disk and survives a restart; the in-process
 * register is only a fallback.
 * @param {object|null} stored - The Upload as the datastore has it.
 * @param {string} uploadId - The tus upload id.
 * @returns {string|null} The owner's username, or null if unknown.
 */
const ownerOf = (stored, uploadId) => {
  if (stored && stored.metadata && stored.metadata.owner) {
    return stored.metadata.owner;
  }

  const record = quota.getUploadRecord(uploadId);

  return record ? record.username : null;
};

/**
 * Refuses a request that names an upload belonging to somebody else.
 * Authenticating the mount is not enough on its own: an upload URL is
 * otherwise usable by any authenticated user who obtains it.
 * @param {object} req - The incoming request.
 * @param {object} res - The outgoing response.
 * @param {string} uploadId - The upload the request is addressing.
 * @returns {Promise<void>} Resolves when the request may continue.
 */
const authoriseUploadAccess = async (req, res, uploadId) => {
  // POST is the creation request: no owner is stored yet to compare against,
  // so onUploadCreate gates it instead.
  if (req.method === "POST") {
    return;
  }

  const username = req.user && req.user.username;
  const stored = await tusServer.datastore
    .getUpload(uploadId)
    .catch(() => null);

  if (!stored) {
    // Let tus answer 404: distinguishing "not yours" from "does not exist"
    // would confirm ids by probing.
    return;
  }

  if (!quota.isUploadOwner(ownerOf(stored, uploadId), username)) {
    console.warn(
      `[UPLOAD] Refused ${req.method} on upload ${uploadId} to "${username}"`,
    );
    throw uploadError(
      403,
      `User '${username}' does not have permission to access this upload`,
    );
  }

  // touchUpload reports whether a reservation was actually found. A paused
  // upload can outlive its reservation (idle-pruned, or a restart that raced
  // recovery), and the PATCH that follows would then write bytes nothing
  // accounted for. Re-admit before any of them land — if the user is genuinely
  // over quota now, refusing the resume is the correct answer.
  if (!quota.touchUpload(uploadId)) {
    const decision = await quota.checkUploadAllowed({
      id: uploadId,
      username,
      size: stored.size,
      directory: uploadPath(),
    });

    if (!decision.allowed) {
      console.warn(
        `[UPLOAD] Refused to re-admit resumed upload ${uploadId} for "${username}": ${decision.error}`,
      );
      throw uploadError(decision.status, decision.error);
    }
  }
};

/**
 * Admits or refuses a new upload, and stamps it with its owner.
 * @param {object} req - The incoming request.
 * @param {object} res - The outgoing response.
 * @param {object} upload - The tus Upload about to be created.
 * @returns {Promise<{res: object, metadata: object}>} The response and the
 *   metadata to store with the upload.
 */
const admitUpload = async (req, res, upload) => {
  const username = req.user && req.user.username;

  // Unreachable today; here so a refactor losing the mount's guard fails closed.
  if (!username) {
    throw uploadError(401, "Authentication required");
  }

  // A request landing before the disk scan finishes must still see whatever
  // it recovers, or it is admitted against a register that reads as empty.
  await uploadRecovery;

  // checkUploadAllowed registers the upload as part of admitting it; do not
  // add a registerUpload call here.
  const decision = await quota.checkUploadAllowed({
    id: upload.id,
    username,
    size: upload.size,
    directory: uploadPath(),
  });

  if (!decision.allowed) {
    console.warn(
      `[UPLOAD] Refused new upload for "${username}": ${decision.error}`,
    );
    throw uploadError(decision.status, decision.error);
  }

  return { res, metadata: { ...upload.metadata, owner: username } };
};

const tusServer = new Server({
  // Must match the mount path below: the Location header is built from it.
  path: TUS_ROUTE,
  // Not 0: tus substitutes 1000 for any falsy value. Tiny because tus leaves
  // an uncancelled throttle timer per PATCH that outlives the response.
  postReceiveInterval: 1,
  datastore: new FileStore({ directory: uploadPath() }),
  allowedOrigins: ALLOWED_ORIGINS,
  getFileIdFromRequest,
  // Read per request so tus's ceiling and the quota's cannot drift apart.
  maxSize: () => quota.getLimits().maxUploadBytes,
  // Protocol-relative: the default assumes http://, which behind the nginx TLS
  // terminator gives an https page a URL the browser blocks as mixed content.
  generateUrl: (req, { host, path, id }) => `//${host}${path}/${id}`,
  onIncomingRequest: authoriseUploadAccess,
  onUploadCreate: admitUpload,
  onUploadFinish: async (req, res, upload) => {
    // No longer in flight; the file stays until claimed or swept.
    quota.releaseUpload(upload.id);
    return res;
  },
});

tusServer.on(EVENTS.POST_TERMINATE, (req, res, id) => {
  quota.releaseUpload(id);
});

// Rebuilds the reservation register from disk, mirroring ingest-queue.js's
// recoverStaleJobs: a restart drops the in-memory map, but the tus sidecars
// on disk still record every upload nobody finished. admitUpload awaits this
// so a request arriving right after a restart is charged against the old
// process's reservations, not zero.
const uploadRecovery = quota
  .recoverUploadReservations(uploadPath())
  .then((count) => {
    if (count > 0) {
      console.log(
        `[UPLOAD] Reserved ${count} in-flight upload(s) found on disk after a restart`,
      );
    }
    return count;
  })
  .catch((err) => {
    console.error("[UPLOAD] Startup reservation recovery failed:", err);
    return 0;
  });

/**
 * Authentication for the tus mount. OPTIONS is exempt because browsers send
 * the CORS preflight without credentials; cors() answers it below, so it never
 * reaches the tus handler.
 * @param {object} req - The incoming request.
 * @param {object} res - The outgoing response.
 * @param {Function} next - The next middleware.
 * @returns {void}
 */
const requireUploadAuth = (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  return isAuthenticated(req, res, next);
};

const uploadApp = express();

// Set here rather than left to tus: cors() answers the preflight below and
// ends the request, so tus's own OptionsHandler never runs on a preflight and
// none of what it would advertise reaches the client. An audit found the
// whole application returning a preflight with no tus capabilities at all.
//
// Every value is sourced, not hard-coded — the extension list comes from the
// datastore the server is actually built on, and the version from the
// library's own constant — so this cannot drift into advertising support for
// something the installed @tus/server does not do. Mirrors what
// @tus/server's OptionsHandler sets, deliberately.
uploadApp.use((req, res, next) => {
  res.setHeader("Tus-Max-Size", String(quota.getLimits().maxUploadBytes));
  res.setHeader("Tus-Version", TUS_VERSION.join(","));
  const extensions = tusServer.datastore.extensions;
  if (Array.isArray(extensions) && extensions.length > 0) {
    res.setHeader("Tus-Extension", extensions.join(","));
  }
  next();
});

uploadApp.use(cors(corsOptions));
uploadApp.all("*", requireUploadAuth, (req, res) => {
  // An escaped rejection would reach server.js's unhandledRejection handler,
  // which shuts the API down.
  tusServer.handle(req, res).catch((err) => {
    console.error(`[UPLOAD] Unhandled tus failure on ${req.method}:`, err);

    if (!res.headersSent) {
      res.status(500).send({ error: "Upload failed" });
    }
  });
});

// Guarded here and inside uploadApp, so mounting the app elsewhere cannot
// quietly drop authentication.
router.use(TUS_ROUTE, requireUploadAuth, uploadApp);

/**
 * Cancels an upload the caller owns. Posting no uploadId is a no-op: the web
 * app relies on that when the upload dialog is closed without starting one.
 */
router
  .route("/upload/cancel")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const uploadId = req.body && req.body.uploadId;

    if (!uploadId) {
      return res.status(200).send({});
    }

    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      return res.status(400).send({ error: "Invalid upload id" });
    }

    const stored = await tusServer.datastore
      .getUpload(uploadId)
      .catch(() => null);
    const record = quota.getUploadRecord(uploadId);

    if (!stored && !record) {
      return res.status(404).send({ error: "Upload not found" });
    }

    if (!quota.isUploadOwner(ownerOf(stored, uploadId), req.user.username)) {
      console.warn(
        `[UPLOAD] Refused cancel of upload ${uploadId} to "${req.user.username}"`,
      );
      return res.status(403).send({
        error: `User '${req.user.username}' does not have permission to cancel this upload`,
      });
    }

    quota.releaseUpload(uploadId);

    if (stored) {
      try {
        await tusServer.datastore.remove(uploadId);
      } catch (err) {
        console.error(`[UPLOAD] Could not remove upload ${uploadId}:`, err);
        return res.status(500).send({ error: "Could not cancel this upload" });
      }
    }

    return res.status(200).send({});
  });

module.exports = router;
