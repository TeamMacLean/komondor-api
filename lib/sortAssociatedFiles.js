const { processAdditionalFiles, processReadFiles } = require("./file-utils");

/**
 * Route-facing wrapper around processAdditionalFiles.
 * @param {Array<object>} additionalFiles - File objects.
 * @param {string} parentType - 'project' or 'sample'.
 * @param {mongoose.Types.ObjectId} parentId - Parent document id.
 * @param {string} parentPath - Parent's relative path.
 * @param {string} [username] - Authenticated caller; a staged upload is only claimable by the user who staged it.
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
    throw error;
  }
};

/**
 * Route-facing wrapper around processReadFiles.
 * @param {Array<object>} readFiles - File objects.
 * @param {mongoose.Types.ObjectId} runId - Parent Run id.
 * @param {string} runPath - The Run's relative path.
 * @param {object} uploadInfo - Upload method and files.
 * @param {string} [username] - Authenticated caller; a staged upload is only claimable by the user who staged it.
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
    throw error;
  }
};

module.exports = {
  sortAdditionalFiles,
  sortReadFiles,
};
