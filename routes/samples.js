const express = require("express");
let router = express.Router();
const Sample = require("../models/Sample"); // Make sure this path is correct
const File = require("../models/File"); // Make sure this path is correct
const AdditionalFile = require("../models/AdditionalFile"); // Make sure this path is correct
const { isAuthenticated } = require("./middleware"); // Make sure this path is correct
const _path = require("path");
const fs = require("fs");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles"); // Make sure this path is correct
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail"); // Make sure this path is correct

router
  .route("/samples")
  .all(isAuthenticated)
  .get((req, res) => {
    //TODO must be in same group as user
    Sample.iCanSee(req.user)
      .populate("group")
      .sort("-createdAt")
      .then((samples) => {
        res.status(200).send({ samples });
      })
      .catch((err) => {
        res.status(500).send({ error: err });
      });
  });

router
  .route("/sample")
  .all(isAuthenticated)
  .get((req, res) => {
    if (req.query.id) {
      Sample.findById(req.query.id)
        .populate("group")
        .populate("project")
        .populate({ path: "runs", populate: { path: "group" } })
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .then((sample) => {
          //TODO check they have permissions
          if (sample) {
            try {
              const dirRoot = _path.join(
                process.env.DATASTORE_ROOT,
                sample.path,
              );
              const additionalDir = _path.join(dirRoot, "additional");

              fs.stat(additionalDir, function (err, stats) {
                if (err || !stats.isDirectory()) {
                  res.status(200).send({
                    sample: sample,
                    actualAdditionalFiles: [],
                  });
                } else {
                  fs.readdir(
                    additionalDir,
                    (additionalFilesErr, additionalFiles) => {
                      if (additionalFilesErr) {
                        throw new Error(additionalFilesErr);
                      }
                      res.status(200).send({
                        sample: sample,
                        actualAdditionalFiles: additionalFiles,
                      });
                    },
                  );
                }
              });
            } catch (e) {
              console.error(e, e.message);
              res.status(501).send({ error: "unexpected readdir error" });
            }
          } else {
            res.status(501).send({ error: "not found" });
          }
        })
        .catch((err) => {
          res.status(500).send({ error: err });
        });
    } else {
      res.status(500).send({ error: new Error("param :id not provided") });
    }
  });

router
  .route("/samples/new")
  .all(isAuthenticated)
  .post((req, res) => {
    const newSample = new Sample({
      name: req.body.name,
      project: req.body.project,
      scientificName: req.body.scientificName,
      commonName: req.body.commonName,
      ncbi: req.body.ncbi,
      conditions: req.body.conditions,
      owner: req.body.owner,
      group: req.body.group,
      // --- NEW: Add tplexCsv field ---
      tplexCsv: req.body.tplexCsv, // Mongoose will handle `null` or `undefined`
      // --- END NEW ---
    });

    let returnedSample;
    newSample
      .save()
      .then(async (savedSample) => {
        returnedSample = savedSample;
        const additionalFiles = req.body.additionalFiles;

        if (additionalFiles.length) {
          try {
            return await sortAdditionalFiles(
              additionalFiles,
              "sample",
              returnedSample._id,
              returnedSample.path,
            );
          } catch (e) {
            // if issue with files, remove newProject
            await Sample.deleteOne({ _id: returnedSample._id });
            return Promise.reject(e);
          }
        } else {
          return Promise.resolve();
        }
      })
      .then(() => {
        sendOverseerEmail({ type: "Sample", data: returnedSample }).then(
          (emailResult) => {
            res.status(200).send({ sample: returnedSample });
          },
        );
      })
      .catch((err) => {
        console.error("ERROR", err);
        res.status(500).send({ error: err });
      });
  });

module.exports = router;
