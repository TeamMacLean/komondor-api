/**
 * Admission control and bookkeeping for resumable (tus) uploads: per-upload
 * size, per-user concurrency and in-flight bytes, and free space on the volume.
 * Limits are read from the environment per call.
 *
 * The register is per-process, in memory, and accounting only — ownership
 * lives in the upload's tus metadata on disk. ecosystem.config.js must pin a
 * single instance or the per-user caps multiply by the instance count.
 */

const fs = require("fs").promises;
const _path = require("path");

const GIB = 1024 * 1024 * 1024;

// A tus id is Uid.rand(): 16 random bytes as hex. The sweep only deletes
// entries matching this, so an operator's stray file is reported, not removed.
const UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/;

// tus writes '<id>.json' beside every blob. Matched separately from the blob
// so the sweep can find a sidecar whose blob is gone.
const UPLOAD_SIDECAR_PATTERN = /^([0-9a-f]{32})\.json$/;

/**
 * Reads a non-negative numeric setting from the environment. A malformed value
 * falls back to the default, not to 0, which would refuse every upload.
 * @param {string} name - Environment variable to read.
 * @param {number} fallback - Value to use when unset or unusable.
 * @returns {number} The configured value.
 */
const numericEnv = (name, fallback) => {
  const raw = process.env[name];

  if (raw === undefined || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    console.warn(
      `[UPLOAD] Ignoring ${name}="${raw}": not a non-negative number. Using ${fallback}.`,
    );
    return fallback;
  }

  return value;
};

/**
 * The upload limits currently in force. Defaults are generous on purpose: a
 * single sequencing read set is routinely tens of gigabytes.
 * @returns {{maxUploadBytes: number, maxConcurrentPerUser: number,
 *   maxInflightBytesPerUser: number, minFreeBytes: number, idleMs: number,
 *   abandonedMs: number}} The limits, in bytes and milliseconds.
 */
const getLimits = () => ({
  maxUploadBytes: numericEnv("UPLOAD_MAX_BYTES", 50 * GIB),
  maxConcurrentPerUser: numericEnv("UPLOAD_MAX_CONCURRENT_PER_USER", 10),
  maxInflightBytesPerUser: numericEnv(
    "UPLOAD_MAX_INFLIGHT_BYTES_PER_USER",
    200 * GIB,
  ),
  minFreeBytes: numericEnv("UPLOAD_MIN_FREE_BYTES", 5 * GIB),
  idleMs: numericEnv("UPLOAD_IDLE_MINUTES", 60) * 60 * 1000,
  abandonedMs: numericEnv("UPLOAD_ABANDONED_HOURS", 48) * 60 * 60 * 1000,
});

/**
 * @type {Map<string, {id: string, username: string, size: number|null,
 *   chargeableBytes: number, createdAt: number, updatedAt: number}>}
 */
const uploads = new Map();

// Upload ids with an HTTP request currently open against them. Reference
// counted, not a plain set: a resumed upload can briefly overlap its own
// previous request, and a naive delete on the first response to close would
// then unprotect a transfer that is still running.
//
// Liveness, not accounting — nothing here is charged or persisted. It exists
// only so pruneIdleUploads can tell "nobody has touched this in an hour" from
// "this is streaming right now", which a timestamp stamped at request start
// cannot express.
const activeRequests = new Map();

/**
 * Marks an upload as having a request in flight, exempting it from idle
 * pruning until the matching endRequest.
 * @param {string} id - The tus upload id.
 * @returns {void}
 */
const beginRequest = (id) => {
  if (!id) {
    return;
  }
  activeRequests.set(id, (activeRequests.get(id) || 0) + 1);
};

/**
 * Releases one in-flight request against an upload.
 * @param {string} id - The tus upload id.
 * @returns {void}
 */
const endRequest = (id) => {
  if (!id) {
    return;
  }
  const open = activeRequests.get(id);
  if (open === undefined) {
    return;
  }
  if (open <= 1) {
    activeRequests.delete(id);
    return;
  }
  activeRequests.set(id, open - 1);
};

