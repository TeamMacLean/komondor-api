const express = require("express");
const cors = require("cors");
const _path = require("path");
const { Server, EVENTS } = require("@tus/server");
const { FileStore } = require("@tus/file-store");

const { isAuthenticated } = require("./middleware");
const quota = require("../lib/upload-quota");

const router = express.Router();

const TUS_ROUTE = "/uploads";

// tus writes incoming bytes here and lib/file-utils.js moves them out when a
// project claims the upload, so both must name the same directory — as must
// the permitted-source-root list in models/File.js, or that move is refused.
// All of them now read lib/utils/uploadPath.js rather than each deciding.
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

// Was `origin: "*"`, which let any page on the internet drive an upload with a
// user's credentials. Matches app.js: only the web app may call this API.
const corsOptions = {
  origin: process.env.WEB_APP_URL,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  exposedHeaders: EXPOSED_HEADERS,
};

// The tus server sets Access-Control-Allow-Origin itself, overwriting whatever
// cors() put there, and defaults to "*" when it is not told otherwise.
const ALLOWED_ORIGINS = process.env.WEB_APP_URL
  ? [process.env.WEB_APP_URL]
  : undefined;

/**
 * Builds a tus-protocol error carrying this API's JSON error shape.
 *
 * tus aborts a request by throwing a plain object with `status_code` and
 * `body` — not an Error — and the library's own ERRORS are exactly that, so
 * these are thrown the same way. The body is JSON so clients parse one error
 * format across the whole API rather than two.
 *
 * @param {number} status - The HTTP status to send.
 * @param {string} message - The operator- and client-facing reason.
 * @returns {{status_code: number, body: string}} A throwable tus error.
 */
const uploadError = (status, message) => ({
  status_code: status,
  body: JSON.stringify({ error: message }),
});

/**
 * Extracts the upload id from the request URL, refusing anything that is not
 * one of our own ids.
 *
 * The default implementation hands the last path segment to the datastore,
 * which joins it onto the upload directory. A URL-encoded
 * "..%2F..%2Fetc%2Fpasswd" survives that join as a path outside the directory,
 * and DELETE would unlink whatever it lands on. Every real id comes from
 * Uid.rand(), so anything that is not 32 hex characters is not an upload of
 * ours and gets the same 404 as an id that never existed.
 *
 * @param {object} req - The incoming request.
 * @param {string} [lastPath] - The decoded final path segment.
 * @returns {string|undefined} The upload id, or undefined to 404.
 */
const getFileIdFromRequest = (req, lastPath) =>
  typeof lastPath === "string" && UPLOAD_ID_PATTERN.test(lastPath)
    ? lastPath
    : undefined;

/**
 * The owner recorded when the upload was created.
 *
 * The tus metadata is authoritative because it is written to disk beside the
 * upload and so survives a restart; the in-process register is only consulted
 * as a fallback. Uploads accepted by the old unauthenticated mount have
 * neither, and are refused — see isUploadOwner in lib/upload-quota.js.
 *
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
 *
 * Without this, authenticating the mount would still leave every upload URL
 * usable by any authenticated user who guessed or intercepted it: resuming
 * someone else's upload means appending bytes to a file that will be attached
 * to their project.
 *
 * @param {object} req - The incoming request.
 * @param {object} res - The outgoing response.
 * @param {string} uploadId - The upload the request is addressing.
 * @returns {Promise<void>} Resolves when the request may continue.
 */
