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

// link() reports these when the source and destination sit on different mounts,
// which is the only case the copy fallback is a valid recovery for. EPERM is
// what Windows returns for the same situation, and what a filesystem that
// cannot hard-link at all returns everywhere.
//
// Only ever applied to an error from link() itself. It once also saw errors
// from the unlink of the source, which shares EPERM with the cross-mount case
// for an entirely unrelated reason — unlink returns it when the process does
// not own the file in a sticky-bit shared directory — so a plain source-side
// permission failure was diagnosed as a cross-mount move and fell into the
// copy branch.
const CROSS_DEVICE_CODES = new Set(["EXDEV", "EPERM", "ENOTSUP"]);

// Refuses to open a symlink at the final path component instead of silently
// opening whatever it points at. POSIX-only; Windows has no equivalent and
// leaves the constant undefined, which degrades to the old following open.
const O_NOFOLLOW = fsConstants.O_NOFOLLOW || 0;

/**
 * Whether two stat results describe the same file on the same filesystem.
 * @param {object} a - A stat result.
 * @param {object} b - Another stat result.
 * @returns {boolean} True when both name one inode.
 */
const isSameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

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

/**
 * The only directories a File may legitimately be moved *out of*.
 *
 * `path` is a plain string on a document anyone with upload rights can create,
 * and this method reads then unlinks whatever it names. Without this list a
 * poisoned path turns "move my upload into the datastore" into "move — or
 * delete — any file the API user can reach".
 *
 * @returns {string[]} The configured roots, skipping any that are unset.
 */
