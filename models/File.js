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
 * Whether the file behind a pinned handle has been written to since it was
 * pinned.
 *
 * isSameFile alone is not enough: it compares dev+ino, which are unchanged by
 * an in-place rewrite of the SAME inode. Reproduced by execution — a 1 MiB
 * copy, with the source re-scp'd over itself after the first 4096 bytes and
 * ending at the same length, produced a destination holding 4096 old bytes
 * followed by 1,044,480 new ones and reported success, because both the size
 * check and the inode check still passed. Timestamps are what actually move:
 * a write updates mtime, and any inode change updates ctime.
 *
 * @param {import('fs').Stats} current - A fresh fstat of the pinned handle.
 * @param {import('fs').Stats} pinned - The fstat taken when it was pinned.
 * @returns {boolean} True when the bytes may have changed underneath us.
 */
const wasMutatedSincePinned = (current, pinned) =>
  !isSameFile(current, pinned) ||
  current.size !== pinned.size ||
  current.mtimeMs !== pinned.mtimeMs ||
  current.ctimeMs !== pinned.ctimeMs;

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
 * Streams the pinned source into `fullNewPath`, via a deterministic partial
 * file, verifying the byte count before promoting it into place.
 *
 * Reads from the already-open `sourceHandle` — not by reopening `pinnedPath`
 * as a fresh path lookup. A path reopen defeats the whole point of pinning: a
 * source swapped after isPermittedSource() vouched for it (the staging name
 * re-scp'd mid-move, which truncates and rewrites in place) would have a
 * path-based copy silently read the REPLACEMENT's bytes, not the ones that
 * were checked. Reproduced by execution. An already-open file descriptor
 * keeps referring to the same inode's data regardless of what the pathname
 * is later made to point at, which is what actually closes this.
 *
 * The partial-then-promote shape is what makes an interrupted copy safe to
 * crash on: the final name only ever appears once the whole byte count is
 * verified. This was also reproduced by execution as broken when the retained
 * copy was written directly to `fullNewPath` — an interrupt after 4 of 8 bytes
 * left a permanently-truncated file AT THE REAL NAME, and every retry then
 * failed "destination already exists" against a destination too short to
 * ever adopt. Used for both the HPC-retention copy and the cross-device
 * fallback below; two separate hand-rolled copies of this exact discipline is
 * what let this gap open in the first place.
 *
 * @param {object} sourceHandle - The open, pinned source file handle.
 * @param {object} pinnedSource - fstat of that handle; the expected byte count.
 * @param {string} pinnedPath - The path that handle was opened from, re-stat'd
 *   after the copy to detect an in-place rewrite of the same inode.
 * @param {string} fullNewPath - The destination path.
 * @param {mongoose.Document} file - The File being moved, for the deterministic
 *   partial name and error messages.
 * @returns {Promise<void>}
 * @throws {Error} On a short copy, a source modified mid-copy, or if the
 *   destination already exists.
 */
const copyPinnedSourceTo = async (
  sourceHandle,
  pinnedSource,
  pinnedPath,
  fullNewPath,
  file,
) => {
  const partialPath = partialPathFor(fullNewPath, file._id);

  try {
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

    // A stream that ends early still resolves cleanly, so the byte count is
    // the only proof the copy is whole.
    const { size: copiedSize } = await fs.stat(partialPath);
    if (copiedSize !== pinnedSource.size) {
      throw new Error(
        `Copy of ${file.path} is ${copiedSize} bytes but the source is ${pinnedSource.size} bytes`,
      );
    }

    // The byte count above proves the copy is not SHORT; it does not prove the
    // bytes are the ones that were pinned. Pinning an open handle defeats a
    // path swap, but not an in-place rewrite of the same inode — the fd
    // happily streams whatever the file holds as it is read. An HPC source
    // re-scp'd over itself mid-copy (the ordinary "I resent it because the
    // first transfer looked wrong" case) is a same-inode, same-size rewrite:
    // reproduced as a destination containing a 4096-byte head of the old file
    // and the rest of the new one, promoted and reported as success. Refuse
    // it and let the retry copy a settled source instead.
    //
    // Stat'd by path, not through the handle: pipeline() destroys the read
    // stream when it finishes, which closes the FileHandle with it, so an
    // fstat here fails "file closed". The same-inode guard is what makes the
    // path safe to trust for this one question — if the name now points
    // somewhere else entirely, the pinned fd still streamed the right bytes
    // and there is nothing to reject.
    const sourceNow = await fs.stat(pinnedPath).catch(() => null);
    if (
      sourceNow &&
      isSameFile(sourceNow, pinnedSource) &&
      wasMutatedSincePinned(sourceNow, pinnedSource)
    ) {
      throw new Error(
        `Failed to move ${file.path} to ${fullNewPath}: the source was modified while it was being copied`,
      );
    }

    // link + unlink, not rename: no-clobber, same reason as the direct-link
    // path this stands in for.
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
};

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
 *
 * Uses stat, not lstat: a permitted source may itself be a symlink (see
 * openPinnedSource), and the pinned stat is of the *target* the move actually
 * read. lstat-ing a still-legitimate symlink source would never match it.
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
  const current = await fs.stat(sourcePath);

  if (!isSameFile(current, pinnedSource)) {
    throw new Error(
      `Failed to move ${file.path} to ${fullNewPath}: the source was replaced while it was being moved`,
    );
  }

  await fs.unlink(sourcePath);
};

/**
 * Opens `sourcePath` for reading, refusing to follow a symlink at the leaf —
 * except when the leaf IS a symlink, in which case isPermittedSource() has
 * already proven its real target sits inside a permitted root (directly, or
 * via a configured ALLOWED_LINK_ROOTS entry) a moment ago. ELOOP is exactly
 * what O_NOFOLLOW raises for a leaf symlink, so only that error triggers the
 * fallback; opening the realpath'd target with O_NOFOLLOW again refuses a
 * second layer of symlink a swap could have introduced since that check.
 * @param {string} sourcePath - The absolute source path, already validated by
 *   isPermittedSource().
 * @returns {Promise<object>} The opened file handle.
 */
const openPinnedSource = async (sourcePath) => {
  try {
    const handle = await fs.open(sourcePath, fsConstants.O_RDONLY | O_NOFOLLOW);
    return { handle, path: sourcePath };
  } catch (err) {
    if (err.code !== "ELOOP") {
      throw err;
    }
    // The leaf is a symlink that isPermittedSource() already vouched for.
    // The resolved path is returned as well as the handle because link(2) on
    // Linux does NOT dereference a symlink given as oldpath — it would link
    // the symlink's own inode, which then fails the pinned-inode check below
    // and deletes the destination. Darwin's link() does follow, which is why
    // this passed locally and would have failed on the Ubuntu CI and in
    // production.
    const realTarget = await fs.realpath(sourcePath);
    const handle = await fs.open(realTarget, fsConstants.O_RDONLY | O_NOFOLLOW);
    return { handle, path: realTarget };
  }
};

/**
 * Whether `sourcePath` sits in the shared HPC transfer inbox, where the file
 * is written by an unprivileged upload the API does not own. A directory typo
 * in the destination is one keystroke away, so the source is left in place
 * for that case rather than destroyed — see BREAKING_CHANGES.md entry 32.
 * @param {string} sourcePath - The absolute, resolved source path.
 * @returns {Promise<boolean>} True if the source is the HPC inbox.
 */
const isHpcInboxSource = async (sourcePath) => {
  const hpcRoot = process.env.HPC_TRANSFER_DIRECTORY;
  if (typeof hpcRoot !== "string" || hpcRoot.trim() === "") {
    return false;
  }
  return assertWithinReal(hpcRoot, sourcePath);
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

  // Decided once, from the validated sourcePath, not re-checked later: whether
  // to skip the final unlink below.
  const keepSource = await isHpcInboxSource(sourcePath);

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
    // The path actually opened: the same as sourcePath, unless the leaf was a
    // permitted symlink, in which case it is the resolved target. Every
    // filesystem operation below uses this, so link()/copy operate on the real
    // bytes on every platform.
    let pinnedPath;
    try {
      const opened = await openPinnedSource(sourcePath);
      sourceHandle = opened.handle;
      pinnedPath = opened.path;
    } catch (openErr) {
      openErr.message = `Failed to move ${file.path} to ${fullNewPath}: ${openErr.message}`;
      throw openErr;
    }

    try {
      const pinnedSource = await sourceHandle.stat();
      // Cleared by the cross-device fallback, which writes a fresh copy.
      let destinationIsSourceInode = true;

      // A retained HPC source must be an INDEPENDENT copy, not a hard link.
      // Hard-linking shares one inode, so a scientist re-scp-ing over the
      // staging name (scp truncates in place) would rewrite the archived bytes
      // too — retention would protect nothing. copyPinnedSourceTo streams
      // through the pinned handle into a partial file and only promotes it
      // once the byte count is verified — see its own doc comment for why a
      // direct fs.copyFile(path, ...) here was neither crash-safe nor
      // actually pinned.
      if (keepSource) {
        await copyPinnedSourceTo(
          sourceHandle,
          pinnedSource,
          pinnedPath,
          fullNewPath,
          file,
        );
        // A fresh copy is a different inode by definition, so the same-inode
        // assertion below does not apply to it.
        destinationIsSourceInode = false;
      } else {
        // link() + unlink(), not rename(): rename silently overwrites an existing
        // destination, link fails with EEXIST.
        try {
          await fs.link(pinnedPath, fullNewPath);
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

          // Cross-device: same streamed, partial-then-promote copy the HPC
          // retention branch above uses, so an interrupted copy never
          // appears complete under the real name.
          await copyPinnedSourceTo(
          sourceHandle,
          pinnedSource,
          pinnedPath,
          fullNewPath,
          file,
        );

          destinationIsSourceInode = false;
        }
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
      // CROSS_DEVICE_CODES check, since unlink shares EPERM with it. Skipped
      // for the HPC inbox, whose staging copy is kept as an independent file
      // so a directory typo cannot destroy another group's only copy.
      if (!keepSource) {
        await unlinkPinnedSource(sourcePath, pinnedSource, file, fullNewPath);
      }
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
