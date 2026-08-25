const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const { createWriteStream, constants: fsConstants } = require("fs");
const { pipeline } = require("stream/promises");
const {
  addTransfer,
  removeTransfer,
  PARTIAL_TRANSFER_SUFFIX,
} = require("../lib/active-transfers");
const {
  cleanDirectoryName,
  resolveWithinReal,
  assertWithinReal,
} = require("../lib/utils/safePath");
const { uploadPath } = require("../lib/utils/uploadPath");

// Cross-mount link() failures, the only case the copy fallback recovers from.
// Apply only to errors from link(): unlink() returns EPERM for unrelated reasons.
const CROSS_DEVICE_CODES = new Set(["EXDEV", "EPERM", "ENOTSUP"]);

// Refuses a symlink at the final path component. POSIX-only; undefined on
// Windows, where this degrades to a following open.
const O_NOFOLLOW = fsConstants.O_NOFOLLOW || 0;

/**
 * Whether two stat results describe the same file on the same filesystem.
 * @param {object} a - A stat result.
 * @param {object} b - Another stat result.
 * @returns {boolean} True when both name one inode.
 */
const isSameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

/**
 * Where an in-progress copy is written before promotion to its real name.
 * Keep the `<destination>.part-<fileId>` shape: lib/active-transfers.js
 * pattern-matches it, and determinism lets a retry reuse its own leftover.
 * @param {string} destination - The final absolute path.
 * @param {string|object} fileId - The File document's id.
 * @returns {string} The absolute path to write the copy to.
 */
const partialPathFor = (destination, fileId) =>
  `${destination}${PARTIAL_TRANSFER_SUFFIX}${fileId}`;

/**
 * The only directories a File may legitimately be moved *out of*. `path` is
 * caller-supplied, and the move reads then unlinks whatever it names.
 * @returns {string[]} The configured roots, skipping any that are unset.
 */
const permittedSourceRoots = () =>
  [
    process.env.DATASTORE_ROOT,
    process.env.HPC_TRANSFER_DIRECTORY,
    // Staging dir via the shared helper, not a hardcoded <cwd>/files:
    // routes/uploads.js honours an UPLOAD_DIRECTORY override.
    uploadPath(),
  ].filter((root) => typeof root === "string" && root.trim() !== "");

/**
 * Whether `sourcePath` really sits inside one of the permitted source roots.
 * @param {string} sourcePath - The absolute path to check.
 * @returns {Promise<boolean>}
 */
const isPermittedSource = async (sourcePath) => {
  for (const root of permittedSourceRoots()) {
    if (await assertWithinReal(root, sourcePath)) {
      return true;
    }
  }
  return false;
};

/**
 * Removes the source of a completed move, refusing to unlink a different file
 * than the one that was moved.
 * @param {string} sourcePath - The absolute path the move read from.
 * @param {object} pinnedSource - fstat of the handle the move actually used.
 * @param {mongoose.Document} file - The File being moved, for the message.
 * @param {string} fullNewPath - The destination, for the message.
 * @returns {Promise<void>}
 * @throws {Error} When the path no longer names the file that was moved.
 */
