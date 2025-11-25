const fs = require("fs").promises;

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
 * @param {object} res - The Express response object.
 * @param {Error} error - The error object.
 * @param {number} [statusCode=500] - The HTTP status code.
 * @param {string} [message] - A custom message to send.
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

  // In production, hide internal details for 500 errors
  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    res.status(500).send({
      error: "An internal server error occurred.",
      requestId: reqId,
    });
  } else {
    res.status(statusCode).send({
      error: clientMessage,
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
    const files = await fs.readdir(directoryPath);
    return files.filter((file) => !file.startsWith(".")); // Filter out hidden files
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

module.exports = {
  handleError,
  getActualFiles,
  generateRequestId,
};
