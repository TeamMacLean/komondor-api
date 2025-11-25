const { isAuthenticated } = require("./middleware");
const _path = require("path");
const express = require("express");
const fs = require("fs");
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

      console.log("directory to search", dirRoot);
      console.log("working directory:", process.cwd());
      console.log(
        "HPC_TRANSFER_DIRECTORY:",
        process.env.HPC_TRANSFER_DIRECTORY,
      );
      console.log("resolved path:", dirRoot);

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

module.exports = router;
