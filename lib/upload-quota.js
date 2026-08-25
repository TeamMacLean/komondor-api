/**
 * Admission control and bookkeeping for resumable (tus) uploads.
 *
 * A tus upload URL is a licence to write bytes to disk for as long as the
 * client likes. Three limits are enforced before one is handed out, because
 * the ways this goes wrong are not the same shape:
 *
 *   - per-upload size: one file that is obviously too large;
 *   - per-user concurrency and in-flight bytes: one account opening many at
 *     once, which no single-file limit can catch;
 *   - free space on the upload volume: everybody's uploads together, or a
 *     volume that was already nearly full before today's traffic arrived.
 *
 * Every limit is read from the environment on each call rather than captured
 * at import, so an operator can raise one and restart the process without
 * editing code, and so tests can exercise a limit without re-requiring the
 * module.
 *
 * The register is per-process and in memory, like lib/active-transfers.js.
 * Under PM2 cluster mode each instance would keep its own and the per-user
 * caps would multiply by the instance count; ecosystem.config.js pins a single
 * instance. It is *accounting*, not a permission record: ownership is stamped
 * into the upload's own tus metadata, which is the copy that survives a
 * restart. See routes/uploads.js.
 */

const fs = require("fs").promises;
const _path = require("path");

const GIB = 1024 * 1024 * 1024;

// A tus id is Uid.rand(): 16 random bytes as hex. The cleanup sweep only ever
// deletes entries matching this, so an operator's stray file in the upload
// directory is reported rather than removed.
const UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/;

// The tus FileStore writes '<id>.json' beside every blob it creates. Matched
// separately from the blob so the sweep can find a sidecar whose blob is gone.
const UPLOAD_SIDECAR_PATTERN = /^([0-9a-f]{32})\.json$/;

/**
 * Reads a non-negative numeric setting from the environment.
 *
 * A malformed value falls back to the default and says so: silently treating
 * UPLOAD_MAX_BYTES="10 GB" as 0 would refuse every upload, and the resulting
 * 413s would look like a client bug.
 *
 * @param {string} name - The environment variable to read.
 * @param {number} fallback - The value to use when unset or unusable.
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
 * The upload limits currently in force.
 *
 * The defaults are deliberately generous: this is a sequencing datastore, and
 * a single read set is routinely tens of gigabytes. A cap that refused real
 * data would be a worse regression than the unbounded writes it replaces, so
 * the defaults are sized to stop abuse rather than to ration normal use.
 *
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
 * What an upload counts for against the per-user byte cap.
 *
 * An upload that defers its length (Upload-Defer-Length) declares no size, so
 * it is charged the full per-upload maximum. Charging it zero would make
 * "declare no length" the way to bypass the cap entirely.
 *
 * @param {number|null|undefined} size - The declared Upload-Length, if any.
 * @param {number} maxUploadBytes - The per-upload ceiling.
 * @returns {number} Bytes to charge to the user's in-flight total.
 */
const chargeableBytesFor = (size, maxUploadBytes) =>
  Number.isFinite(size) && size >= 0 ? size : maxUploadBytes;

/**
 * Forgets registrations that have seen no activity for the idle window.
 *
 * A client that vanishes mid-upload never releases its slot. Without this, a
 * handful of dropped connections would exhaust a user's concurrency cap until
 * the process restarted. The bytes on disk are a separate problem, handled by
 * {@link cleanupAbandonedUploads}.
 *
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
 * Free bytes on the volume holding `directory`.
 *
 * Returns null when the platform cannot say, which callers treat as "no
 * opinion" rather than "no space": refusing every upload because statfs is
 * unavailable would be a worse failure than the one the check guards against.
 *
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
 * Decides whether a new upload may start, and reserves its slot if so.
 *
 * Admission *registers* the upload rather than merely approving it, and does
 * so before it awaits anything. It used to total the user's usage, then await
 * the free-space check, and leave the caller to call registerUpload afterwards
 * — three yields of the event loop between reading the usage and writing it.
 * 500 concurrent POSTs each saw the same pre-registration total and every one
 * of them was admitted, which made maxConcurrentPerUser and
 * maxInflightBytesPerUser advisory rather than enforced. Node runs this on one
 * thread, so a synchronous read-check-reserve is airtight; the whole bug was
 * that an await sat inside it.
 *
 * A refusal after the reservation is taken releases it again, and a caller
 * that dies between admission and the first byte leaves a reservation that
 * {@link pruneIdleUploads} drops at the idle horizon — the same recovery a
 * dropped connection has always had.
 *
 * The free-space check stays a best-effort floor even so: reserved bytes are
 * not yet written, so free space does not fall as uploads are admitted. What
 * it now has is a bound — the per-user caps limit how many uploads can be in
 * flight at once, which they did not before.
 *
 * Statuses are chosen so a client can tell the three refusals apart: 413 means
 * "this file is too big, it will never fit", 429 means "you have too much open,
 * try again when something finishes", and 507 means "the server is out of
 * room", which is nothing the client can fix by retrying sooner.
 *
 * @param {object} params - The request being admitted.
 * @param {string} params.id - The tus upload id to reserve the slot under.
 * @param {string} params.username - The authenticated owner.
 * @param {number|null} [params.size] - Declared Upload-Length, if any.
 * @param {string} params.directory - The upload directory, for the disk check.
 * @param {number} [params.now] - Current epoch ms; injectable for tests.
 * @returns {Promise<{allowed: boolean, status?: number, error?: string}>}
 *   When allowed, the upload is already registered — the caller must not
 *   register it again, and must release it if it then fails to start.
 */
