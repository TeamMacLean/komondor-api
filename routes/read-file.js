const { isAuthenticated } = require("./middleware");
const express = require("express");
const fs = require("fs").promises;
const { constants: fsConstants } = require("fs");
let router = express.Router();

const {
  cleanDirectoryName,
  resolveBelow,
  assertWithinReal,
} = require("../lib/utils/safePath");
const {
  auditHpcAccess,
  requireAnyGroupMembership,
} = require("../lib/utils/hpcAudit");

// Files served by this endpoint are small text artefacts (logs, manifests).
// Reading an arbitrarily large file into memory would stall the event loop and
// risk exhausting the heap, so anything above this is refused.
const MAX_READABLE_BYTES = 5 * 1024 * 1024;

router
  .route("/read-file")
  .all(isAuthenticated)
  .all(requireAnyGroupMembership())
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

      // resolveBelow above is purely lexical, and that is not enough here.
      // Unprivileged HPC users write into the transfer directory by design —
      // that is the whole "hpc-mv" upload method — so any of them can plant
      // "<root>/theirgroup/leak.txt -> /etc/shadow". The string never leaves
      // the root, but the read does. lib/file-utils.js already resolves
      // symlinks against this same root on the write path; the read path has
      // to as well. Kept in this order because resolveBelow also supplies the
      // root-identity refusal and a cheap reject before touching the disk.
      if (
        !(await assertWithinReal(process.env.HPC_TRANSFER_DIRECTORY, filePath))
      ) {
        console.error(
          `[read-file] Rejected path escaping transfer directory via symlink: ${targetDirectoryName}/${filename}`,
        );
        return res.status(403).send({ error: "Access denied: Invalid file path" });
      }

      // O_NOFOLLOW refuses a symlink at the leaf itself, which the containment
      // check above deliberately does not cover, and holding one descriptor
      // across the stat and the read leaves no window in which the name could
      // be swapped for a link between the two calls.
      let handle;
      try {
        handle = await fs.open(
          filePath,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
      } catch (e) {
        throw new Error("File does not exist");
      }

      try {
        const fileStat = await handle.stat();

        if (!fileStat.isFile()) {
          throw new Error("Requested path is not a file");
        }

        if (fileStat.size > MAX_READABLE_BYTES) {
          throw new Error(
            `File is too large to read (${fileStat.size} bytes, limit ${MAX_READABLE_BYTES})`,
          );
        }

        const fileContent = await handle.readFile("utf8");

        auditHpcAccess({
          action: "read",
          user: req.user,
          path: filePath,
        });
        res.status(200).send(fileContent);
      } finally {
        await handle.close().catch(() => {});
      }
    } catch (e) {
      console.error("[read-file]", e.message);
      // Preserved from the original implementation: consuming services detect
      // failure by the presence of `error` in the body, not by status code.
      res.status(200).send({ error: e.message });
    }
  });

module.exports = router;
