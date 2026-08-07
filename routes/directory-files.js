const { isAuthenticated, isAdmin } = require("./middleware");
const express = require("express");
const fs = require("fs").promises;
const { calculateFileMd5 } = require("../lib/utils/md5");
const { generateRequestId } = require("./_utils");
const {
  cleanDirectoryName,
  resolveWithin,
  resolveBelow,
} = require("../lib/utils/safePath");
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
    if (dirRoot) {
      try {
        const stat = await fs.stat(dirRoot);
        exists = true;
        isDirectory = stat.isDirectory();
      } catch (e) {
        // Leave both false when the path cannot be stat'd.
      }
    }

    res.status(200).send({
      cwd: process.cwd(),
      __dirname: __dirname,
      HPC_TRANSFER_DIRECTORY: process.env.HPC_TRANSFER_DIRECTORY,
      targetDirectoryName: targetDirectoryName,
      cleanedTargetDirectoryName: cleanedTargetDirectoryName,
      dirRoot: dirRoot,
      withinTransferDirectory: dirRoot !== null,
      exists,
      isDirectory,
    });
  });

router
  .route("/directory-files")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;

    try {
      if (!process.env.HPC_TRANSFER_DIRECTORY) {
        throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
      }

      if (!targetDirectoryName || typeof targetDirectoryName !== "string") {
        throw new Error("Missing targetDirectoryName");
      }

      const cleanedTargetDirectoryName = cleanDirectoryName(targetDirectoryName);

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

      let dirExists = false;
      try {
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

      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          return res.status(404).send({
            error: `File not found: ${fileName}`,
            requestId,
          });
        }
      } catch (e) {
        return res.status(404).send({
          error: `File not found: ${fileName}`,
          requestId,
        });
      }

      // Write headers early and stream spaces to prevent reverse proxy timeout for large files
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
      res.status(200);
      res.flushHeaders(); // Send headers immediately

      let hasError = false;
      let calculatedMd5;
      try {
        calculatedMd5 = await calculateFileMd5(filePath, () => {
          res.write(' ');
          if (res.flush) res.flush(); // If compression middleware is used, flush it
        });
      } catch (err) {
        hasError = true;
        console.error(`[${requestId}] Error calculating MD5 mid-stream:`, err);
        res.write(JSON.stringify({
          error: `Failed to calculate MD5: ${err.message}`,
          requestId,
        }));
        res.end();
      }

      if (!hasError) {
        const normalizedExpected = expectedMd5.toLowerCase().trim();
        const matches = calculatedMd5 === normalizedExpected;

        res.write(JSON.stringify({
          fileName,
          expectedMd5: normalizedExpected,
          calculatedMd5,
          matches,
        }));
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
