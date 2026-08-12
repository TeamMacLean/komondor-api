const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const { createReadStream, createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");
const {
  addTransfer,
  removeTransfer,
  PARTIAL_TRANSFER_SUFFIX,
} = require("../lib/active-transfers");

// rename() reports these when the source and destination sit on different
// mounts, which is the only case the copy fallback is a valid recovery for.
// EPERM is what Windows returns for the same situation.
const CROSS_DEVICE_CODES = new Set(["EXDEV", "EPERM", "ENOTSUP"]);

/**
 * Where an in-progress copy is written before being promoted to its real name.
 * Deterministic per file, so retrying a move overwrites its own leftovers
 * instead of accumulating a new stray file each time.
 * @param {string} destination - The final absolute path.
 * @param {string|object} fileId - The File document's id.
 * @returns {string} The absolute path to write the copy to.
 */
const partialPathFor = (destination, fileId) =>
  `${destination}${PARTIAL_TRANSFER_SUFFIX}${fileId}`;

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

  // Held for the whole operation so a shutdown mid-transfer can be refused.
  // Released in the finally: a copy that neither finished nor threw would
  // otherwise block every subsequent clean shutdown forever.
  const transferToken = addTransfer(file._id.toString(), file.name);

  try {
    console.log("Moving file from", file.path, "to", fullNewPath);

    // Create directory if it doesn't exist (native mkdirp equivalent)
    await fs.mkdir(_path.dirname(fullNewPath), { recursive: true });

    // Try rename first (faster if on same filesystem, and atomic)
    try {
      await fs.rename(file.path, fullNewPath);
    } catch (renameErr) {
      if (!CROSS_DEVICE_CODES.has(renameErr.code)) {
        // Copying is only a valid recovery for a cross-mount move. For any
        // other failure the source is the problem, and opening the
        // destination for writing would truncate whatever is already there.
        // ENOENT in particular means an earlier attempt moved the bytes and
        // then failed before the document was saved — the destination holds
        // the only copy, and a "fallback" would destroy it.
        renameErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${renameErr.message}`;
        throw renameErr;
      }

      // Cross-device: copy, then promote. These are sequencing reads, often
      // many GB, so an interruption part-way through must never leave a
      // truncated file under the real name — it would look like a complete
      // read to everything downstream. Writing to a sibling and renaming
      // means the destination only ever appears complete, even if the process
      // is killed outright. pipeline() also destroys both streams, which a
      // bare pipe() does not do on error.
      const partialPath = partialPathFor(fullNewPath, file._id);

      try {
        const { size: sourceSize } = await fs.stat(file.path);

        await pipeline(
          createReadStream(file.path),
          createWriteStream(partialPath),
        );

        // A stream that ends early resolves cleanly, so the byte count is the
        // only thing that actually proves the copy is whole.
        const { size: copiedSize } = await fs.stat(partialPath);
        if (copiedSize !== sourceSize) {
          throw new Error(
            `Copy of ${file.path} is ${copiedSize} bytes but the source is ${sourceSize} bytes`,
          );
        }

        await fs.rename(partialPath, fullNewPath);
      } catch (copyErr) {
        await fs.unlink(partialPath).catch((cleanupErr) => {
          if (cleanupErr.code !== "ENOENT") {
            console.error(
              `Failed to remove partial file at ${partialPath}:`,
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

    try {
      return await file.save();
    } catch (saveErr) {
      // The bytes are already at the destination and the source is gone, so
      // retrying the move cannot work. Name both paths — recovering means
      // repointing the document, not moving the file again.
      console.error(
        `File ${file._id} was moved to ${fullNewPath} but the document could not be saved; the database still points at the previous path.`,
      );
      throw saveErr;
    }
  } catch (err) {
    console.log("...but error moving file! :(");
    console.error(err);
    throw err;
  } finally {
    removeTransfer(transferToken);
  }
};

const File = mongoose.model("File", schema);

module.exports = File;
