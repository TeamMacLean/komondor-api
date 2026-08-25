const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const _path = require("path");

const Sample = require("../models/Sample");
const Project = require("../models/Project");
const { isAuthenticated } = require("./middleware");
const { canReadGroup, canWriteGroup } = require("../lib/utils/groupAccess");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const {
  visibleGroupIds,
} = require("../lib/utils/fullAccessUsers");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, compareFilesToDirectory } = require("./_utils");

/**
 * Whether a request value is safe to use as an id in a query.
 * Every request value reaching a query goes through this: mongoose preserves
 * operators, so `{"$ne": null}` would survive casting as a query condition.
 * @param {*} value - The raw request value.
 * @returns {boolean} True if the value is a 24-character hex ObjectId string.
 */
const isObjectIdString = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{24}$/.test(value) &&
  mongoose.Types.ObjectId.isValid(value);

/**
 * The group id of a document whose `group` ref may or may not be populated.
 * @param {object} doc - A document with a `group` field.
 * @returns {*} The group id, or null when there is no group.
 */
const groupIdOf = (doc) => {
  const group = doc && doc.group;

  if (!group) {
    return null;
  }

  return group._id || group;
};

// Spreadsheet software evaluates a cell starting with one of these, so
// submitted rows are neutralised on their way into the stored CSV.
const FORMULA_START = /^[=+\-@\t\r]/;

// ...but a signed number is data, not a formula: TPlex conditions carry "-80"
// and "+4", and quoting those would break consumers reading the column numeric.
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Renders one TPlex value as a CSV field, quoting and neutralising as needed.
 * @param {*} value - The raw value from the submitted row.
 * @returns {string} A CSV-safe field.
 */
