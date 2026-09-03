const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs").promises;

// Not defined on Windows, where `O_RDONLY | undefined` would coerce to NaN;
// falling back to 0 makes the flag a no-op there instead of breaking the open.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

// Large enough to avoid excessive syscalls, small enough that the two hashes
// used by copy verification do not allocate meaningful extra memory.
const READ_BUFFER_BYTES = 1024 * 1024;

/**
 * Hashes an already-open descriptor with positional reads. Unlike a ReadStream,
 * this never takes ownership of the FileHandle and never depends on (or moves)
 * its current offset.
 * @param {import('fs').promises.FileHandle} handle - The open file.
 * @param {function} [onTick] - Called at most every 5s while data flows.
 * @returns {Promise<string>} The MD5 in hex.
 */
const hashHandle = async (handle, onTick) => {
  const hash = crypto.createHash("md5");
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let position = 0;
  let lastTick = Date.now();

  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);

    if (bytesRead === 0) {
      break;
    }

    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;

    if (onTick && Date.now() - lastTick > 5000) {
      lastTick = Date.now();
      onTick();
    }
  }

  return hash.digest("hex");
};

/**
 * Calculates the MD5 checksum of a file.
 *
 * Accepts a path or an already-open FileHandle: the handle form ties the hash to
 * a descriptor the caller already vouched for, and a path is opened O_NOFOLLOW
 * so a symlinked leaf fails with ELOOP rather than being hashed. A handle passed
 * in is never closed here. Positional FileHandle reads are used instead of a
 * ReadStream because destroying an ended FileHandle stream closes the caller's
 * descriptor on supported Node releases even with `autoClose: false`.
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

  try {
    return await hashHandle(handle, onTick);
  } catch (err) {
    console.error(
      `Error calculating MD5 for file ${isHandle ? "<open handle>" : target}:`,
      err,
    );
    throw err;
  } finally {
    if (!isHandle) {
      await handle.close().catch(() => {});
    }
  }
};

module.exports = {
  calculateFileMd5,
};