/**
 * Whether an upload currently has a request in flight.
 * @param {string} id - The tus upload id.
 * @returns {boolean}
 */
const hasActiveRequest = (id) => activeRequests.has(id);

/**
 * What an upload counts for against the per-user byte cap. One that declares
 * no length is charged the full maximum: charging it zero would make
 * Upload-Defer-Length a way to bypass the cap.
 * @param {number|null|undefined} size - Declared Upload-Length, if any.
 * @param {number} maxUploadBytes - Per-upload ceiling.
 * @returns {number} Bytes to charge to the user's in-flight total.
 */
const chargeableBytesFor = (size, maxUploadBytes) =>
  Number.isFinite(size) && size >= 0 ? size : maxUploadBytes;

/**
 * Forgets registrations idle for longer than the idle window, so a client that
 * vanished mid-upload does not hold its slot forever. The bytes it left on
 * disk are {@link cleanupAbandonedUploads}'s problem.
 * @param {number} [now] - Current epoch ms; injectable for tests.
 * @returns {string[]} The ids that were dropped.
 */
const pruneIdleUploads = (now = Date.now()) => {
  const { idleMs } = getLimits();
  const dropped = [];

  for (const [id, record] of uploads) {
    // An upload with a request in flight is not idle, whatever its timestamp
    // says. `updatedAt` is stamped once when a request arrives, so a single
    // PATCH streaming a large file goes an unbounded time without another
    // touch — with UPLOAD_MAX_BYTES at 50 GiB, one PATCH running past the
    // 60-minute idle window is ordinary here, not an edge case. An audit
    // reproduced the consequence: the active upload was pruned, its
    // reservation vanished, and the next admission was let through against a
    // free-space floor computed without it — two 700-byte uploads admitted
    // against 1,100 bytes free with a 100-byte floor, ending at -300.
    //
    // A periodic touch was the obvious fix and does not work: @tus/server
    // emits POST_RECEIVE only after the PATCH body finishes, and
    // POST_RECEIVE_V2 stops firing while a request is paused mid-transfer.
    // Liveness has to come from the request itself, so the mount marks an
    // upload active for exactly as long as its response is open.
    if (activeRequests.has(id)) {
      continue;
    }
    if (now - record.updatedAt >= idleMs) {
      uploads.delete(id);
      dropped.push(id);
    }
  }

  return dropped;
};

/**
 * What a user currently has in flight.
 * @param {string} username - The owner to total up.
 * @returns {{count: number, bytes: number}} Open uploads and bytes charged.
 */
const getUserUsage = (username) => {
  let count = 0;
  let bytes = 0;

  for (const record of uploads.values()) {
    if (record.username === username) {
      count += 1;
      bytes += record.chargeableBytes;
    }
  }

  return { count, bytes };
};

/**
 * Free bytes on the volume holding `directory`. Returns null when the platform
 * cannot say, which callers treat as "no opinion" rather than "no space".
 * @param {string} directory - Any path on the volume of interest.
 * @returns {Promise<number|null>} Free bytes, or null if unmeasurable.
 */
const getFreeBytes = async (directory) => {
  if (typeof fs.statfs !== "function") {
    return null;
  }

  try {
    const stats = await fs.statfs(directory);
    return stats.bsize * stats.bavail;
  } catch (err) {
    console.warn(
      `[UPLOAD] Could not measure free space on ${directory}: ${err.message}`,
    );
    return null;
  }
};

