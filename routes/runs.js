const express = require("express");
const router = express.Router();
const _path = require("path");

const Run = require("../models/Run");
const { isAuthenticated } = require("./middleware");
const {
  sortAdditionalFiles,
  sortReadFiles,
} = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, getActualFiles } = require("./_utils");

/**
 * GET /runs
 * Fetches all runs visible to the authenticated user, sorted by most recent.
 */
router
  .route("/runs")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      // Assuming iCanSee is a custom static method on the Run model.
      const runs = await Run.iCanSee(req.user)
        .populate("group")
        .sort("-createdAt")
        .exec();
      res.status(200).send({ runs });
    } catch (error) {
      handleError(res, error, 500, "Failed to retrieve runs.");
    }
  });

/**
 * GET /runs/names/:sampleId
 * Fetches all unique run names for a given sample.
 * Used for validation when creating new runs to prevent duplicate names.
 */
router
  .route("/runs/names/:sampleId")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { sampleId } = req.params;

    if (!sampleId) {
      return handleError(res, new Error("Sample ID not provided."), 400);
    }

    try {
      // Find all runs for this sample and get their names
      const runs = await Run.find({ sample: sampleId }).select("name").exec();

      // Extract names and filter out null/undefined/empty values
      const runNames = runs
        .map((run) => run.name)
        .filter((name) => name && name.trim() !== "");

      // Return unique names only
      const uniqueRunNames = [...new Set(runNames)];

      res.status(200).send({ runNames: uniqueRunNames });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to retrieve run names for sample ${sampleId}.`,
      );
    }
  });

/**
 * GET /run?id=:id
 * Fetches a single run by its ID, along with its associated data and files on disk.
 */
router
  .route("/run")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return handleError(res, new Error("Run ID not provided."), 400);
    }

    try {
      const run = await Run.findById(id)
        .populate("group")
        .populate("sample")
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .populate({ path: "rawFiles", populate: { path: "file" } })
        .exec();

      if (!run) {
        return handleError(res, new Error("Run not found."), 404);
      }

      // TODO: Add permission check to ensure user can view this run.

      const runDirectory = _path.join(process.env.DATASTORE_ROOT, run.path);
      const rawDir = _path.join(runDirectory, "raw");
      const additionalDir = _path.join(runDirectory, "additional");

      const [actualReads, actualAdditionalFiles] = await Promise.all([
        getActualFiles(rawDir),
        getActualFiles(additionalDir),
      ]);

      res.status(200).send({
        run,
        actualReads,
        actualAdditionalFiles,
      });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve run ${id}.`);
    }
  });

/**
 * POST /runs/new
 * Creates a new run, handles associated file uploads, and sends a notification email.
 */
router
  .route("/runs/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedRun; // To hold the created run document for potential rollback

    try {
      // TODO: Add permission check to ensure user can create a run for this sample/project.
      const {
        sample,
        name,
        sequencingProvider,
        sequencingTechnology,
        librarySource,
        libraryType,
        librarySelection,
        libraryStrategy,
        insertSize,
        owner,
        group,
      } = req.body;

      const newRun = new Run({
        sample,
        name,
        sequencingProvider,
        sequencingTechnology,
        librarySource,
        libraryType,
        librarySelection,
        libraryStrategy,
        insertSize: insertSize || null,
        owner,
        group,
      });

      savedRun = await newRun.save();

      const { additionalFiles, rawFiles, rawFilesUploadInfo } = req.body;
      const fileProcessingPromises = [];

      if (rawFiles && rawFiles.length > 0) {
        fileProcessingPromises.push(
          sortReadFiles(
            rawFiles,
            savedRun._id,
            savedRun.path,
            rawFilesUploadInfo,
          ),
        );
      }

      if (additionalFiles && additionalFiles.length > 0) {
        fileProcessingPromises.push(
          sortAdditionalFiles(
            additionalFiles,
            "run",
            savedRun._id,
            savedRun.path,
          ),
        );
      }

      if (fileProcessingPromises.length > 0) {
        await Promise.all(fileProcessingPromises);
      }

      // Email is sent after all database and file operations are successful.
      await sendOverseerEmail({ type: "Run", data: savedRun });

      res.status(201).send({ run: savedRun });
    } catch (error) {
      // If an error occurs after the run has been saved, we must roll back the change.
      if (savedRun && savedRun._id) {
        console.error(
          `An error occurred. Rolling back creation of run ${savedRun._id}.`,
        );
        await Run.deleteOne({ _id: savedRun._id });
        // Note: This does not clean up partially moved/created files.
        // A more robust transaction or cleanup mechanism would be needed for that.
      }

      if (error.name === "ValidationError") {
        return handleError(
          res,
          error,
          400,
          `Run validation failed: ${error.message}`,
        );
      }

      handleError(res, error, 500, "Failed to create new run.");
    }
  });

module.exports = router;
