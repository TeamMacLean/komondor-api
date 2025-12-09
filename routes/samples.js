const express = require("express");
const router = express.Router();
const _path = require("path");

const Sample = require("../models/Sample");
const Group = require("../models/Group");
const { isAuthenticated } = require("./middleware");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, getActualFiles } = require("./_utils");

/**
 * Helper to check if user has access to a resource via group membership
 */
async function userCanAccessGroup(user, groupId) {
  if (user.isAdmin) return true;
  const userGroups = await Group.GroupsIAmIn(user);
  return userGroups.some((g) => g._id.toString() === groupId.toString());
}

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
 * GET /samples/names/:projectId
 * Fetches all unique sample names for a given project.
 * Used for validation when creating new samples to prevent duplicate names.
 */
router
  .route("/samples/names/:projectId")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { projectId } = req.params;

    if (!projectId) {
      return handleError(res, new Error("Project ID not provided."), 400);
    }

    try {
      // Find all samples for this project and get their names
      const samples = await Sample.find({ project: projectId })
        .select("name")
        .exec();

      // Extract names and filter out null/undefined/empty values
      const sampleNames = samples
        .map((sample) => sample.name)
        .filter((name) => name && name.trim() !== "");

      // Return unique names only
      const uniqueSampleNames = [...new Set(sampleNames)];

      res.status(200).send({ sampleNames: uniqueSampleNames });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to retrieve sample names for project ${projectId}.`,
      );
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

      // Permission check: user must belong to the sample's group or be admin
      const canAccess = await userCanAccessGroup(req.user, sample.group._id);
      if (!canAccess) {
        return handleError(
          res,
          new Error("You do not have permission to view this sample."),
          403,
        );
      }

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
 * For TPlex samples, stores the CSV data as metadata in a single sample.
 */
router
  .route("/samples/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedSample; // To hold the created sample document for potential rollback

    try {
      // Permission check: user must belong to the target group
      if (!req.body.group) {
        return handleError(res, new Error("Group ID is required."), 400);
      }
      const canCreate = await userCanAccessGroup(req.user, req.body.group);
      if (!canCreate) {
        return handleError(
          res,
          new Error(
            "You do not have permission to create a sample in this group.",
          ),
          403,
        );
      }

      const { tplexCsv, additionalFiles } = req.body;

      // Determine if this is a TPlex sample
      const isTplexSample =
        tplexCsv && Array.isArray(tplexCsv) && tplexCsv.length > 0;

      // Generate a name for the sample
      let sampleName = req.body.name;

      if (isTplexSample) {
        // TPlex mode: Create ONE sample with CSV stored as metadata
        // Generate name from first CSV row if no name provided
        if (!sampleName || sampleName.trim() === "") {
          const firstRow = tplexCsv[0];
          if (
            firstRow.scientificName &&
            firstRow.scientificName.trim() !== ""
          ) {
            sampleName = `TPlex_${firstRow.scientificName.replace(/\s+/g, "_")}`;
          } else if (firstRow.commonName && firstRow.commonName.trim() !== "") {
            sampleName = `TPlex_${firstRow.commonName.replace(/\s+/g, "_")}`;
          } else if (firstRow.name && firstRow.name.trim() !== "") {
            sampleName = `TPlex_${firstRow.name.replace(/\s+/g, "_")}`;
          } else {
            sampleName = `TPlex_Sample_${Date.now()}`;
          }
        }

        // Convert JSON array to CSV text format for storage (backward compatibility)
        // Extract headers from first row
        const headers = Object.keys(tplexCsv[0]);

        // Create CSV header row
        const headerRow = headers.join(",");

        // Create CSV data rows
        const dataRows = tplexCsv.map((row) => {
          return headers
            .map((header) => {
              const value = row[header] || "";
              // Escape values that contain commas, quotes, or newlines
              if (
                value.toString().includes(",") ||
                value.toString().includes('"') ||
                value.toString().includes("\n")
              ) {
                return `"${value.toString().replace(/"/g, '""')}"`;
              }
              return value;
            })
            .join(",");
        });

        // Combine header and data rows
        const tplexCsvText = [headerRow, ...dataRows].join("\r\n");

        // Create single sample with entire CSV as metadata
        const newSample = new Sample({
          name: sampleName,
          project: req.body.project,
          scientificName: null, // TPlex samples don't have individual values
          commonName: null,
          ncbi: null,
          conditions: null,
          owner: req.body.owner,
          group: req.body.group,
          tplexCsv: tplexCsvText, // Store as CSV text (compatible with old format)
        });

        savedSample = await newSample.save();
        console.log(
          `Created TPlex sample with ${tplexCsv.length} rows of data`,
        );
      } else {
        // Standard single sample creation
        const newSample = new Sample({
          name: sampleName,
          project: req.body.project,
          scientificName: req.body.scientificName,
          commonName: req.body.commonName,
          ncbi: req.body.ncbi,
          conditions: req.body.conditions,
          owner: req.body.owner,
          group: req.body.group,
          tplexCsv: null, // Not a TPlex sample
        });

        savedSample = await newSample.save();

        // Handle additional file uploads (only for non-TPlex samples)
        if (additionalFiles && additionalFiles.length > 0) {
          await sortAdditionalFiles(
            additionalFiles,
            "sample",
            savedSample._id,
            savedSample.path,
          );
        }
      }

      // Email is sent after all database and file operations are successful
      await sendOverseerEmail({ type: "Sample", data: savedSample });

      res.status(201).send({ sample: savedSample });
    } catch (error) {
      // If an error occurs after the sample has been saved, we must roll back the change
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