const authoriseUploadAccess = async (req, res, uploadId) => {
  // POST is the creation request: the id exists but nothing is stored under it
  // yet, so there is no owner to compare against. onUploadCreate gates that.
  if (req.method === "POST") {
    return;
  }

  const username = req.user && req.user.username;
  const stored = await tusServer.datastore
    .getUpload(uploadId)
    .catch(() => null);

  if (!stored) {
    // Unknown id. Let tus answer with its own 404 rather than distinguishing
    // "not yours" from "does not exist", which would confirm ids by probing.
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

  quota.touchUpload(uploadId);
};

/**
 * Admits or refuses a new upload, and stamps it with its owner.
 *
 * @param {object} req - The incoming request.
 * @param {object} res - The outgoing response.
 * @param {object} upload - The tus Upload about to be created.
 * @returns {Promise<{res: object, metadata: object}>} The response and the
 *   metadata to store with the upload.
 */
const admitUpload = async (req, res, upload) => {
  const username = req.user && req.user.username;

  // Belt and braces: the mount is authenticated, so this cannot normally
  // happen. It exists so a future refactor that loses the guard fails closed.
  if (!username) {
    throw uploadError(401, "Authentication required");
  }

  // tus fixes upload.id before this hook runs, so the slot can be reserved
  // under the real id. checkUploadAllowed registers it as part of admitting
  // it — a separate registerUpload call here is what let 500 simultaneous
  // POSTs all read the same pre-registration usage and all be admitted.
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
  // Must match the mount path below: it is what the Location header is built
  // from, and it is the URL the client sends every subsequent PATCH to.
  path: TUS_ROUTE,
  // @tus/server's BaseHandler.write() builds a lodash.throttle(..., { leading:
  // false }) per PATCH to pace its POST_RECEIVE_V2 event. Trailing-edge only,
  // so the first chunk schedules a timer for the whole interval; nothing
  // cancels or unref()s it when the request ends. At the default of 1000ms
  // every successful chunk therefore pins the event loop open for a further
  // second after the response has gone out.
  //
  // In production that is invisible. Under jest it is not: a worker whose last
  // act was a successful PATCH sits on a live timer past the point jest
  // expects it to exit, and jest prints "A worker process has failed to exit
  // gracefully" and force-kills it. That warning appeared with this branch.
  //
  // Zero is not an option — server.js does `if (!options.postReceiveInterval)`
  // and substitutes 1000 for any falsy value — so this is the smallest value
  // that survives that check. Nothing in this repo listens for
  // POST_RECEIVE_V2, so firing it more often costs an emit with no listeners
  // per millisecond of transfer, and bounds the leftover timer at 1ms.
  postReceiveInterval: 1,
  datastore: new FileStore({ directory: uploadPath() }),
  allowedOrigins: ALLOWED_ORIGINS,
  getFileIdFromRequest,
  // Read per request rather than captured at construction, so the ceiling tus
  // enforces and the one the quota checks against can never drift apart.
  maxSize: () => quota.getLimits().maxUploadBytes,
  // A protocol-relative Location, as the previous server produced. The default
  // is absolute and assumes http://, which behind the nginx TLS terminator
  // hands an https page an http:// upload URL that the browser then blocks as
  // mixed content. Deriving the scheme from X-Forwarded-Proto instead would
  // mean trusting a header the client can set.
  generateUrl: (req, { host, path, id }) => `//${host}${path}/${id}`,
  onIncomingRequest: authoriseUploadAccess,
  onUploadCreate: admitUpload,
  onUploadFinish: async (req, res, upload) => {
    // The bytes are on disk and no longer in flight; the file itself stays
    // until a project claims it (lib/file-utils.js) or the abandoned-upload
    // sweep removes it.
    quota.releaseUpload(upload.id);
    return res;
  },
});

tusServer.on(EVENTS.POST_TERMINATE, (req, res, id) => {
  quota.releaseUpload(id);
});

/**
 * Authentication for the tus mount.
 *
 * OPTIONS is exempt: it is the CORS preflight, which browsers send without
 * credentials, so refusing it would break every upload from the web app before
 * the authenticated request was ever sent. It is answered by the cors()
 * middleware below and never reaches the tus handler, so nothing is written.
 *
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

// Advertised on every response, including the preflight. tus normally puts
// Tus-Max-Size on its own OPTIONS response, but cors() answers the preflight
// before the tus handler sees it, and a client that cannot discover the limit
// finds out by uploading 50 GB and being refused at the end.
uploadApp.use((req, res, next) => {
  res.setHeader("Tus-Max-Size", String(quota.getLimits().maxUploadBytes));
  next();
});

uploadApp.use(cors(corsOptions));
uploadApp.all("*", requireUploadAuth, (req, res) => {
  // handle() answers protocol errors itself. An escaped rejection would reach
  // the process-wide unhandledRejection handler in server.js, which shuts the
  // API down — one malformed upload request must not do that.
  tusServer.handle(req, res).catch((err) => {
    console.error(`[UPLOAD] Unhandled tus failure on ${req.method}:`, err);

    if (!res.headersSent) {
      res.status(500).send({ error: "Upload failed" });
    }
  });
});

// Guarded in both places deliberately. The mount is the gate that closes the
// hole; the guard inside uploadApp is what stops a later refactor that mounts
// the app somewhere else from quietly reopening it.
router.use(TUS_ROUTE, requireUploadAuth, uploadApp);

/**
 * Cancels an upload the caller owns.
 *
 * Posting no uploadId keeps the endpoint's previous do-nothing behaviour, which
 * the web app relies on when it closes the upload dialog without having started
 * anything.
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