const checkUploadAllowed = async ({ id, username, size, directory, now }) => {
  const limits = getLimits();

  if (typeof username !== "string" || username === "") {
    return { allowed: false, status: 401, error: "Authentication required" };
  }

  if (typeof id !== "string" || id === "") {
    // There is nothing to reserve the slot under, and admitting without a
    // reservation is exactly the hole this function closes. Refuse rather
    // than fall back to the old advisory behaviour.
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

  // Idle registrations are dropped first so a user who lost a connection is
  // not held out of their own quota by a slot nothing is writing to.
  pruneIdleUploads(now === undefined ? Date.now() : now);

  // --- Critical section. Nothing below may await until the reservation is in
  // the register, or a concurrent request reads a usage total that is already
  // stale. ---
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
    // An upload of unknown length is charged nothing here — it would refuse
    // every upload on a volume smaller than the per-upload maximum — but it
    // still has to clear the floor as things stand.
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
 * Records an upload as in progress and notes who owns it.
 *
 * Normally reached through {@link checkUploadAllowed}, which reserves the slot
 * as part of admitting the upload. Calling it directly after a separate
 * admission check reintroduces the gap that made the per-user caps advisory.
 *
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
 *
 * Deliberately fails closed on an unknown owner. Uploads created before
 * ownership was recorded — including every upload the unauthenticated mount
 * accepted — have no owner, and letting those through would preserve exactly
 * the hole this closes. They are removed by {@link cleanupAbandonedUploads}.
 *
 * Ownership is not widened for admins: nobody has a reason to resume another
 * user's byte stream, and an admin who needs the disk space back deletes the
 * file rather than adopting the upload.
 *
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
 * @returns {Promise<object|null>} The parsed Upload, or null when absent or
 *   unreadable.
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
 * Who a finished upload belongs to, as recorded on disk.
 *
 * The in-process register is dropped the moment the last byte lands (see
 * onUploadFinish in routes/uploads.js), so by the time a project claims an
 * upload the tus sidecar is usually the only surviving record of who created
 * it — and after a restart it is the only one. It is read per call rather than
 * cached because a claim can arrive days later, in a process that never saw
 * the upload.
 *
 * Returns null for an upload with no recorded owner, which
 * {@link isUploadOwner} then refuses: uploads the old unauthenticated mount
 * accepted look exactly like that.
 *
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
 * Sweeps uploads that were started and never finished.
 *
 * Only *incomplete* uploads are deleted by default. A finished upload sitting
 * in the directory is not abandoned rubbish: it is a file the user uploaded
 * and has not yet attached to a project, and deleting it would destroy data
 * they still expect to find. Those are reported instead, along with blobs that
 * have no sidecar at all — every upload the old unauthenticated server
 * accepted looks like that, because it kept its metadata outside the directory.
 *
 * @param {object} params - What to sweep.
 * @param {string} params.directory - The upload directory.
 * @param {number} [params.now] - Current epoch ms; injectable for tests.
 * @param {boolean} [params.includeCompleted] - Also delete finished uploads.
 * @param {boolean} [params.includeOrphans] - Also delete blobs with no sidecar.
 * @returns {Promise<{removed: string[], completed: string[], orphans: string[],
 *   sidecars: string[], errors: Array<{id: string, error: string}>}>} What was
 *   removed and what was left behind for an operator to look at.
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

  // A sidecar whose blob is still here is that upload's metadata and is dealt
  // with alongside it below; only the widowed ones are swept separately.
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

  // A sidecar outlives its blob. lib/file-utils.js hard-links a claimed upload
  // into the datastore and unlinks the blob, leaving '<id>.json' behind, and
  // the sweep above only ever looked at entries whose *whole* name was an
  // upload id — so every claimed upload left a JSON file in the staging
  // directory permanently. There is nothing left to claim once the blob is
  // gone, so these are deleted rather than reported, but still only once they
  // are past the abandoned horizon: tus writes the blob and the sidecar as two
  // separate steps, and a sidecar seen in that window has a blob on the way.
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
