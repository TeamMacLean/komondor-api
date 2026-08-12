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
 * A utility function to handle errors in route handlers.
 * It logs the error and sends a standardized error response.
 *
 * The response always includes a `detail` field with the underlying error
 * message so that API clients (e.g. komondor-power) can surface the real
 * cause to users instead of only showing the generic catch-all message.
 *
 * @param {object} res - The Express response object.
 * @param {Error} error - The error object.
 * @param {number} [statusCode=500] - The HTTP status code.
 * @param {string} [message] - A custom, user-facing message to send.
 * @param {string} [requestId] - Optional request ID for log correlation.
 */
const handleError = (res, error, statusCode = 500, message, requestId) => {
  const reqId = requestId || generateRequestId();

  // Log the full error for debugging purposes
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

  // The underlying error message — more specific than the generic clientMessage.
  // e.g. "E11000 duplicate key error" vs "Failed to create new project."
  const detail = error instanceof Error ? error.message : undefined;

  // In production, hide the generic message for 500 errors but still include
  // `detail` — komondor-power is an internal client and needs it for diagnostics.
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
      // A subdirectory is not a file; without this it is reported as an
      // untracked stray. Anything else (including symlinks, which sequencing
      // pipelines do use) is left in — isFile() is false for a symlink even
      // when it points at a perfectly good file.
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".")) // Filter out hidden files
      .filter((name) => !isPartialTransferFile(name)); // in-flight copies
  } catch (error) {
    // If the directory doesn't exist, it's a non-critical error, so return an empty array.
    if (error.code === "ENOENT") {
      return [];
    }
    // For other fs errors, re-throw to be caught by the main error handler.
    console.error(`Failed to read directory at ${directoryPath}:`, error);
    throw error;
  }
};

/**
 * Resolves the on-disk filename a database record refers to.
 *
 * Records arrive in more than one shape: an AdditionalFile with its `file` ref
 * populated, a bare File document, or a plain string. An *unpopulated* ref is
 * an ObjectId — truthy, but with no `originalName` — so it must not be
 * mistaken for a populated one.
 *
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
 * Names present in `counts` beyond what `other` accounts for, repeated by the
 * shortfall. Comparing sets rather than counts hid duplicates: two records
 * named report.pdf with one copy on disk reported as complete.
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
 *
 * Entries whose filename cannot be resolved are reported in `unresolved`
 * rather than dropped. Dropping them made two different faults invisible: a
 * missing populate silently emptied the database side so that every real file
 * read as untracked, and a File document deleted out from under its
 * AdditionalFile made a broken record look like a stray file on disk.
 *
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

  // macOS and Linux disagree on how accented filenames are encoded, so compare
  // on a single normal form rather than reporting a byte difference as a
  // missing file. The reported names stay as they were supplied.
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

  // A file both missing and untracked is usually one that was renamed, which
  // is worth saying outright rather than reporting as two unrelated faults.
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
 * Reads a directory and compares it against the database records in one step,
 * degrading to an UNKNOWN status instead of failing the whole request.
 *
 * These checks were added to read endpoints that previously did no filesystem
 * work at all. Letting a stalled or unmounted datastore turn a working GET
 * into a 500 would be a worse regression than not reporting file status.
 *
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
