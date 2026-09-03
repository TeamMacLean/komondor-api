const mongoose = require("mongoose");
const crypto = require("crypto");
const _path = require("path");
const fs = require("fs").promises;
const { createWriteStream, constants: fsConstants } = require("fs");
const { Transform } = require("stream");
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
const { calculateFileMd5 } = require("../lib/utils/md5");

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
 * check and the inode check still passed. A normal write moves mtime, while a
 * metadata-preserving resend can restore it; the content verification below
 * covers that latter case even when the filesystem timestamp clock is coarse.
 *
 * ctime is deliberately not treated as mutation by itself. It is updated for
 * inode changes that touch no content at all — measured here, a chmod and
 * creating a hard link can bump ctime while leaving size, mtime and content
 * alone. HPC_TRANSFER_DIRECTORY is a shared inbox other
 * people's tooling operates on (BREAKING_CHANGES.md 35), so rejecting every
 * ctime move would turn `chmod -R` or a backup agent writing an xattr into a
 * full re-copy. The copy path verifies content regardless, and uses ctime only
 * to decide whether a digest was taken through a stable metadata window.
 *
 * @param {import('fs').Stats} current - A fresh stat of the pinned source.
 * @param {import('fs').Stats} pinned - The fstat taken when it was pinned.
 * @returns {boolean} True when the bytes may have changed underneath us.
 */
const wasMutatedSincePinned = (current, pinned) =>
  current.size !== pinned.size || current.mtimeMs !== pinned.mtimeMs;

/**
 * Whether two observations bound the same stable verification window.
 * ctime is included here even though it is not corruption by itself: if it
 * moves while bytes are being hashed, the digest may describe a mixture of
 * states and must be retried before it can prove anything.
 * @param {import('fs').Stats} a - An observation of the pinned descriptor.
 * @param {import('fs').Stats} b - A later observation of that descriptor.
 * @returns {boolean} True when no observable file state moved between them.
 */
const isSameVerificationSnapshot = (a, b) =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

const SOURCE_VERIFICATION_ATTEMPTS = 3;

/**
 * The common corruption error for a retained/cross-mount copy.
 * @param {mongoose.Document} file - The File being moved.
 * @param {string} fullNewPath - Its intended destination.
 * @returns {Error} A stable operator-facing error.
 */
const sourceModifiedError = (file, fullNewPath) =>
  new Error(
    `Failed to move ${file.path} to ${fullNewPath}: the source was modified while it was being copied`
  );

/**
 * Proves that the digest accumulated from the exact copy stream matches the
 * pinned source during a stable metadata window. A one-off chmod/hard-link
 * event merely retries; a content mutation or a source that never settles is
 * refused.
 * @param {import('fs').promises.FileHandle} sourceHandle - Pinned source.
 * @param {import('fs').Stats} pinnedSource - Initial descriptor stat.
 * @param {string} copiedDigest - Digest of every byte passed to the writer.
 * @param {mongoose.Document} file - The File being moved.
 * @param {string} fullNewPath - Its intended destination.
 * @returns {Promise<void>}
 */
