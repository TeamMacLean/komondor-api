const { isAuthenticated, isAdmin } = require("./middleware");
const express = require("express");
const fs = require("fs").promises;
const fsConstants = require("fs").constants;
const { calculateFileMd5 } = require("../lib/utils/md5");
const { generateRequestId } = require("./_utils");
const {
  cleanDirectoryName,
  resolveWithin,
  resolveBelow,
  assertWithinReal,
} = require("../lib/utils/safePath");
const {
  auditHpcAccess,
  requireHpcGroupAccess,
} = require("../lib/utils/hpcAudit");
let router = express.Router();

/**
 * GET /directory-files/debug
 * Reports how a target directory name resolves on disk.
 * Admin-only: the response exposes server filesystem layout and configuration.
 */
router
  .route("/directory-files/debug")
  .all(isAuthenticated)
  .all(isAdmin)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;
    const cleanedTargetDirectoryName = cleanDirectoryName(
      targetDirectoryName || "cheese",
    );
    const dirRoot = resolveWithin(
      process.env.HPC_TRANSFER_DIRECTORY,
      cleanedTargetDirectoryName,
    );

    let exists = false;
    let isDirectory = false;
    let isSymbolicLink = false;
    if (dirRoot) {
      try {
        const stat = await fs.stat(dirRoot);
        exists = true;
        isDirectory = stat.isDirectory();
      } catch (e) {
        // Leave both false when the path cannot be stat'd.
      }
      try {
        isSymbolicLink = (await fs.lstat(dirRoot)).isSymbolicLink();
      } catch (e) {
        // Leave false when the path cannot be lstat'd.
      }
    }

    // resolveWithin, not resolveBelow: this endpoint exists to answer "where
    // does this name land?", and the root itself is a legitimate answer to
    // report. But `withinTransferDirectory` is a containment verdict, and a
    // lexical-only verdict says "true" for a symlink pointing at /etc — a
    // diagnostic that lies about containment is exactly how the read paths
    // came to be trusted. So the verdict resolves symlinks even though
    // `dirRoot` stays the lexical path the other handlers would build.
    const withinTransferDirectory =
      dirRoot !== null &&
      (await assertWithinReal(process.env.HPC_TRANSFER_DIRECTORY, dirRoot));

    res.status(200).send({
      cwd: process.cwd(),
      __dirname: __dirname,
      HPC_TRANSFER_DIRECTORY: process.env.HPC_TRANSFER_DIRECTORY,
      targetDirectoryName: targetDirectoryName,
      cleanedTargetDirectoryName: cleanedTargetDirectoryName,
      dirRoot: dirRoot,
      withinTransferDirectory,
      exists,
      isDirectory,
      isSymbolicLink,
    });
  });

router
  .route("/directory-files")
  .all(isAuthenticated)
  .all(requireHpcGroupAccess)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;

    try {
      if (!process.env.HPC_TRANSFER_DIRECTORY) {
        throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
      }

      if (!targetDirectoryName || typeof targetDirectoryName !== "string") {
        throw new Error("Missing targetDirectoryName");
      }

      const cleanedTargetDirectoryName =
        cleanDirectoryName(targetDirectoryName);

      if (!cleanedTargetDirectoryName) {
        throw new Error("Missing targetDirectoryName");
      }

      // resolveBelow, not resolveWithin: a name that normalises back to the
      // root (".", "./", "a/..") must not list every group's inbound directory.
      const dirRoot = resolveBelow(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedTargetDirectoryName,
      );

      if (!dirRoot) {
        console.error(
          `[directory-files] Rejected path outside transfer directory: ${targetDirectoryName}`,
        );
        return res
          .status(403)
          .send({ error: "Access denied: Invalid directory path" });
      }

      // resolveBelow is lexical only. Unprivileged HPC users write into the
      // transfer directory by design (the "hpc-mv" upload method), so one of
      // them can plant "<root>/theirgroup/rootdir -> /" and have readdir list
      // the filesystem root. lib/file-utils.js already resolves symlinks
      // against this same root on the write path.
      if (
        !(await assertWithinReal(process.env.HPC_TRANSFER_DIRECTORY, dirRoot))
      ) {
        console.error(
          `[directory-files] Rejected path escaping transfer directory via symlink: ${targetDirectoryName}`,
        );
        return res
          .status(403)
          .send({ error: "Access denied: Invalid directory path" });
      }

      let dirExists = false;
      try {
        // stat, not lstat: assertWithinReal above already followed the leaf
        // and proved its real target is either inside the root or inside a
        // configured ALLOWED_LINK_ROOTS entry, so there is no containment
        // reason left to refuse it here. A symlinked project directory (see
        // BREAKING_CHANGES.md entry 34) must list, not read as "not a directory".
        dirExists = (await fs.stat(dirRoot)).isDirectory();
      } catch (e) {
        throw new Error("Issue reading target directory");
      }
      if (!dirExists) {
        throw new Error("Directory does not exist");
      }

      const filesResults = await fs.readdir(dirRoot);

      if (!filesResults.length) {
        throw new Error("No files found in target directory");
      }

      auditHpcAccess({
        action: "list",
        user: req.user,
        path: dirRoot,
        detail: `files=${filesResults.length}`,
      });

      res.status(200).send({
        filesResults,
      });
    } catch (e) {
      console.error("[directory-files]", e.message);
      // Preserved from the original implementation: consuming services detect
      // failure by the presence of `error` in the body, not by status code.
      res.status(200).send({ error: e.message });
    }
  });

/**
 * POST /directory-files/verify-md5
 * Calculates the MD5 checksum of a file in the HPC transfer directory
 * and compares it against a user-provided expected MD5.
 */
