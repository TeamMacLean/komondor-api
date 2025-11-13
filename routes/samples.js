const express = require("express");
const router = express.Router();
const _path = require("path");

const Sample = require("../models/Sample");
const { isAuthenticated } = require("./middleware");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, getActualFiles } = require("./_utils");

/**
 * GET /samples
 * Fetches all samples visible to the authenticated user, sorted by most recent.
 */
router
  .route("/samples")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      // Note: iCanSee is a custom static method on the Sample model.
      const samples = await Sample.iCanSee(req.user)
        .populate("group")
        .sort("-createdAt")
        .exec();
      res.status(200).send({ samples });
    } catch (error) {
      handleError(res, error, 500, "Failed to retrieve samples.");
    }
  });

/**
 * GET /sample?id=:id
 * Fetches a single sample by its ID, along with its associated data and files on disk.
 */
router
  .route("/sample")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return handleError(res, new Error("Sample ID not provided."), 400);
    }

    try {
      const sample = await Sample.findById(id)
        .populate("group")
        .populate("project")
        .populate({ path: "runs", populate: { path: "group" } })
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .exec();

      if (!sample) {
        return handleError(res, new Error("Sample not found."), 404);
      }

      // TODO: Add permission check to ensure user can view this sample.

      const additionalDir = _path.join(
        process.env.DATASTORE_ROOT,
        sample.path,
        "additional",
      );
      const actualAdditionalFiles = await getActualFiles(additionalDir);

      res.status(200).send({ sample, actualAdditionalFiles });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve sample ${id}.`);
    }
  });

/**
 * POST /samples/new
 * Creates a new sample, handles associated file uploads, and sends a notification email.
 */
router
  .route("/samples/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedSample; // To hold the created sample document for potential rollback

    try {
      const newSample = new Sample({
        name: req.body.name,
        project: req.body.project,
        scientificName: req.body.scientificName,
        commonName: req.body.commonName,
        ncbi: req.body.ncbi,
        conditions: req.body.conditions,
        owner: req.body.owner,
        group: req.body.group,
        tplexCsv: req.body.tplexCsv,
      });

      // Mongoose's pre-validate and pre-save hooks are triggered here.
      savedSample = await newSample.save();

      const { additionalFiles } = req.body;
      if (additionalFiles && additionalFiles.length > 0) {
        // This assumes that if tplexCsv is used, `additionalFiles` will be an empty array from the frontend.
        await sortAdditionalFiles(
          additionalFiles,
          "sample",
          savedSample._id,
          savedSample.path,
        );
      }

      // Email is sent after all database and file operations are successful.
      await sendOverseerEmail({ type: "Sample", data: savedSample });

      res.status(201).send({ sample: savedSample });
    } catch (error) {
      // If an error occurs after the sample has been saved, we must roll back the change.
      if (savedSample && savedSample._id) {
        console.error(
          `An error occurred. Rolling back creation of sample ${savedSample._id}.`,
        );
        await Sample.deleteOne({ _id: savedSample._id });
        // Note: This doesn't clean up partially moved files.
      }

      // Check for Mongoose validation error
      if (error.name === "ValidationError") {
        return handleError(
          res,
          error,
          400,
          `Sample validation failed: ${error.message}`,
        );
      }

      handleError(res, error, 500, "Failed to create new sample.");
    }
  });

module.exports = router;