const unlinkPinnedSource = async (
  sourcePath,
  pinnedSource,
  file,
  fullNewPath,
) => {
  const current = await fs.lstat(sourcePath);

  if (!isSameFile(current, pinnedSource)) {
    throw new Error(
      `Failed to move ${file.path} to ${fullNewPath}: the source was replaced while it was being moved`,
    );
  }

  await fs.unlink(sourcePath);
};

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

  // Resolved against the datastore, not joined onto it: relNewPath is partly
  // request-supplied. Leading slashes are stripped, not rejected.
  const fullNewPath = await resolveWithinReal(
    process.env.DATASTORE_ROOT,
    cleanDirectoryName(relNewPath),
  );
  if (!fullNewPath) {
    // Rejected path is logged, not thrown: the message reaches the client as
    // the Run's statusError.
    console.error(
      `File ${file._id}: refusing to move to a destination outside DATASTORE_ROOT:`,
      relNewPath,
    );
    throw new Error(
      `Cannot move file ${file._id}: the destination is not inside the datastore`,
    );
  }

  const sourcePath = _path.resolve(file.path);
  if (!(await isPermittedSource(sourcePath))) {
    console.error(
      `File ${file._id}: refusing to move from a source outside every permitted root:`,
      file.path,
    );
    throw new Error(
      `Cannot move file ${file._id}: its source is not inside a permitted directory`,
    );
  }

  // Blocks shutdown mid-transfer. Must be released in the finally below, or a
  // stuck copy blocks every later clean shutdown.
  const transferToken = addTransfer(file._id.toString(), file.name);

  try {
    console.log("Moving file from", file.path, "to", fullNewPath);

    // Create directory if it doesn't exist (native mkdirp equivalent)
    await fs.mkdir(_path.dirname(fullNewPath), { recursive: true });

    // Opened once and pinned: isPermittedSource() checked a name, and the name
    // can be re-pointed afterwards. Later steps compare against this handle.
    let sourceHandle;
    try {
      sourceHandle = await fs.open(
        sourcePath,
        fsConstants.O_RDONLY | O_NOFOLLOW,
      );
    } catch (openErr) {
      openErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${openErr.message}`;
      throw openErr;
    }

    try {
      const pinnedSource = await sourceHandle.stat();
      // Cleared by the cross-device fallback, which writes a fresh copy.
      let destinationIsSourceInode = true;

      // link() + unlink(), not rename(): rename silently overwrites an existing
      // destination, link fails with EEXIST.
      try {
        await fs.link(sourcePath, fullNewPath);
      } catch (linkErr) {
        if (linkErr.code === "EEXIST") {
          throw new Error(
            `Failed to move ${file.path} to ${fullNewPath}: destination already exists`,
          );
        }

        if (!CROSS_DEVICE_CODES.has(linkErr.code)) {
          // Must not fall through to the copy branch: on ENOENT the destination
          // may hold the only copy, which a write would truncate.
          linkErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${linkErr.message}`;
          throw linkErr;
        }

        // Cross-device: copy to a sibling, then link it into place, so an
        // interrupted copy never appears complete under the real name.
        const partialPath = partialPathFor(fullNewPath, file._id);

        try {
          // Size from the pinned handle, not the path: a source swapped behind
          // us cannot make a short copy look complete.
          const sourceSize = pinnedSource.size;

          // The partial name is deterministic, so anything there is this file's
          // own leftover. 'wx' not 'w': 'w' writes through a symlink.
          await fs.unlink(partialPath).catch((err) => {
            if (err.code !== "ENOENT") {
              throw err;
            }
          });

          await pipeline(
            sourceHandle.createReadStream(),
            createWriteStream(partialPath, { flags: "wx" }),
          );

          // A stream that ends early still resolves cleanly, so the byte count
          // is the only proof the copy is whole.
          const { size: copiedSize } = await fs.stat(partialPath);
          if (copiedSize !== sourceSize) {
            throw new Error(
              `Copy of ${file.path} is ${copiedSize} bytes but the source is ${sourceSize} bytes`,
            );
          }

          // link + unlink again, for the same no-clobber reason as above.
          try {
            await fs.link(partialPath, fullNewPath);
          } catch (promoteErr) {
            if (promoteErr.code === "EEXIST") {
              throw new Error(
                `Failed to move ${file.path} to ${fullNewPath}: destination already exists`,
              );
            }
            throw promoteErr;
          }
          await fs.unlink(partialPath);
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

        destinationIsSourceInode = false;
      }

      if (destinationIsSourceInode) {
        // link() resolved the source name a second time, so check the linked
        // inode is the pinned one before the source is unlinked below.
        const destination = await fs.lstat(fullNewPath);

        if (!isSameFile(destination, pinnedSource)) {
          await fs.unlink(fullNewPath).catch((cleanupErr) => {
            console.error(
              `Failed to remove the wrongly linked file at ${fullNewPath}:`,
              cleanupErr,
            );
          });
          throw new Error(
            `Failed to move ${file.path} to ${fullNewPath}: the source was replaced while it was being moved`,
          );
        }
      }

      // Deliberately outside the try above: an unlink error must not reach the
      // CROSS_DEVICE_CODES check, since unlink shares EPERM with it.
      await unlinkPinnedSource(sourcePath, pinnedSource, file, fullNewPath);
    } finally {
      // Best-effort: a failed close must not mask the move's outcome.
      await sourceHandle.close().catch(() => {});
    }

    file.path = relNewPath;

    try {
      return await file.save();
    } catch (saveErr) {
      // Bytes are at the destination and the source is gone: recovery means
      // repointing the document, not retrying the move.
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