/**
 * Decides whether a new upload may start, and reserves its slot if so. The
 * reservation is taken synchronously, before any await: an await between
 * reading the usage and writing it lets concurrent POSTs all read the same
 * total and all be admitted.
 * @param {object} params - The request being admitted.
 * @param {string} params.id - The tus upload id to reserve the slot under.
 * @param {string} params.username - The authenticated owner.
 * @param {number|null} [params.size] - Declared Upload-Length, if any.
 * @param {string} params.directory - Upload directory, for the disk check.
 * @param {number} [params.now] - Current epoch ms; injectable for tests.
 * @returns {Promise<{allowed: boolean, status?: number, error?: string}>} When
 *   allowed, the upload is already registered: do not register it again, and
 *   release it if it then fails to start.
 */
const checkUploadAllowed = async ({ id, username, size, directory, now }) => {
  const limits = getLimits();

  if (typeof username !== "string" || username === "") {
    return { allowed: false, status: 401, error: "Authentication required" };
  }

  if (typeof id !== "string" || id === "") {
    // Nothing to reserve the slot under, so refuse rather than admit unreserved.
    console.error("[UPLOAD] Refusing an admission request with no upload id");
    return { allowed: false, status: 500, error: "Upload id is required" };
  }

  if (Number.isFinite(size) && size > limits.maxUploadBytes) {
    return {
      allowed: false,
      status: 413,
      error: `Upload of ${size} bytes exceeds the maximum upload size of ${limits.maxUploadBytes} bytes`,
    };
  }

  // Dropped first so a dead slot cannot hold a user out of their own quota.
  pruneIdleUploads(now === undefined ? Date.now() : now);

  // --- Critical section: nothing below may await until the reservation is
  // stored, or a concurrent request reads a stale usage total. ---
  const usage = getUserUsage(username);

  if (usage.count + 1 > limits.maxConcurrentPerUser) {
    return {
      allowed: false,
      status: 429,
      error: `User '${username}' already has ${usage.count} uploads in progress (limit ${limits.maxConcurrentPerUser})`,
    };
  }

  const charge = chargeableBytesFor(size, limits.maxUploadBytes);

  if (usage.bytes + charge > limits.maxInflightBytesPerUser) {
    return {
      allowed: false,
      status: 429,
      error: `User '${username}' would have ${usage.bytes + charge} bytes of uploads in progress (limit ${limits.maxInflightBytesPerUser})`,
    };
  }

  registerUpload({ id, username, size, now });
  // --- End of critical section. ---

  const free = await getFreeBytes(directory);

  if (free !== null) {
    // Every OTHER not-yet-completed upload's reservation counts as already
    // spent: two requests that each pass this check alone, reading the same
    // real free bytes, can still overrun the disk once both actually write.
    const reservedByOthers = Array.from(uploads.values())
      .filter((record) => record.id !== id)
      .reduce((sum, record) => sum + record.chargeableBytes, 0);

    // Charged the same conservative amount as the per-user cap above: an
    // upload of unknown length could consume up to maxUploadBytes, and
    // charging it zero let a deferred-length upload walk the disk past the
    // floor. If that refuses uploads on a small volume, UPLOAD_MAX_BYTES is
    // set larger than the volume can serve, which is worth surfacing.
    const projected = free - reservedByOthers - charge;

    if (projected < limits.minFreeBytes) {
      releaseUpload(id);

      return {
        allowed: false,
        status: 507,
        error: `Not enough free space for this upload: ${free} bytes free, ${limits.minFreeBytes} must remain available`,
      };
    }
  }

  return { allowed: true };
};

/**
 * Records an upload as in progress and notes who owns it. Normally reached
 * through {@link checkUploadAllowed}; calling it directly after a separate
 * admission check reopens the concurrency gap.
 * @param {object} params - The upload being registered.
 * @param {string} params.id - The tus upload id.
 * @param {string} params.username - The owner.
 * @param {number|null} [params.size] - Declared Upload-Length, if any.
 * @param {number} [params.now] - Current epoch ms; injectable for tests.
 * @returns {object} The stored record.
 */
const registerUpload = ({ id, username, size, now = Date.now() }) => {
  const { maxUploadBytes } = getLimits();

  const record = {
    id,
    username,
    size: Number.isFinite(size) ? size : null,
    chargeableBytes: chargeableBytesFor(size, maxUploadBytes),
    createdAt: now,
    updatedAt: now,
  };

  uploads.set(id, record);

  return record;
};

