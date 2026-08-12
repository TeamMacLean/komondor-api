/**
 * Tracks in-flight file transfers so shutdown can refuse to interrupt them.
 *
 * Entries are keyed by an opaque token rather than by their contents. Keying by
 * `{id, filename}` collapsed two concurrent moves of the same file into a
 * single entry, so whichever finished first cleared the flag while the other
 * was still copying — precisely the case this is meant to catch.
 *
 * The register is per-process and in memory. Under PM2 cluster mode each
 * instance would keep its own, and one instance would happily exit while
 * another was mid-transfer; see ecosystem.config.js, which pins a single
 * instance for this reason.
 */

/** Marks a copy that has not yet been promoted to its final name. */
const PARTIAL_TRANSFER_SUFFIX = ".part-";

// Matched strictly — suffix plus the File document's id, at the end of the
// name. A loose match would hide a genuine file called something like
// "assembly.part-2.bam", which would then be reported as missing from disk.
const PARTIAL_TRANSFER_PATTERN = /\.part-[0-9a-f]{24}$/i;

/** @type {Map<string, {token: string, id: string, filename: string, startedAt: number}>} */
const activeTransfers = new Map();

let nextToken = 0;

/**
 * Registers a transfer as in progress.
 * @param {string} id - The File document id, for the operator-facing warning.
 * @param {string} filename - The file's name, for the same warning.
 * @returns {string} A token to hand back to removeTransfer when the transfer ends.
 */
const addTransfer = (id, filename) => {
  const token = String((nextToken += 1));
  activeTransfers.set(token, { token, id, filename, startedAt: Date.now() });
  return token;
};

/**
 * Marks a transfer as finished. Safe to call with an unknown or undefined
 * token so callers can put it in a `finally` without further guarding.
 * @param {string} token - The token returned by addTransfer.
 * @returns {boolean} Whether an entry was actually removed.
 */
const removeTransfer = (token) => activeTransfers.delete(token);

/**
 * @returns {Array<{token: string, id: string, filename: string, startedAt: number, ageMs: number}>}
 *   Every transfer currently in flight, oldest first, with its age.
 */
const getActiveTransfers = () => {
  const now = Date.now();
  return Array.from(activeTransfers.values())
    .map((transfer) => ({ ...transfer, ageMs: now - transfer.startedAt }))
    .sort((a, b) => b.ageMs - a.ageMs);
};

/**
 * Splits the register into transfers worth blocking a shutdown for and ones
 * that have been running so long they are presumed stuck.
 *
 * Without the second category, a single copy hung on an unresponsive mount
 * would refuse every clean shutdown indefinitely, leaving SIGKILL as the only
 * way to restart the API.
 *
 * @param {number} stalledAfterMs - Age past which a transfer stops blocking.
 * @returns {{all: object[], inFlight: object[], stalled: object[]}}
 */
const getBlockingTransfers = (stalledAfterMs) => {
  const all = getActiveTransfers();
  return {
    all,
    inFlight: all.filter((t) => t.ageMs < stalledAfterMs),
    stalled: all.filter((t) => t.ageMs >= stalledAfterMs),
  };
};

/**
 * Whether a directory entry is a partially copied file rather than a real one.
 * These are invisible to the datastore's own file listings: reporting them
 * would show every interrupted copy as an untracked stray file.
 * @param {string} filename - A single directory entry name.
 * @returns {boolean}
 */
const isPartialTransferFile = (filename) =>
  typeof filename === "string" && PARTIAL_TRANSFER_PATTERN.test(filename);

/** Test helper: forgets every tracked transfer. */
const clearActiveTransfers = () => {
  activeTransfers.clear();
};

module.exports = {
  addTransfer,
  removeTransfer,
  getActiveTransfers,
  getBlockingTransfers,
  isPartialTransferFile,
  clearActiveTransfers,
  PARTIAL_TRANSFER_SUFFIX,
};
