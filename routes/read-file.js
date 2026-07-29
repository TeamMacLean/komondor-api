const { isAuthenticated } = require("./middleware");
const express = require("express");
const fs = require("fs").promises;
let router = express.Router();

const { cleanDirectoryName, resolveBelow } = require("../lib/utils/safePath");

// Files served by this endpoint are small text artefacts (logs, manifests).
// Reading an arbitrarily large file into memory would stall the event loop and
// risk exhausting the heap, so anything above this is refused.
const MAX_READABLE_BYTES = 5 * 1024 * 1024;

router
  .route("/read-file")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName, filename } = req.query;

    try {
      if (!targetDirectoryName || !filename) {
        throw new Error("Missing targetDirectoryName or filename");
      }

      if (typeof targetDirectoryName !== "string" || typeof filename !== "string") {
        throw new Error("targetDirectoryName and filename must be strings");
      }

      if (!process.env.HPC_TRANSFER_DIRECTORY) {
        throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
      }

      const cleanedTargetDirectoryName = cleanDirectoryName(targetDirectoryName);

      // The previous implementation used path.join, which treats a leading
      // slash on the filename as a plain separator. Stripping it keeps those
      // callers working; "../" traversal is still refused below.
      const cleanedFilename = cleanDirectoryName(filename);

      if (!cleanedTargetDirectoryName || !cleanedFilename) {
        throw new Error("Missing targetDirectoryName or filename");
      }

      // resolveBelow returns null when the requested path escapes the transfer
      // directory — via "../" segments or an absolute path that would otherwise
      // replace the root entirely in path.resolve — or resolves to the root.
      const filePath = resolveBelow(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedTargetDirectoryName,
        cleanedFilename,
      );

      if (!filePath) {
        console.error(
          `[read-file] Rejected path outside transfer directory: ${targetDirectoryName}/${filename}`,
        );
        return res.status(403).send({ error: "Access denied: Invalid file path" });
      }

      let fileStat;
      try {
        fileStat = await fs.stat(filePath);
      } catch (e) {
        throw new Error("File does not exist");
      }

      if (!fileStat.isFile()) {
        throw new Error("Requested path is not a file");
      }

      if (fileStat.size > MAX_READABLE_BYTES) {
        throw new Error(
          `File is too large to read (${fileStat.size} bytes, limit ${MAX_READABLE_BYTES})`,
        );
      }

      const fileContent = await fs.readFile(filePath, "utf8");

      res.status(200).send(fileContent);
    } catch (e) {
      console.error("[read-file]", e.message);
      // Preserved from the original implementation: consuming services detect
      // failure by the presence of `error` in the body, not by status code.
      res.status(200).send({ error: e.message });
    }
  });

module.exports = router;