const toCsvField = (value) => {
  // `||`, not `??`: consumers already parse the CSV this handler produced for
  // falsy values.
  const text = (value || "").toString();

  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    // Prefixed *and* quoted: the apostrophe stops evaluation, the quotes keep a
    // leading tab or CR from splitting the row.
    return `"'${text.replace(/"/g, '""')}"`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

/**
 * The name a TPlex sample gets when the client does not supply one: scientific
 * name, then common name, then name, then a timestamp. Candidates are type-
 * checked because .trim() on a number from the CSV throws.
 * @param {object} firstRow - The first row of the submitted TPlex CSV.
 * @returns {string} The generated sample name.
 */
const generateTplexName = (firstRow) => {
  const candidate = [
    firstRow.scientificName,
    firstRow.commonName,
    firstRow.name,
  ].find((value) => typeof value === "string" && value.trim() !== "");

  return candidate
    ? `TPlex_${candidate.replace(/\s+/g, "_")}`
    : `TPlex_Sample_${Date.now()}`;
};

/**
 * GET /samples
 * Fetches all samples visible to the authenticated user, sorted by most recent.
 */
router
  .route("/samples")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      const groupIds = await visibleGroupIds(req.user);
      const samples = await Sample.iCanSee(req.user, groupIds)
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

    if (!isObjectIdString(projectId)) {
      return handleError(res, new Error('"projectId" is not a valid ID'), 400);
    }

    try {
      // Lists every sample name in the project, so it needs the same
      // authorisation as any other read of that project's records.
      const project = await Project.findById(projectId);

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      const canSee = await canReadGroup(req.user, groupIdOf(project));
      if (!canSee) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to view this project's samples.`,
          ),
          403,
        );
      }

      const samples = await Sample.find({ project: projectId })
        .select("name")
        .exec();

      const sampleNames = samples
        .map((sample) => sample.name)
        .filter((name) => name && name.trim() !== "");

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

    if (!isObjectIdString(id)) {
      return handleError(res, new Error('"id" is not a valid ID'), 400);
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

      // Group membership is the whole test; no owner fallback (see
      // lib/utils/groupAccess).
      const canAccess = await canReadGroup(req.user, groupIdOf(sample));
      if (!canAccess) {
        return handleError(
          res,
          new Error(`User '${req.user.username}' does not have permission to view this sample.`),
          403,
        );
      }

      const additionalDir = _path.join(
        process.env.DATASTORE_ROOT,
        sample.path,
        "additional",
      );
      const {
        actualFiles: actualAdditionalFiles,
        status: additionalFilesStatus,
      } = await compareFilesToDirectory(sample.additionalFiles, additionalDir);

      res.status(200).send({ sample, actualAdditionalFiles, additionalFilesStatus });
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
      const body = req.body || {};
      const { tplexCsv, additionalFiles } = body;
      const projectId = body.project;

      if (!body.group) {
        return handleError(res, new Error("Group ID is required."), 400);
      }

      if (!projectId) {
        return handleError(res, new Error("Project ID is required."), 400);
      }

      // Only values reaching a query or an authorisation decision are narrowed;
      // the descriptive fields are left to mongoose casting.
      if (!isObjectIdString(projectId)) {
        return handleError(res, new Error('"project" is not a valid ID'), 400);
      }

      if (!isObjectIdString(body.group)) {
        return handleError(res, new Error('"group" is not a valid ID'), 400);
      }

      if (body.name != null && typeof body.name !== "string") {
        return handleError(res, new Error('"name" must be a string'), 400);
      }

      const isTplexSample = Array.isArray(tplexCsv) && tplexCsv.length > 0;

      if (
        isTplexSample &&
        !tplexCsv.every(
          (row) => row && typeof row === "object" && !Array.isArray(row),
        )
      ) {
        return handleError(
          res,
          new Error("tplexCsv rows must be objects."),
          400,
        );
      }

      const project = await Project.findById(projectId);

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      // The parent project's group, not the submitted one: otherwise a member
      // of group A can hang a sample off group B's project.
      const groupId = groupIdOf(project);

      if (!groupId) {
        return handleError(
          res,
          new Error("Project has no group and cannot take new samples."),
          500,
        );
      }

      // Write capability, not read: a cross-group reader must not create here.
      const canCreate = await canWriteGroup(req.user, groupId);
      if (!canCreate) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to create a sample in this group.`,
          ),
          403,
        );
      }

      // After the permission check, so an unauthorised caller always gets the
      // same 403 and learns nothing about which group owns the project.
      if (body.group.toString() !== groupId.toString()) {
        return handleError(
          res,
          new Error("The submitted group does not own the submitted project."),
          400,
        );
      }

      let sampleName = body.name;

      if (isTplexSample && (!sampleName || sampleName.trim() === "")) {
        sampleName = generateTplexName(tplexCsv[0]);
      }

      // Idempotency: an existing sample of the same name is returned as-is.
      if (sampleName) {
        const existingSample = await Sample.findOne({
          project: projectId,
          name: sampleName,
        }).populate("additionalFiles");

        if (existingSample) {
          // Returning the populated existing sample is a read, so authorise it.
          const canSeeExisting = await canReadGroup(
            req.user,
            groupIdOf(existingSample),
          );

          if (!canSeeExisting) {
            return handleError(
              res,
              new Error(
                `User '${req.user.username}' does not have permission to view this sample.`,
              ),
              403,
            );
          }

          console.log(
            `Sample already exists: ${existingSample._id} (${existingSample.name})`,
          );
          return res.status(200).send({
            sample: existingSample,
            idempotent: true,
            message: "Sample with this name already exists for this project",
          });
        }
      }

      if (isTplexSample) {
        // Stored as CSV text for compatibility with the old format.
        const headers = Object.keys(tplexCsv[0]);

        const headerRow = headers.map(toCsvField).join(",");

        const dataRows = tplexCsv.map((row) =>
          headers.map((header) => toCsvField(row[header])).join(","),
        );

        const tplexCsvText = [headerRow, ...dataRows].join("\r\n");

        const newSample = new Sample({
          name: sampleName,
          project: projectId,
          scientificName: null, // TPlex samples don't have individual values
          commonName: null,
          ncbi: null,
          conditions: null,
          // From the session, never the body.
          owner: req.user.username,
          group: groupId,
          tplexCsv: tplexCsvText, // Store as CSV text (compatible with old format)
        });

        savedSample = await newSample.save();
        console.log(
          `Created TPlex sample with ${tplexCsv.length} rows of data`,
        );
      } else {
        const newSample = new Sample({
          name: sampleName,
          project: projectId,
          scientificName: body.scientificName,
          commonName: body.commonName,
          ncbi: body.ncbi,
          conditions: body.conditions,
          // From the session, never the body.
          owner: req.user.username,
          group: groupId,
          tplexCsv: null, // Not a TPlex sample
        });

        savedSample = await newSample.save();

        if (Array.isArray(additionalFiles) && additionalFiles.length > 0) {
          await sortAdditionalFiles(
            additionalFiles,
            "sample",
            savedSample._id,
            savedSample.path,
            req.user.username,
          );
        }
      }

      res.status(201).send({ sample: savedSample });

      // After the response, non-blocking: a failed email must not fail the save.
      sendOverseerEmail({ type: "Sample", data: savedSample }).catch((err) => {
        console.error(
          `Failed to send overseer email for sample ${savedSample._id}:`,
          err,
        );
      });
    } catch (error) {
      // Roll back a sample already saved when a later step failed.
      if (savedSample && savedSample._id) {
        console.error(
          `An error occurred. Rolling back creation of sample ${savedSample._id}.`,
        );
        await Sample.deleteOne({ _id: savedSample._id });
        // Does not clean up partially moved files.
      }

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