const verifyStableCopy = async (
  sourceHandle,
  pinnedSource,
  copiedDigest,
  file,
  fullNewPath
) => {
  for (let attempt = 0; attempt < SOURCE_VERIFICATION_ATTEMPTS; attempt += 1) {
    const beforeDigest = await sourceHandle.stat();
    if (wasMutatedSincePinned(beforeDigest, pinnedSource)) {
      throw sourceModifiedError(file, fullNewPath);
    }

    // Sequential by design: copiedDigest is already fixed, so there is no
    // mutable source and partial being read in lockstep. One source pass is the
    // minimum content proof when ctime can have coarser granularity than a
    // small rewrite (observed on Linux even with bigint ctimeNs).
    const sourceDigest = await calculateFileMd5(sourceHandle);

    const afterDigest = await sourceHandle.stat();
    if (wasMutatedSincePinned(afterDigest, pinnedSource)) {
      throw sourceModifiedError(file, fullNewPath);
    }

    // A digest read across a ctime change is not evidence either way. Retry
    // so harmless metadata-only activity still succeeds once it settles.
    if (!isSameVerificationSnapshot(beforeDigest, afterDigest)) {
      continue;
    }

    if (sourceDigest !== copiedDigest) {
      throw sourceModifiedError(file, fullNewPath);
    }

    return;
  }

  throw sourceModifiedError(file, fullNewPath);
};

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
  fullNewPath,
  file
) => {
  const partialPath = partialPathFor(fullNewPath, file._id);
  let promoted = false;

  try {
    // The partial name is deterministic, so anything there is this file's
    // own leftover. 'wx' not 'w': 'w' writes through a symlink.
    await fs.unlink(partialPath).catch((err) => {
      if (err.code !== "ENOENT") {
        throw err;
      }
    });

    // autoClose:false keeps sourceHandle usable after the copy. Without it
    // pipeline() destroys the read stream on completion and closes the
    // descriptor with it, which is what pushed an earlier version of this
    // check onto a path-based stat — and a path-based stat is defeatable:
    // mutate the pinned inode, rename it away, recreate the pathname, and the
    // different-inode result made the check skip itself entirely.
    // Hash the exact stream sent to the writer. This removes the old second
    // full read of the partial while still detecting a source rewrite that
    // made the copy a mixture of old and new bytes.
    const copiedHash = crypto.createHash("md5");
    const hashCopiedBytes = new Transform({
      transform(chunk, _encoding, callback) {
        copiedHash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      hashCopiedBytes,
      createWriteStream(partialPath, { flags: "wx" })
    );
    const copiedDigest = copiedHash.digest("hex");

    // A stream that ends early still resolves cleanly, so the byte count is
    // the only proof the copy is whole.
    const { size: copiedSize } = await fs.stat(partialPath);
    if (copiedSize !== pinnedSource.size) {
      throw new Error(
        `Copy of ${file.path} is ${copiedSize} bytes but the source is ${pinnedSource.size} bytes`
      );
    }

    // The byte count proves the copy is not SHORT; it does not prove the bytes
    // are the ones that were pinned. Pinning an open handle defeats a path
    // swap, but not an in-place rewrite of the SAME inode — the descriptor
    // streams whatever that inode holds as it is read. An HPC source re-sent
    // over itself mid-copy (the ordinary "I resent it because the first
    // transfer looked wrong" case) is exactly that, and an audit reproduced a
    // 32 MiB destination made of 64 KiB of old bytes and the rest new,
    // promoted and reported as success.
    //
    // Size or mtime moving is proof of a write. Neither is sufficient alone:
    // `cp -p`, `rsync -t` and `tar -p` all restore the source's mtime, so an
    // ordinary re-send preserves inode, size AND mtime while changing the
    // content — measured, not assumed. ctime is the only metadata signal meant
    // to move even when mtime is restored, but it also moves for changes that
    // touch no content at all (a chmod, an added hard link — also measured),
    // and consecutive updates can collapse into one filesystem clock tick. It
    // therefore cannot be the content proof on a shared inbox.
    //
    // So: compare content on every copy, not only when ctime visibly moved.
    // Exact bigint ctimeNs was observed to remain unchanged across rapid writes
    // on Linux, so a timestamp-triggered digest still admitted small rewrites.
    // The copy digest was accumulated inline, making this one extra source pass
    // rather than re-reading both a 50 GiB source and a 50 GiB partial.
    await verifyStableCopy(
      sourceHandle,
      pinnedSource,
      copiedDigest,
      file,
      fullNewPath
    );

    // link + unlink, not rename: no-clobber, same reason as the direct-link
    // path this stands in for.
    try {
      await fs.link(partialPath, fullNewPath);
    } catch (promoteErr) {
      if (promoteErr.code === "EEXIST") {
        throw new Error(
          `Failed to move ${file.path} to ${fullNewPath}: destination already exists`
        );
      }
      throw promoteErr;
    }

    promoted = true;

    await fs.unlink(partialPath);
  } catch (copyErr) {
    if (promoted) {
      await fs.unlink(fullNewPath).catch((cleanupErr) => {
        if (cleanupErr.code !== "ENOENT") {
          console.error(
            `Failed to remove invalid copy at ${fullNewPath}:`,
            cleanupErr
          );
        }
      });
    }
    await fs.unlink(partialPath).catch((cleanupErr) => {
      if (cleanupErr.code !== "ENOENT") {
        console.error(
          `Failed to remove partial file at ${partialPath}:`,
          cleanupErr
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
  fullNewPath
) => {
  const current = await fs.stat(sourcePath);

  if (!isSameFile(current, pinnedSource)) {
    throw new Error(
      `Failed to move ${file.path} to ${fullNewPath}: the source was replaced while it was being moved`
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
  { timestamps: true, toJSON: { virtuals: true } }
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
    cleanDirectoryName(relNewPath)
  );
  if (!fullNewPath) {
    // Rejected path is logged, not thrown: the message reaches the client as
    // the Run's statusError.
    console.error(
      `File ${file._id}: refusing to move to a destination outside DATASTORE_ROOT:`,
      relNewPath
    );
    throw new Error(
      `Cannot move file ${file._id}: the destination is not inside the datastore`
    );
  }

  const sourcePath = _path.resolve(file.path);
  if (!(await isPermittedSource(sourcePath))) {
    console.error(
      `File ${file._id}: refusing to move from a source outside every permitted root:`,
      file.path
    );
    throw new Error(
      `Cannot move file ${file._id}: its source is not inside a permitted directory`
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
        await copyPinnedSourceTo(sourceHandle, pinnedSource, fullNewPath, file);
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
              `Failed to move ${file.path} to ${fullNewPath}: destination already exists`
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
            fullNewPath,
            file
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
              cleanupErr
            );
          });
          throw new Error(
            `Failed to move ${file.path} to ${fullNewPath}: the source was replaced while it was being moved`
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
        `File ${file._id} was moved to ${fullNewPath} but the document could not be saved; the database still points at the previous path.`
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