router
  .route("/directory-files/verify-md5")
  .all(isAuthenticated)
  .all(requireHpcGroupAccess)
  .post(async (req, res) => {
    const requestId = generateRequestId();
    const { directoryName, fileName, expectedMd5 } = req.body || {};

    if (!directoryName || !fileName || !expectedMd5) {
      return res.status(400).send({
        error: "Missing required fields: directoryName, fileName, expectedMd5",
        requestId,
      });
    }

    if (
      typeof expectedMd5 !== "string" ||
      typeof directoryName !== "string" ||
      typeof fileName !== "string"
    ) {
      return res.status(400).send({
        error: "directoryName, fileName and expectedMd5 must be strings",
        requestId,
      });
    }

    try {
      if (!process.env.HPC_TRANSFER_DIRECTORY) {
        throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
      }

      const cleanedDirectoryName = cleanDirectoryName(directoryName);
      const filePath = resolveBelow(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedDirectoryName,
        cleanDirectoryName(fileName),
      );

      if (!filePath) {
        console.error(
          `[${requestId}] Access denied: path traversal attempt - ${directoryName}/${fileName}`,
        );
        return res.status(403).send({
          error: "Access denied: Invalid file path",
          requestId,
        });
      }

      // resolveBelow is lexical only, and the transfer directory is writable
      // by unprivileged HPC users (the "hpc-mv" upload method), so a symlink
      // planted there would otherwise have the checksum computed over whatever
      // it points at — an oracle over any file on the box.
      if (
        !(await assertWithinReal(process.env.HPC_TRANSFER_DIRECTORY, filePath))
      ) {
        console.error(
          `[${requestId}] Access denied: symlink escape attempt - ${directoryName}/${fileName}`,
        );
        return res.status(403).send({
          error: "Access denied: Invalid file path",
          requestId,
        });
      }

      // Opened once, with O_NOFOLLOW, and the same descriptor is both stat'd
      // and hashed.
      //
      // An lstat here followed by calculateFileMd5(filePath) would have gone
      // back to the *name* to hash it, and HPC_TRANSFER_DIRECTORY is writable
      // by unprivileged users by design — so the name could be replaced with a
      // symlink in between and the checksum computed over whatever it pointed
      // at. O_NOFOLLOW still refuses a symlinked leaf outright (ELOOP) so that
      // race can never smuggle an unvouched-for target past this open, and
      // handing the handle to calculateFileMd5 ties this decision to the bytes
      // hashed.
      //
      // assertWithinReal above already resolved the leaf fully — fs.realpath
      // follows every path component, the last one included — and proved its
      // target sits inside the transfer directory or a configured
      // ALLOWED_LINK_ROOTS entry (see BREAKING_CHANGES.md entry 34), the same
      // allowance a symlinked ancestor already gets. Only an ELOOP on the leaf
      // itself reopens the realpath'd target, itself with O_NOFOLLOW, so a
      // second layer of symlink introduced since that check is still refused.
      let handle;
      try {
        try {
          handle = await fs.open(
            filePath,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
          );
        } catch (openErr) {
          if (openErr.code !== "ELOOP") {
            throw openErr;
          }
          const realTarget = await fs.realpath(filePath);
          handle = await fs.open(
            realTarget,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
          );
        }
        const stat = await handle.stat();
        if (!stat.isFile()) {
          await handle.close().catch(() => {});
          return res.status(404).send({
            error: `File not found: ${fileName}`,
            requestId,
          });
        }
      } catch (e) {
        if (handle) {
          await handle.close().catch(() => {});
        }
        return res.status(404).send({
          error: `File not found: ${fileName}`,
          requestId,
        });
      }

      // Emitted here, once, after the handle is open and confirmed to be a
      // regular file but before a single byte is hashed. This endpoint reads
      // every byte of any file in any group's staging directory and the inbox
      // cannot authorise that (BREAKING_CHANGES.md entry 32), so attribution is
      // the only control there is — and it has to be written before the read,
      // not after, or a hash that dies mid-stream leaves no record that the
      // bytes were touched at all.
      auditHpcAccess({
        action: "md5",
        user: req.user,
        path: filePath,
        detail: `requestId=${requestId}`,
      });

      // Write headers early and stream spaces to prevent reverse proxy timeout for large files
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
      res.status(200);
      res.flushHeaders(); // Send headers immediately

      let hasError = false;
      let calculatedMd5;
      try {
        calculatedMd5 = await calculateFileMd5(handle, () => {
          res.write(" ");
          if (res.flush) res.flush(); // If compression middleware is used, flush it
        });
      } catch (err) {
        hasError = true;
        console.error(`[${requestId}] Error calculating MD5 mid-stream:`, err);
        res.write(
          JSON.stringify({
            error: `Failed to calculate MD5: ${err.message}`,
            requestId,
          }),
        );
        res.end();
      } finally {
        // calculateFileMd5 never closes a handle it was handed; this one is
        // ours, and it must be released whether the hash finished or threw.
        await handle.close().catch(() => {});
      }

      if (!hasError) {
        const normalizedExpected = expectedMd5.toLowerCase().trim();
        const matches = calculatedMd5 === normalizedExpected;

        res.write(
          JSON.stringify({
            fileName,
            expectedMd5: normalizedExpected,
            calculatedMd5,
            matches,
          }),
        );
        res.end();
      }
    } catch (e) {
      // If we haven't sent headers yet, we can send a 500
      if (!res.headersSent) {
        console.error(`[${requestId}] Error calculating MD5:`, e);
        res.status(500).send({
          error: `Failed to calculate MD5: ${e.message}`,
          requestId,
        });
      }
    }
  });

module.exports = router;
