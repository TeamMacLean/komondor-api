const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs").promises;

// Not defined on Windows, where `O_RDONLY | undefined` would coerce to NaN.
// Falling back to 0 keeps the flag a no-op there rather than breaking the
// open; production is Linux/macOS, and the callers that care about the leaf
// hand in an already-open handle instead of a path.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

/**
 * Hashes an open stream, ticking periodically so a caller can keep a slow HTTP
 * response alive.
 *
 * @param {import('stream').Readable} stream - The source.
 * @param {function} [onTick] - Called at most every 5s while data flows.
 * @param {string} label - What to name in an error log.
 * @returns {Promise<string>} The MD5 in hex.
 */
const hashStream = (stream, onTick, label) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    let lastTick = Date.now();

    stream.on("data", (data) => {
      hash.update(data);
      if (onTick && Date.now() - lastTick > 5000) {
        lastTick = Date.now();
        onTick();
      }
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (err) => {
      console.error(`Error calculating MD5 for file ${label}:`, err);
      reject(err);
    });
  });

/**
 * Calculates the MD5 checksum of a file.
 *
 * Accepts either a path or an already-open FileHandle. The handle form exists
 * to close a TOCTOU at the leaf: a caller that has just lstat'd a name and
 * satisfied itself the name is not a symlink cannot hand that decision over by
 * passing the name back, because the name can be re-pointed in between — and
 * HPC_TRANSFER_DIRECTORY is writable by unprivileged users by design. Passing
 * the descriptor it already vouched for ties the check to the bytes hashed.
 *
 * When given a path it opens with O_NOFOLLOW itself, so a symlinked leaf fails
 * with ELOOP rather than being hashed. That closes the static attack for every
 * caller; only the handle form closes the race as well.
 *
 * A handle passed in is not *deliberately* closed here, and a handle opened here
 * always is. But do not read the first half as a guarantee: on Node 26,
 * `handle.createReadStream({ autoClose: false })` followed by `stream.destroy()`
 * DOES close the FileHandle — `autoClose` governs the stream's own fd, not the
 * lifetime of the handle it was created from. Probed directly: `handle.stat()`
 * succeeds after the stream ends and throws "file closed" after destroy().
 *
 * Harmless today because the one handle caller (routes/directory-files.js)
 * closes it in a `finally` and never reuses it. It is written down because the
 * comment previously promised the opposite, and a future caller that wanted to
 * hash a handle and then keep reading from it would be broken by a guarantee
 * that was never real. `.nvmrc` pins Node 24 — worth re-probing there.
 *
 * @param {string|import('fs').promises.FileHandle} target - Path or open handle.
 * @param {function} [onTick] - Optional callback called periodically (e.g. to
 *   keep an HTTP connection alive).
 * @returns {Promise<string>} A promise that resolves with the MD5 checksum in
 *   hex format, or rejects if an error occurs.
 */
const calculateFileMd5 = async (target, onTick) => {
  const isHandle =
    target !== null &&
    typeof target === "object" &&
    typeof target.createReadStream === "function";

  const handle = isHandle
    ? target
    : await fsp.open(target, fs.constants.O_RDONLY | O_NOFOLLOW);

  // autoClose: false — the stream must not take the descriptor away from a
  // caller that is still holding it. That also means nothing destroys the
  // stream for us: an undestroyed fs ReadStream keeps a live libuv handle, so
  // it has to be torn down explicitly here or the process will not exit.
  const stream = handle.createReadStream({ autoClose: false });

  try {
    return await hashStream(stream, onTick, isHandle ? "<open handle>" : target);
  } finally {
    stream.destroy();
    if (!isHandle) {
      await handle.close().catch(() => {});
    }
  }
};

module.exports = {
  calculateFileMd5,
};
