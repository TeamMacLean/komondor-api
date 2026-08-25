const _path = require("path");
const File = require("../models/File");

// The same directory routes/uploads.js hands to the tus FileStore, and the same
// one models/File.js permits as a move source. Shared rather than repeated —
// see lib/utils/uploadPath.js.
const { uploadPath } = require("./utils/uploadPath");

module.exports = {
  /**
   * Creates the File document for an upload that finished but was never
   * attached to a project.
   *
   * Nothing calls this in the normal flow: File documents are created by
   * lib/file-utils.js when a project or sample submission names the upload.
   * This is the recovery path for bytes on disk with no submission behind
   * them. It used to be wired into the tus upload-complete hook, where it
   * would have created a *second* File document for every upload.
   *
   * @param {object} upload - A finished tus Upload: {id, size, metadata}.
   * @returns {Promise<object|null>} The saved File, or null if the upload
   *   carried too little metadata to describe a file.
   */
  create: async (upload) => {
    // tus parses Upload-Metadata for us; it used to arrive here as a raw
    // base64 header that this module decoded itself.
    const metadata = (upload && upload.metadata) || {};

    if (!upload || !upload.id || !metadata.filename || !metadata.filetype) {
      console.error("BAD UPLOAD", { id: upload && upload.id, metadata });
      return null;
    }

    const name = upload.id;
    const filePath = _path.join(uploadPath(), name);

    const savedFile = await new File({
      name,
      type: metadata.filetype,
      originalName: metadata.filename,
      description: metadata.description || null,
      path: filePath,
      tempUploadPath: filePath,
      uploadName: name,
    }).save();

    console.log("new file created", {
      id: savedFile._id,
      name: savedFile.name,
      originalName: savedFile.originalName,
      path: savedFile.path,
    });

    return savedFile;
  },
};
