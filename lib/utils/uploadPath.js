const _path = require("path");

/**
 * The one place the upload staging directory is defined: routes/uploads.js,
 * lib/file-utils.js and models/File.js must all agree on this path, and
 * previously did not.
 *
 * Read per call rather than cached, because tests set and unset
 * UPLOAD_DIRECTORY between cases.
 *
 * @returns {string} The absolute path of the upload staging directory.
 */
const uploadPath = () =>
  process.env.UPLOAD_DIRECTORY
    ? _path.resolve(process.env.UPLOAD_DIRECTORY)
    : _path.join(process.cwd(), "files");

module.exports = { uploadPath };