/**
 * Marks an upload as still alive, so the idle sweep leaves it be.
 * @param {string} id - The tus upload id.
 * @param {number} [now] - Current epoch ms; injectable for tests.
 * @returns {boolean} Whether a record was found to touch.
 */
const touchUpload = (id, now = Date.now()) => {
  const record = uploads.get(id);

  if (!record) {
    return false;
  }

  record.updatedAt = now;

  return true;
};

/**
 * Releases an upload's quota slot. Safe to call with an unknown id so callers
 * can put it in a `finally` without further guarding.
 * @param {string} id - The tus upload id.
 * @returns {boolean} Whether a record was actually removed.
 */
const releaseUpload = (id) => uploads.delete(id);

/**
 * @param {string} id - The tus upload id.
 * @returns {object|undefined} The registration, if this process still has one.
 */
const getUploadRecord = (id) => uploads.get(id);

/** @returns {object[]} Every registration currently held. */
const listUploads = () => Array.from(uploads.values());

/**
 * Whether `username` may resume, inspect or cancel an upload owned by `owner`.
 * Fails closed on an unknown owner: an upload with no recorded owner must not
 * be adoptable. Not widened for admins.
 * @param {string|null|undefined} owner - The owner recorded at creation.
 * @param {string|null|undefined} username - The authenticated caller.
 * @returns {boolean} True only if the caller owns the upload.
 */
const isUploadOwner = (owner, username) =>
  typeof owner === "string" &&
  owner !== "" &&
  typeof username === "string" &&
  owner === username;

/** Test helper: forgets every registration. */
const clearUploads = () => {
  uploads.clear();
};

/**
 * Reads the tus sidecar written next to an upload, if there is one.
 * @param {string} directory - The upload directory.
 * @param {string} id - The tus upload id.
 * @returns {Promise<object|null>} The parsed Upload, or null if unreadable.
 */
