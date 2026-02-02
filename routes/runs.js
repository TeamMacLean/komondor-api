const express = require("express");
const router = express.Router();
const _path = require("path");

const Run = require("../models/Run");
const Sample = require("../models/Sample");
const Group = require("../models/Group");
const { isAuthenticated } = require("./middleware");
const {
  sortAdditionalFiles,
  sortReadFiles,
} = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, getActualFiles, generateRequestId } = require("./_utils");
const { verifyRunMd5 } = require("../lib/md5-verification");

/**
 * Helper to check if user has access to a resource via group membership
 */
async function userCanAccessGroup(user, groupId) {
  if (user.isAdmin) return true;
  const userGroups = await Group.GroupsIAmIn(user);
  return userGroups.some((g) => g._id.toString() === groupId.toString());
}

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

      // Permission check: user must belong to the run's group or be admin
      const canAccess = await userCanAccessGroup(req.user, run.group._id);
      if (!canAccess) {
        return handleError(
          res,
          new Error("You do not have permission to view this run."),
          403,
        );
      }

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
 * Validates the request body for creating a new run.
 * @param {object} body - The request body
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
const validateNewRunRequest = (body) => {
  const errors = [];
  const required = [
    "sample",
    "name",
    "sequencingProvider",
    "sequencingTechnology",
    "librarySource",
    "libraryType",
    "librarySelection",
    "libraryStrategy",
    "owner",
    "group",
  ];

  // Check required fields
  for (const field of required) {
    if (!body[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate name length
  if (body.name && (body.name.length < 3 || body.name.length > 80)) {
    errors.push("Run name must be between 3 and 80 characters");
  }

  // Validate rawFiles
  if (!body.rawFiles || body.rawFiles.length === 0) {
    errors.push("At least one raw file is required");
  }

  // Validate rawFilesUploadInfo
  if (!body.rawFilesUploadInfo || !body.rawFilesUploadInfo.method) {
    errors.push("Upload method is required (rawFilesUploadInfo.method)");
  } else if (
    !["hpc-mv", "local-filesystem"].includes(body.rawFilesUploadInfo.method)
  ) {
    errors.push(
      "Invalid upload method. Must be 'hpc-mv' or 'local-filesystem'",
    );
  }

  // For HPC uploads, validate relativePath
  if (body.rawFilesUploadInfo?.method === "hpc-mv") {
    if (
      !body.rawFilesUploadInfo.relativePath &&
      !body.rawFiles?.[0]?.relativePath
    ) {
      errors.push("HPC uploads require a relativePath");
    }
  }

  // Validate each raw file has required properties
  if (body.rawFiles && Array.isArray(body.rawFiles)) {
    body.rawFiles.forEach((file, index) => {
      const fileName = file.name || file.data?.name;
      if (!fileName) {
        errors.push(`Raw file at index ${index} is missing a name`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
};

/**
 * POST /runs/new
 * Creates a new run, handles associated file uploads, and sends a notification email.
 */
router
  .route("/runs/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedRun; // To hold the created run document for potential rollback
    const requestId = generateRequestId();

    try {
      // Validate request body before proceeding
      const validation = validateNewRunRequest(req.body);
      if (!validation.valid) {
        console.error(`[${requestId}] Validation failed:`, validation.errors);
        return handleError(
          res,
          new Error(validation.errors.join("; ")),
          400,
          `Validation failed: ${validation.errors.join("; ")}`,
          requestId,
        );
      }

      // Permission check: user must belong to the target group
      const canCreate = await userCanAccessGroup(req.user, req.body.group);
      if (!canCreate) {
        return handleError(
          res,
          new Error(
            "You do not have permission to create a run in this group.",
          ),
          403,
          "Permission denied",
          requestId,
        );
      }
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

      // Check for existing run with same name and sample (idempotency)
      const existingRun = await Run.findOne({ sample, name }).populate(
        "rawFiles additionalFiles",
      );

      if (existingRun) {
        console.log(
          `[${requestId}] Run already exists: ${existingRun._id} (${existingRun.name})`,
        );
        // Return existing run (silent idempotency - 200 OK)
        return res.status(200).send({
          run: existingRun,
          idempotent: true,
          message: "Run with this name already exists for this sample",
        });
      }

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

      // Trigger immediate MD5 verification in background (non-blocking)
      setImmediate(() => {
        verifyRunMd5(savedRun._id).catch((error) => {
          console.error(
            `[${requestId}] Failed to verify MD5 for run ${savedRun._id}:`,
            error,
          );
        });
      });

      res.status(201).send({ run: savedRun });
    } catch (error) {
      // If an error occurs after the run has been saved, we must roll back the change.
      if (savedRun && savedRun._id) {
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
          requestId,
        );
      }

      handleError(
        res,
        error,
        500,
        `Failed to create new run: ${error.message}`,
        requestId,
      );
    }
  });

/**
 * GET /runs/:id/status
 * Returns detailed status information about a run, including MD5 verification progress.
 */
router
  .route("/runs/:id/status")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const requestId = generateRequestId();

    try {
      const run = await Run.findById(req.params.id)
        .populate("rawFiles")
        .populate("additionalFiles");

      if (!run) {
        return handleError(
          res,
          new Error("Run not found"),
          404,
          "Run not found",
          requestId,
        );
      }

      // Permission check
      const canAccess = await userCanAccessGroup(req.user, run.group);
      if (!canAccess) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          "You do not have permission to view this run",
          requestId,
        );
      }

      // Get raw files with MD5 verification details
      const Read = require("../models/Read");
      const reads = await Read.find({ run: run._id }).populate("file");

      const md5Details = reads.map((read) => ({
        fileName: read.file?.originalName,
        md5Original: read.MD5,
        md5Destination: read.destinationMd5,
        md5Mismatch: read.md5Mismatch,
        lastChecked: read.MD5LastChecked,
      }));

      const totalFiles = reads.length;
      const verifiedFiles = reads.filter((r) => r.destinationMd5).length;
      const mismatchedFiles = reads.filter(
        (r) => r.md5Mismatch === true,
      ).length;

      res.status(200).send({
        runId: run._id,
        runName: run.name,
        status: run.status,
        md5VerificationStatus: run.md5VerificationStatus,
        md5VerificationAttempts: run.md5VerificationAttempts,
        md5VerificationLastAttempt: run.md5VerificationLastAttempt,
        md5VerificationCompletedAt: run.md5VerificationCompletedAt,
        progress: {
          totalFiles,
          verifiedFiles,
          mismatchedFiles,
          percentComplete:
            totalFiles > 0
              ? Math.round((verifiedFiles / totalFiles) * 100)
              : 100,
        },
        files: md5Details,
      });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to get run status: ${error.message}`,
        requestId,
      );
    }
  });

/**
 * POST /runs/batch-status
 * Returns status information for multiple runs at once.
 * Body: { runIds: [...] }
 */
router
  .route("/runs/batch-status")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const requestId = generateRequestId();

    try {
      const { runIds } = req.body;

      if (!runIds || !Array.isArray(runIds)) {
        return handleError(
          res,
          new Error("Invalid request"),
          400,
          "runIds must be an array",
          requestId,
        );
      }

      if (runIds.length > 100) {
        return handleError(
          res,
          new Error("Too many runs requested"),
          400,
          "Maximum 100 runs per request",
          requestId,
        );
      }

      const runs = await Run.find({ _id: { $in: runIds } }).select(
        "_id name status md5VerificationStatus md5VerificationAttempts md5VerificationLastAttempt md5VerificationCompletedAt group createdAt",
      );

      // Filter to only runs the user has access to
      const accessibleRuns = [];
      for (const run of runs) {
        const canAccess = await userCanAccessGroup(req.user, run.group);
        if (canAccess) {
          accessibleRuns.push({
            runId: run._id,
            runName: run.name,
            status: run.status,
            md5VerificationStatus: run.md5VerificationStatus,
            md5VerificationAttempts: run.md5VerificationAttempts,
            md5VerificationLastAttempt: run.md5VerificationLastAttempt,
            md5VerificationCompletedAt: run.md5VerificationCompletedAt,
            createdAt: run.createdAt,
          });
        }
      }

      res.status(200).send({
        runs: accessibleRuns,
        total: accessibleRuns.length,
      });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to get batch status: ${error.message}`,
        requestId,
      );
    }
  });

module.exports = router;
