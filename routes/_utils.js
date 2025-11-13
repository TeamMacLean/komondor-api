const fs = require('fs').promises;

/**
 * A utility function to handle errors in route handlers.
 * It logs the error and sends a standardized error response.
 * @param {object} res - The Express response object.
 * @param {Error} error - The error object.
 * @param {number} [statusCode=500] - The HTTP status code.
 * @param {string} [message] - A custom message to send.
 */
const handleError = (res, error, statusCode = 500, message) => {
  // Log the full error for debugging purposes, but don't expose it to the client.
  console.error(error);

  const clientMessage = message || (error instanceof Error ? error.message : 'An unexpected error occurred.');

  // In a production environment, you might want to avoid sending back internal error messages.
  // For now, this provides more descriptive errors during development.
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
      res.status(500).send({ error: 'An internal server error occurred.' });
  } else {
      res.status(statusCode).send({ error: clientMessage });
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
    return files.filter(file => !file.startsWith('.')); // Filter out hidden files
  } catch (error) {
    // If the directory doesn't exist, it's a non-critical error, so return an empty array.
    if (error.code === 'ENOENT') {
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
};
