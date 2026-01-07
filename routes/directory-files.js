const { isAuthenticated } = require("./middleware");
const _path = require("path");
const express = require("express");
const fs = require("fs");
const { calculateFileMd5 } = require("../lib/utils/md5");
const { generateRequestId } = require("./_utils");
let router = express.Router();

const cleanTargetDirectoryName = (targetDirectoryName) => {
  let result = targetDirectoryName;

  // remove beginning and trailing slashes
  if (result.startsWith("/")) {
    result = result.substr(1, result.length);
  }
  if (result.endsWith("/")) {
    result = result.substr(0, result.length - 1);
  }

  return result;
};

router
  .route("/directory-files/debug")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;
    const cleanedTargetDirectoryName = cleanTargetDirectoryName(
      targetDirectoryName || "cheese",
    );
    const dirRoot = _path.join(
      process.env.HPC_TRANSFER_DIRECTORY,
      cleanedTargetDirectoryName,
    );

    res.status(200).send({
      cwd: process.cwd(),
      __dirname: __dirname,
      HPC_TRANSFER_DIRECTORY: process.env.HPC_TRANSFER_DIRECTORY,
      targetDirectoryName: targetDirectoryName,
      cleanedTargetDirectoryName: cleanedTargetDirectoryName,
      dirRoot: dirRoot,
      isAbsolute: _path.isAbsolute(process.env.HPC_TRANSFER_DIRECTORY),
      resolvedPath: _path.resolve(dirRoot),
      exists: fs.existsSync(dirRoot),
      isDirectory: fs.existsSync(dirRoot) && fs.statSync(dirRoot).isDirectory(),
    });
  });

router
  .route("/directory-files")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;

    try {
      const cleanedTargetDirectoryName =
        cleanTargetDirectoryName(targetDirectoryName);

      const dirRoot = _path.resolve(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedTargetDirectoryName,
      );

      var dirExists = false;
      try {
        dirExists = fs.statSync(dirRoot).isDirectory();
      } catch (e) {
        throw new Error("Issue reading target directory");
      }
      if (!dirExists) {
        throw new Error("Directory does not exist");
      }

      const filesResults = fs.readdirSync(dirRoot);

      if (!filesResults.length) {
        throw new Error("No files found in target directory");
      }

      res.status(200).send({
        filesResults,
      });
    } catch (e) {
      console.error(e, e.message);
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
    const { directoryName, fileName, expectedMd5 } = req.body;

    if (!directoryName || !fileName || !expectedMd5) {
      return res.status(400).send({
        error: "Missing required fields: directoryName, fileName, expectedMd5",
        requestId,
      });
    }

    try {
      const cleanedDirectoryName = cleanTargetDirectoryName(directoryName);
      const filePath = _path.resolve(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedDirectoryName,
        fileName,
      );

      // Security check: ensure the resolved path is still within HPC_TRANSFER_DIRECTORY
      const hpcRoot = _path.resolve(process.env.HPC_TRANSFER_DIRECTORY);
      if (!filePath.startsWith(hpcRoot)) {
        console.error(
          `[${requestId}] Access denied: path traversal attempt - ${filePath}`,
        );
        return res.status(403).send({
          error: "Access denied: Invalid file path",
          requestId,
        });
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).send({
          error: `File not found: ${fileName}`,
          requestId,
        });
      }

      const calculatedMd5 = await calculateFileMd5(filePath);
      const normalizedExpected = expectedMd5.toLowerCase().trim();
      const matches = calculatedMd5 === normalizedExpected;

      res.status(200).send({
        fileName,
        expectedMd5: normalizedExpected,
        calculatedMd5,
        matches,
      });
    } catch (e) {
      console.error(`[${requestId}] Error calculating MD5:`, e);
      res.status(500).send({
        error: `Failed to calculate MD5: ${e.message}`,
        requestId,
      });
    }
  });

module.exports = router;
