const { isAuthenticated } = require("./middleware");
const _path = require("path");
const express = require("express");
const fs = require("fs");
let router = express.Router();

const cleanTargetDirectoryName = (targetDirectoryName) => {
  let result = targetDirectoryName;
  if (result.startsWith("/")) {
    result = result.substr(1);
  }
  if (result.endsWith("/")) {
    result = result.substr(0, result.length - 1);
  }
  return result;
};

router
  .route("/read-file")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName, filename } = req.query;
    try {
      if (!targetDirectoryName || !filename) {
        throw new Error("Missing targetDirectoryName or filename");
      }

      const cleanedTargetDirectoryName =
        cleanTargetDirectoryName(targetDirectoryName);
      const filePath = _path.join(
        process.env.HPC_TRANSFER_DIRECTORY,
        cleanedTargetDirectoryName,
        filename
      );

      // Check if file exists and is a file
      let fileStat;
      try {
        fileStat = fs.statSync(filePath);
      } catch (e) {
        throw new Error("File does not exist");
      }
      if (!fileStat.isFile()) {
        throw new Error("Requested path is not a file");
      }

      // Read the file contents in text mode
      const fileContent = fs.readFileSync(filePath, "utf8");

      // Return file content as plain text
      res.status(200).send(fileContent);
    } catch (e) {
      console.error(e, e.message);
      res.status(200).send({ error: e.message });
    }
  });

module.exports = router;
