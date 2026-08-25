const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs").promises;

// Not defined on Windows, where `O_RDONLY | undefined` would coerce to NaN;
// falling back to 0 makes the flag a no-op there instead of breaking the open.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

/**
 * Hashes an open stream, ticking periodically so a caller can keep a slow HTTP
 * response alive.
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
 * Accepts a path or an already-open FileHandle: the handle form ties the hash to
 * a descriptor the caller already vouched for, and a path is opened O_NOFOLLOW
 * so a symlinked leaf fails with ELOOP rather than being hashed. A handle passed
 * in is not closed here deliberately — but on Node 26 destroying the stream
 * closes it anyway, whatever `autoClose` says, so do not reuse it afterwards.
 *
 * @param {string|import('fs').promises.FileHandle} target - Path or open handle.
 * @param {function} [onTick] - Optional periodic callback.
 * @returns {Promise<string>} The MD5 checksum in hex.
 */
const calculateFileMd5 = async (target, onTick) => {
  const isHandle =
    target !== null &&
    typeof target === "object" &&
    typeof target.createReadStream === "function";

  const handle = isHandle
    ? target
    : await fsp.open(target, fs.constants.O_RDONLY | O_NOFOLLOW);

  // autoClose: false so the stream never takes a caller's descriptor away —
  // which means it must be destroyed below, or its libuv handle outlives us.
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
