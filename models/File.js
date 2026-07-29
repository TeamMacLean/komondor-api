const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const { createReadStream, createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // should NOT have unique, rely on path instead
    type: { type: String, required: true }, // used to be required FALSE TODO check if needed still I think it fixed a bug
    uploadName: { type: String, required: true },
    originalName: { type: String, required: true },
    description: { type: String },
    path: { type: String, required: false }, // HACK to required false
    createFileDocumentId: { type: String },
    tempUploadPath: { type: String, required: false }, // optional: only used for local filesystem uploads
    oldParentID: { type: String },
    oldReadId: { type: String },
    oldAdditionalFileId: { type: String },
    uploadMethod: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

// create a unique combo of name and path (and when uploaded)
schema.index({ name: 1, path: 1, createFileDocumentId: 1 }, { unique: true });

// i converted to async function, check this still works
schema.methods.moveToFolderAndSave = async function (relNewPath) {
  const file = this;

  if (!process.env.DATASTORE_ROOT) {
    throw new Error("DATASTORE_ROOT is not configured");
  }
  if (!file.path) {
    throw new Error(`Cannot move file ${file._id}: it has no source path`);
  }

  const fullNewPath = _path.join(process.env.DATASTORE_ROOT, relNewPath);

  try {
    console.log("Moving file from", file.path, "to", fullNewPath);

    // Create directory if it doesn't exist (native mkdirp equivalent)
    await fs.mkdir(_path.dirname(fullNewPath), { recursive: true });

    // Try rename first (faster if on same filesystem)
    try {
      await fs.rename(file.path, fullNewPath);
    } catch (renameErr) {
      // If rename fails (likely cross-device), fall back to copy+unlink.
      // These are sequencing reads, often many GB, so a failure part-way
      // through leaves a truncated file at the destination. It must be removed:
      // left behind it looks like a complete read file to everything
      // downstream. pipeline() also destroys both streams, which a bare
      // pipe() does not do on error.
      try {
        await pipeline(
          createReadStream(file.path),
          createWriteStream(fullNewPath),
        );
      } catch (copyErr) {
        await fs.unlink(fullNewPath).catch((cleanupErr) => {
          if (cleanupErr.code !== "ENOENT") {
            console.error(
              `Failed to remove partial file at ${fullNewPath}:`,
              cleanupErr,
            );
          }
        });
        throw copyErr;
      }

      // Remove source file only after the copy has fully succeeded
      await fs.unlink(file.path);
    }

    file.path = relNewPath;
    return file.save();
  } catch (err) {
    console.log("...but error moving file! :(");
    console.error(err);
    throw err;
  }
};

const File = mongoose.model("File", schema);

module.exports = File;
