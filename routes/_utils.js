const fs = require("fs").promises;
const { isPartialTransferFile } = require("../lib/active-transfers");

/**
 * Generates a unique request ID for log correlation.
 * @returns {string} A unique request ID.
 */
const generateRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Logs an error and sends a standardised error response.
 * @param {object} res - Express response.
 * @param {Error} error - The error.
 * @param {number} [statusCode=500] - HTTP status code.
 * @param {string} [message] - Custom user-facing message.
 * @param {string} [requestId] - Request ID for log correlation.
 */
const handleError = (res, error, statusCode = 500, message, requestId) => {
  const reqId = requestId || generateRequestId();

  console.error(`[${reqId}] Error (${statusCode}):`, message || error.message);
  console.error(`[${reqId}] Stack:`, error.stack);
  if (error.errors) {
    console.error(
      `[${reqId}] Validation errors:`,
      JSON.stringify(error.errors, null, 2),
    );
  }

  const clientMessage =
    message ||
    (error instanceof Error ? error.message : "An unexpected error occurred.");

  // e.g. "E11000 duplicate key error" vs the generic "Failed to create project".
  const detail = error instanceof Error ? error.message : undefined;

  // Production hides the message on 500s but keeps `detail`: komondor-power is
  // an internal client and needs it for diagnostics.
  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    res.status(500).send({
      error: "An internal server error occurred.",
      detail,
      requestId: reqId,
    });
  } else {
    res.status(statusCode).send({
      error: clientMessage,
      detail,
      requestId: reqId,
    });
  }
};

/**
 * Reads the contents of a directory and filters out system files (e.g., .DS_Store).
 * Returns an empty array if the directory does not exist.
 * @param {string} directoryPath - The absolute path to the directory.
 * @returns {Promise<Array<string>>} - A promise that resolves to an array of filenames.
 */
const getActualFiles = async (directoryPath) => {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
      // !isDirectory(), not isFile(): isFile() is false for a symlink, and
      // sequencing pipelines do produce those.
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".")) // Filter out hidden files
      .filter((name) => !isPartialTransferFile(name)); // in-flight copies
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    console.error(`Failed to read directory at ${directoryPath}:`, error);
    throw error;
  }
};

/**
 * Resolves the on-disk filename a database record refers to.
 * @param {object|string} dbFile - One entry from the database side.
 * @returns {string|null} The filename, or null if it cannot be resolved.
 */
const resolveDbFileName = (dbFile) => {
  if (typeof dbFile === "string") {
    return dbFile || null;
  }
  if (!dbFile || typeof dbFile !== "object") {
    return null;
  }
  // A populated ref exposes originalName; an ObjectId does not.
  return dbFile.file?.originalName || dbFile.originalName || null;
};

/** Upper-cases the first character, for messages built from fragments. */
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Counts occurrences of each name, preserving first-seen order. */
const countByName = (names) => {
  const counts = new Map();
  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  return counts;
};

/**
 * Names in `counts` beyond what `other` accounts for, repeated by the shortfall.
 * Counts, not sets: two records named report.pdf with one file on disk is a fault.
 */
const excessNames = (counts, other) => {
  const out = [];
  counts.forEach((count, name) => {
    const shortfall = count - (other.get(name) ?? 0);
    for (let i = 0; i < shortfall; i += 1) {
      out.push(name);
    }
  });
  return out;
};

/**
 * Compares the files a record claims to have against what is on disk.
 * Unnameable entries go in `unresolved`, not dropped: dropping them makes a
 * missing populate look like a directory full of untracked files.
 * @param {Array<object|string>} [dbFiles=[]] - The database side.
 * @param {Array<string>} [actualFiles=[]] - Filenames from getActualFiles.
 * @returns {{status: "OK"|"WARNING"|"MISMATCH", message: string, missing: string[], extra: string[], unresolved: string[]}}
 */
const getAdditionalFilesStatus = (dbFiles = [], actualFiles = []) => {
  const dbFileNames = [];
  const unresolved = [];

  (Array.isArray(dbFiles) ? dbFiles : []).forEach((dbFile) => {
    const name = resolveDbFileName(dbFile);
    if (name) {
      dbFileNames.push(name);
    } else {
      unresolved.push(String(dbFile?._id ?? dbFile?.file ?? "unknown"));
    }
  });

  // macOS and Linux encode accented filenames differently; compare on one
  // normal form so a byte difference is not reported as a missing file.
  const key = (name) => name.normalize("NFC");
  const dbCounts = countByName(dbFileNames.map(key));
  const diskCounts = countByName(
    (Array.isArray(actualFiles) ? actualFiles : []).map(key),
  );

  const missing = excessNames(dbCounts, diskCounts);
  const extra = excessNames(diskCounts, dbCounts);

  const problems = [];
  if (missing.length > 0) {
    problems.push(`missing ${missing.length} file(s) on disk`);
  }
  if (unresolved.length > 0) {
    problems.push(`${unresolved.length} record(s) with no readable filename`);
  }
  if (extra.length > 0) {
    problems.push(`${extra.length} untracked file(s) on disk`);
  }

  if (problems.length === 0) {
    return {
      status: "OK",
      message: "All files present",
      missing,
      extra,
      unresolved,
    };
  }

  const summary =
    missing.length > 0 && extra.length > 0
      ? `${capitalise(problems.join(", "))} — this often means a file was renamed`
      : capitalise(problems.join(", "));

  return {
    status: missing.length > 0 || unresolved.length > 0 ? "MISMATCH" : "WARNING",
    message: summary,
    missing,
    extra,
    unresolved,
  };
};

/**
 * Reads a directory and compares it against the database records in one step.
 * Degrades to UNKNOWN rather than throwing: an unmounted datastore must not
 * turn a working GET into a 500.
 * @param {Array<object|string>} dbFiles - The database side.
 * @param {string} directoryPath - Absolute path to the directory to list.
 * @returns {Promise<{actualFiles: string[], status: object}>}
 */
const compareFilesToDirectory = async (dbFiles, directoryPath) => {
  try {
    const actualFiles = await getActualFiles(directoryPath);
    return {
      actualFiles,
      status: getAdditionalFilesStatus(dbFiles, actualFiles),
    };
  } catch (error) {
    console.error(`Could not check files in ${directoryPath}:`, error.message);
    return {
      actualFiles: [],
      status: {
        status: "UNKNOWN",
        message: `Could not read the storage directory: ${error.message}`,
        missing: [],
        extra: [],
        unresolved: [],
      },
    };
  }
};

module.exports = {
  handleError,
  getActualFiles,
  generateRequestId,
  getAdditionalFilesStatus,
  compareFilesToDirectory,
};
