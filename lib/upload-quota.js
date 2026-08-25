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
    // An upload of unknown length is charged nothing here: charging the
    // maximum would refuse every upload on a volume smaller than it.
    const projected = free - (Number.isFinite(size) ? size : 0);

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

      if (now - stats.mtimeMs < abandonedMs) {
        continue;
      }

      const info = await readUploadInfo(directory, id);

      if (info === null) {
        result.orphans.push(id);
        if (!includeOrphans) {
          continue;
        }
      } else {
        const finished =
          Number.isFinite(info.size) && Number(info.offset) >= info.size;

        if (finished) {
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
  pruneIdleUploads,
  cleanupAbandonedUploads,
  clearUploads,
};
