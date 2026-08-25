const { processAdditionalFiles, processReadFiles } = require("./file-utils");

/**
 * A wrapper around the refactored processAdditionalFiles function.
 * This maintains the existing API for the route handlers while using the new,
 * cleaner file processing logic.
 *
 * @param {Array<object>} additionalFiles - Array of file objects.
 * @param {string} parentType - 'project' or 'sample'.
 * @param {mongoose.Types.ObjectId} parentId - The ID of the parent document.
 * @param {string} parentPath - The relative path of the parent document.
 * @param {string} [username] - The authenticated caller. Forwarded so a staged
 *   upload can only be claimed by the user who staged it; without it every
 *   local-filesystem claim is refused as belonging to 'undefined'.
 * @returns {Promise<void>}
 */
const sortAdditionalFiles = async (
  additionalFiles,
  parentType,
  parentId,
  parentPath,
  username,
) => {
  try {
    return await processAdditionalFiles(
      additionalFiles,
      parentType,
      parentId,
      parentPath,
      username,
    );
  } catch (error) {
    console.error("Error sorting additional files:", error);
    // Re-throw the error to be caught by the route handler's catch block
    throw error;
  }
};

/**
 * A wrapper around the refactored processReadFiles function.
 * This maintains the existing API for the route handlers while using the new,
 * cleaner file processing logic.
 *
 * @param {Array<object>} readFiles - Array of file objects.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent Run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method and files.
 * @param {string} [username] - The authenticated caller. Forwarded so a staged
 *   upload can only be claimed by the user who staged it; without it every
 *   local-filesystem claim is refused as belonging to 'undefined'.
 * @returns {Promise<void>}
 */
const sortReadFiles = async (
  readFiles,
  runId,
  runPath,
  uploadInfo,
  username,
) => {
  try {
    return await processReadFiles(
      readFiles,
      runId,
      runPath,
      uploadInfo,
      username,
    );
  } catch (error) {
    console.error("Error sorting read files:", error);
    // Re-throw the error to be caught by the route handler's catch block
    throw error;
  }
};

module.exports = {
  sortAdditionalFiles,
  sortReadFiles,
};
