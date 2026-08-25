const _path = require("path");

/**
 * The one place the upload staging directory is defined.
 *
 * tus writes incoming bytes here (routes/uploads.js), lib/file-utils.js moves
 * them out when a project claims the upload, and models/File.js has to accept
 * the directory as a permitted source root or that move is refused. Four
 * modules therefore have to agree on this path.
 *
 * They previously did not. routes/uploads.js and the now-deleted
 * lib/fileUpload.js honoured an UPLOAD_DIRECTORY override while
 * lib/file-utils.js and models/File.js hardcoded <cwd>/files, so setting that
 * variable in production would have stranded every finished upload somewhere
 * nothing looked for it — and the failure would have surfaced as a confusing
 * "refusing upload" from the path guard rather than as a misconfiguration.
 * lib/fileUpload.js is gone (it was unreferenced, and built a second File
 * document for every upload alongside createFileDocument); it is named here
 * only because it was half of the disagreement this module settled.
 *
 * `UPLOAD_DIRECTORY` exists so tests can point the store at a scratch
 * directory instead of writing into the repository's own files/. It is read
 * lazily, per call, because the test suite sets and unsets it between cases —
 * caching the resolved value at require time would freeze whichever value
 * happened to be present when the first module was loaded.
 *
 * @returns {string} The absolute path of the upload staging directory.
 */
const uploadPath = () =>
  process.env.UPLOAD_DIRECTORY
    ? _path.resolve(process.env.UPLOAD_DIRECTORY)
    : _path.join(process.cwd(), "files");

module.exports = { uploadPath };