const readUploadInfo = async (directory, id) => {
  try {
    const raw = await fs.readFile(_path.join(directory, `${id}.json`), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
};

/**
 * The real state of a staged upload: the sidecar's DECLARED size, and the bytes
 * actually on disk.
 *
 * The sidecar's own `offset` is not usable. @tus/file-store writes `offset: 0`
 * at creation and never updates it — PATCH appends to the blob, and
 * getUpload() derives the true offset from stat(blob).size. Verified against a
 * real POST+PATCH: a fully uploaded 4-byte file leaves {size:4, offset:0} on
 * disk. Reading the sidecar's offset therefore reports every completed upload
 * as 0-of-N, which previously rejected legitimate claims and made finished
 * uploads eligible for the abandoned sweep.
 *
 * @param {string} directory - The upload staging directory.
 * @param {string} id - The tus upload id.
 * @returns {Promise<object|null>} State, or null when there is no sidecar.
 */
const readUploadState = async (directory, id) => {
  const info = await readUploadInfo(directory, id);

  if (!info) {
    return null;
  }

  // A deferred-length upload that never received a final Upload-Length has no
  // target to be complete against.
  const size = Number.isFinite(info.size) ? info.size : null;

  let bytesOnDisk = null;
  try {
    bytesOnDisk = (await fs.stat(_path.join(directory, id))).size;
  } catch (err) {
    bytesOnDisk = null;
  }

  const owner = info.metadata && info.metadata.owner;

  return {
    id,
    size,
    bytesOnDisk,
    owner: typeof owner === "string" && owner !== "" ? owner : null,
    metadata: info.metadata || {},
    blobMissing: bytesOnDisk === null,
    complete: size !== null && bytesOnDisk !== null && bytesOnDisk === size,
  };
};

/**
 * Who a finished upload belongs to, as recorded on disk. The in-process
 * register is dropped as soon as the last byte lands, so by the time a project
 * claims an upload the sidecar is usually the only record left.
 * @param {string} directory - The upload staging directory.
 * @param {string} id - The tus upload id.
 * @returns {Promise<string|null>} The owner's username, or null if unknown.
 */
const getRecordedOwner = async (directory, id) => {
  const info = await readUploadInfo(directory, id);
  const owner = info && info.metadata && info.metadata.owner;

  if (typeof owner === "string" && owner !== "") {
    return owner;
  }

  const record = uploads.get(id);

  return record ? record.username : null;
};

/**
 * Confirms an upload is genuinely finished before it is claimed as a file.
 * Ownership (isUploadOwner/getRecordedOwner) proves WHO an upload belongs to,
 * not whether it is actually done — without this, a caller could link a
 * 1%-uploaded blob into a project as if it were the whole file.
 * @param {string} directory - The upload staging directory.
 * @param {string} id - The tus upload id.
 * @returns {Promise<void>} Resolves silently when the upload is complete.
 * @throws {Error} If the sidecar is missing, declares itself unfinished
 *   (including a deferred-length upload that never got a final size), or the
 *   blob actually on disk does not match the declared size.
 */
const assertUploadComplete = async (directory, id) => {
  const state = await readUploadState(directory, id);

  if (!state) {
    throw new Error(`Upload ${id} has no upload record in ${directory}`);
  }

  if (state.blobMissing) {
    throw new Error(`Upload ${id} has no blob on disk in ${directory}`);
  }

  if (state.size === null) {
    throw new Error(
      `Upload ${id} never received a final Upload-Length, so it cannot be complete`,
    );
  }

  if (!state.complete) {
    throw new Error(
      `Upload ${id} is not complete: ${state.bytesOnDisk} of ${state.size} bytes on disk`,
    );
  }
};

/**
 * Rebuilds the in-memory reservation register from disk after a restart, so a
 * user who had uploads in progress cannot immediately open that many more.
 * Mirrors ingest-queue.js's recoverStaleJobs: the register is per-process and
 * in memory, but the tus sidecars on disk are the durable source of truth.
 * @param {string} directory - The upload staging directory.
 * @returns {Promise<number>} How many uploads were re-registered.
 */
const recoverUploadReservations = async (directory) => {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (err) {
    console.warn(
      `[UPLOAD] Could not scan ${directory} for in-flight uploads: ${err.message}`,
    );
    return 0;
  }

  const ids = entries
    .filter((entry) => entry.isFile())
    .map((entry) => UPLOAD_SIDECAR_PATTERN.exec(entry.name))
    .filter((match) => match !== null)
    .map((match) => match[1]);

  let recovered = 0;

  for (const id of ids) {
    // Reuses assertUploadComplete's predicate rather than a second copy of
    // it: a genuinely finished upload throws nothing, so it is skipped here.
    try {
      await assertUploadComplete(directory, id);
      continue;
    } catch (err) {
      // Falls through: not complete, so its slot needs reserving.
    }

    const state = await readUploadState(directory, id);

    if (!state || !state.owner) {
      // Nothing to charge the reservation to; the abandoned-upload sweep
      // will eventually clear a blob left by the old unauthenticated mount.
      continue;
    }

    registerUpload({ id, username: state.owner, size: state.size });
    recovered += 1;
  }

  return recovered;
};

/**
 * Sweeps uploads that were started and never finished. A completed upload is
 * reported, not deleted: it is a file the user uploaded and has not yet
 * attached to a project.
 * @param {object} params - What to sweep.
 * @param {string} params.directory - The upload directory.
 * @param {number} [params.now] - Current epoch ms; injectable for tests.
 * @param {boolean} [params.includeCompleted] - Also delete finished uploads.
 * @param {boolean} [params.includeOrphans] - Also delete blobs with no sidecar.
 * @returns {Promise<{removed: string[], completed: string[], orphans: string[],
 *   sidecars: string[], errors: Array<{id: string, error: string}>}>} What was
 *   removed and what was left for an operator.
 */
const cleanupAbandonedUploads = async ({
  directory,
  now = Date.now(),
  includeCompleted = false,
  includeOrphans = false,
}) => {
  const { abandonedMs } = getLimits();
  const result = {
    removed: [],
    completed: [],
    orphans: [],
    sidecars: [],
    errors: [],
  };

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (err) {
    result.errors.push({ id: directory, error: err.message });
    return result;
  }

  const files = entries.filter((entry) => entry.isFile());
  const blobs = new Set(
    files
      .map((entry) => entry.name)
      .filter((name) => UPLOAD_ID_PATTERN.test(name)),
  );

  // A sidecar whose blob is still here is handled with that blob below; only
  // widowed ones are swept separately.
  const widowedSidecars = files
    .map((entry) => UPLOAD_SIDECAR_PATTERN.exec(entry.name))
    .filter((match) => match !== null && !blobs.has(match[1]));

  const candidates = Array.from(blobs);

  for (const id of candidates) {
    const blobPath = _path.join(directory, id);

    try {
      const stats = await fs.stat(blobPath);

      // Blob mtime alone is not "last activity": it only moves when bytes
      // actually land, but a resumed request can be authorised, holding a
      // fresh registration, and still be waiting on a slow client before its
      // first PATCH byte writes. Reproduced by execution: a 49-hour-idle blob
      // (mtime older than the default 48h abandonedMs) resumed and paused
      // mid-body — the sweep saw only the stale mtime and deleted the blob
      // out from under the live request, which then reported success on a
      // write that landed in a file no longer linked to any name. The
      // registration's updatedAt (bumped by touchUpload at the start of every
      // authorised request — see routes/uploads.js authoriseUploadAccess) is
      // taken as activity too; the more recent of the two decides.
      const record = getUploadRecord(id);
      const lastActivity = record
        ? Math.max(stats.mtimeMs, record.updatedAt)
        : stats.mtimeMs;

      if (now - lastActivity < abandonedMs) {
        continue;
      }

      const state = await readUploadState(directory, id);

      if (state === null) {
        result.orphans.push(id);
        if (!includeOrphans) {
          continue;
        }
      } else {
        // state.complete, not the sidecar's offset: trusting that offset made
        // every finished upload look abandoned and therefore deletable.
        if (state.complete) {
          result.completed.push(id);
          if (!includeCompleted) {
            continue;
          }
        }
      }

      await fs.rm(blobPath, { force: true });
      await fs.rm(_path.join(directory, `${id}.json`), { force: true });

      releaseUpload(id);
      result.removed.push(id);
    } catch (err) {
      result.errors.push({ id, error: err.message });
    }
  }

  // A claimed upload leaves its '<id>.json' behind. Age-gated like the blobs:
  // tus writes the two separately, so a fresh widow may have a blob coming.
  for (const [name, id] of widowedSidecars.map((m) => [m[0], m[1]])) {
    const sidecarPath = _path.join(directory, name);

    try {
      const stats = await fs.stat(sidecarPath);

      if (now - stats.mtimeMs < abandonedMs) {
        continue;
      }

      await fs.rm(sidecarPath, { force: true });

      releaseUpload(id);
      result.sidecars.push(name);
    } catch (err) {
      result.errors.push({ id: name, error: err.message });
    }
  }

  return result;
};

module.exports = {
  getLimits,
  getFreeBytes,
  getUserUsage,
  checkUploadAllowed,
  registerUpload,
  touchUpload,
  releaseUpload,
  getUploadRecord,
  listUploads,
  isUploadOwner,
  getRecordedOwner,
  readUploadInfo,
  readUploadState,
  pruneIdleUploads,
  beginRequest,
  endRequest,
  hasActiveRequest,
  cleanupAbandonedUploads,
  clearUploads,
  assertUploadComplete,
  recoverUploadReservations,
};