const permittedSourceRoots = () =>
  [
    process.env.DATASTORE_ROOT,
    process.env.HPC_TRANSFER_DIRECTORY,
    // Where local-filesystem uploads are staged. Read from the shared helper
    // rather than rebuilt here: routes/uploads.js honours an UPLOAD_DIRECTORY
    // override, and a hardcoded <cwd>/files here would refuse every finished
    // upload as an unpermitted source the moment that variable was set.
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
 *
 * The residual race, stated honestly: POSIX has no unlink-by-descriptor, so
 * the name has to be resolved once more here and something could be swapped in
 * between this lstat and the unlink. The window is two syscalls wide rather
 * than the whole multi-gigabyte transfer, and the worst outcome is one
 * unlinked file inside a directory the attacker can already write to — not a
 * file of ours copied out of, or somebody else's copied into, the datastore,
 * which is what the pinned handle rules out. Closing it completely needs
 * openat/unlinkat on a directory handle, which Node does not expose.
 *
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

  // relNewPath is built from the File's originalName, which came in on a
  // request body, and the parent's stored path — so it is resolved against the
  // datastore rather than joined onto it. Leading slashes are stripped, not
  // rejected: getRelativePath() has always returned "/group/project/..." and
  // path.join() quietly treated that as relative.
  const fullNewPath = await resolveWithinReal(
    process.env.DATASTORE_ROOT,
    cleanDirectoryName(relNewPath),
  );
  if (!fullNewPath) {
    // The rejected path is logged, not thrown: this message reaches the client
    // as the Run's statusError.
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

  // Held for the whole operation so a shutdown mid-transfer can be refused.
  // Released in the finally: a copy that neither finished nor threw would
  // otherwise block every subsequent clean shutdown forever.
  const transferToken = addTransfer(file._id.toString(), file.name);

  try {
    console.log("Moving file from", file.path, "to", fullNewPath);

    // Create directory if it doesn't exist (native mkdirp equivalent)
    await fs.mkdir(_path.dirname(fullNewPath), { recursive: true });

    // isPermittedSource() above resolved this path through its symlinks, but
    // that answer went stale the instant it was given, and nothing pinned what
    // it vouched for. For an hpc-mv the source root is a directory
    // unprivileged users write into by design, so the name can be re-pointed
    // between the check and the open. Opening the source once, here, and
    // comparing every later step against this handle is what ties the check to
    // the file it actually approved.
    //
    // O_NOFOLLOW makes the open refuse a symlink at the last component rather
    // than opening its target. That costs the ability to move a source that is
    // legitimately a symlink — a deliberate trade: a symlink is precisely the
    // thing whose meaning can be changed underneath us.
    let sourceHandle;
    try {
      sourceHandle = await fs.open(
        sourcePath,
        fsConstants.O_RDONLY | O_NOFOLLOW,
      );
    } catch (openErr) {
      // The link used to be the first thing to touch the source, so this is
      // now where a missing or unreadable one is reported. Same message shape,
      // because the operator still needs both paths to work out what happened.
      openErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${openErr.message}`;
      throw openErr;
    }

    try {
      const pinnedSource = await sourceHandle.stat();
      // Whether the destination is a second name for the pinned inode (link)
      // or a fresh copy of its bytes (cross-device fallback).
      let destinationIsSourceInode = true;

      // Link then unlink, not rename: rename() silently replaces whatever is
      // already at the destination, while link() fails with EEXIST — atomically,
      // and without following a symlink someone left sitting at that name. Same
      // speed and same atomicity on one filesystem, no clobber.
      try {
        await fs.link(sourcePath, fullNewPath);
      } catch (linkErr) {
        if (linkErr.code === "EEXIST") {
          // Almost always an earlier attempt that moved the bytes and then
          // failed before the document was saved. Picking a new name here would
          // hide a second copy of a multi-GB read under a name nothing points
          // at, so the operator gets told instead.
          throw new Error(
            `Failed to move ${file.path} to ${fullNewPath}: destination already exists`,
          );
        }

        if (!CROSS_DEVICE_CODES.has(linkErr.code)) {
          // Copying is only a valid recovery for a cross-mount move. For any
          // other failure the source is the problem, and opening the
          // destination for writing would truncate whatever is already there.
          // ENOENT in particular means an earlier attempt moved the bytes and
          // then failed before the document was saved — the destination holds
          // the only copy, and a "fallback" would destroy it.
          linkErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${linkErr.message}`;
          throw linkErr;
        }

        // Cross-device: copy, then promote. These are sequencing reads, often
        // many GB, so an interruption part-way through must never leave a
        // truncated file under the real name — it would look like a complete
        // read to everything downstream. Writing to a sibling and linking it
        // into place means the destination only ever appears complete, even if
        // the process is killed outright. pipeline() also destroys both streams,
        // which a bare pipe() does not do on error.
        const partialPath = partialPathFor(fullNewPath, file._id);

        try {
          // Both the size and the bytes come from the pinned handle rather
          // than from the path, so a swap after the containment check cannot
          // get a different file copied into the datastore, and cannot make a
          // short copy look complete by shrinking the source behind us.
          const sourceSize = pinnedSource.size;

          // The partial name is deterministic, so anything already using it is
          // this file's own leftover from an interrupted attempt: drop it, then
          // create the copy exclusively. Opening with a plain 'w' instead would
          // follow — and write straight through — a symlink planted at that name.
          await fs.unlink(partialPath).catch((err) => {
            if (err.code !== "ENOENT") {
              throw err;
            }
          });

          await pipeline(
            sourceHandle.createReadStream(),
            createWriteStream(partialPath, { flags: "wx" }),
          );

          // A stream that ends early resolves cleanly, so the byte count is the
          // only thing that actually proves the copy is whole.
          const { size: copiedSize } = await fs.stat(partialPath);
          if (copiedSize !== sourceSize) {
            throw new Error(
              `Copy of ${file.path} is ${copiedSize} bytes but the source is ${sourceSize} bytes`,
            );
          }

          // Promoted with link + unlink for the same reason as the same-device
          // branch above: rename() would overwrite a destination that is already
          // there, or write through a symlink standing in for it.
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
        // link() resolves the source path a second time, so a swap between the
        // open above and the link would have filed somebody else's file in the
        // datastore under this document's name. The inode at the destination
        // is the proof of which file actually got linked; only the name we
        // just created is removed if it is the wrong one.
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

      // Removing the source is its own step, outside the try above: an error
      // here is not a link error and must not be run through the cross-device
      // classification. It shares EPERM with the cross-mount case for an
      // unrelated reason — a sticky-bit shared directory refuses an unlink by
      // a process that does not own the file — and that used to be diagnosed
      // as a cross-mount move and quietly copied instead.
      await unlinkPinnedSource(sourcePath, pinnedSource, file, fullNewPath);
    } finally {
      // Best-effort: the move has either succeeded or thrown by now, and a
      // failure to close a descriptor must not mask either outcome.
      await sourceHandle.close().catch(() => {});
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
