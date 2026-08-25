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
 *
 * Mongoose 5 casting preserves query operators, so a body of
 * `{"project": {"$ne": null}}` or a query string of `?id[$ne]=null` survives
 * casting intact and turns an equality lookup into "any document at all" —
 * which is how the idempotency lookup below used to hand a caller a populated
 * sample from a group they have never been in. Every value from req.body,
 * req.query or req.params that reaches a query is narrowed here first.
 *
 * `ObjectId.isValid` on its own is not that guard: it accepts *any* 12-character
 * string ("project-1234" passes) and casts it from its bytes, so the hex test is
 * what makes this a real check.
 *
 * @param {*} value - The raw request value.
 * @returns {boolean} True if the value is a 24-character hex ObjectId string.
 */
const isObjectIdString = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{24}$/.test(value) &&
  mongoose.Types.ObjectId.isValid(value);

/**
 * The group id of a document whose `group` ref may or may not be populated.
 *
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

// Spreadsheet software evaluates a cell whose first character is one of these,
// so a TPlex row carrying `=cmd|'/C calc'!A0` executes on the machine of
// whoever opens the exported CSV. The rows arrive in a request body, so they
// are neutralised as they are written into the stored CSV text.
const FORMULA_START = /^[=+\-@\t\r]/;

// ...but a leading sign in front of a plain number is data, not a formula:
// TPlex conditions carry values like "-80" and "+4". Those cannot execute
// anything, and forcing them to text would break any consumer reading the
// column as numeric, so they are left exactly as submitted.
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Renders one TPlex value as a CSV field: quoted where the content requires it,
 * and neutralised where a spreadsheet would otherwise execute it.
 *
 * @param {*} value - The raw value from the submitted row.
 * @returns {string} A CSV-safe field.
 */
const toCsvField = (value) => {
  // `|| ""` rather than `?? ""` to keep the original handler's behaviour for
  // falsy values, which consumers of the stored CSV already parse.
  const text = (value || "").toString();

  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    // Prefixed *and* quoted: the apostrophe is what stops the cell being
    // evaluated, the quotes keep a leading tab or CR inside the field instead
    // of letting it split the row.
    return `"'${text.replace(/"/g, '""')}"`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

/**
 * The name a TPlex sample gets when the client does not supply one.
 *
 * The fallback order — scientific name, then common name, then name, then a
 * timestamp — is unchanged, but each candidate is now type-checked: `.trim()`
 * on a number arriving in the CSV threw a TypeError that surfaced as a 500.
 *
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
      // Note: iCanSee is a custom static on the Sample model. The live group
      // ids are resolved first — see routes/projects.js.
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
      // This lists every sample name in the project, not only the caller's own,
      // so it is a cross-group read and has to be authorised like one. It was
      // previously open to any authenticated user for any project id.
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

      // Permission check: reading needs the *read* capability on the sample's
      // group, which is broader than the write capability used to create one.
      const canAccess = await canReadGroup(req.user, groupIdOf(sample));
      const isOwner = sample.owner === req.user.username;
      if (!canAccess && !isOwner) {
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

      // Only the values that reach a query (project, name) or an authorisation
      // decision (group) are narrowed here. `owner` is no longer among them:
      // it is taken from the session rather than the body, so there is nothing
      // client-supplied left to narrow. The descriptive fields are left to
      // mongoose casting,
      // which already refuses an object — and clients legitimately send `ncbi`
      // as a JSON number.
      if (!isObjectIdString(projectId)) {
        return handleError(res, new Error('"project" is not a valid ID'), 400);
      }

      if (!isObjectIdString(body.group)) {
        return handleError(res, new Error('"group" is not a valid ID'), 400);
      }

      if (body.name != null && typeof body.name !== "string") {
        return handleError(res, new Error('"name" must be a string'), 400);
      }

      // Determine if this is a TPlex sample
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

      // The sample's group is the parent project's group, not the submitted
      // one. The handler used to authorise req.body.group and then store it
      // without ever checking that the submitted project belonged to that
      // group, so a member of group A could hang a sample off group B's
      // project simply by naming their own group.
      const groupId = groupIdOf(project);

      if (!groupId) {
        return handleError(
          res,
          new Error("Project has no group and cannot take new samples."),
          500,
        );
      }

      // Permission check: creating is a write, so a cross-group *reader*
      // (FULL_RECORDS_ACCESS_USERS) is refused here even though the same person
      // may read the project's samples.
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

      // Deliberately after the permission check: a caller with no access to the
      // project's group always gets the same 403 and so learns nothing about
      // which group owns a project they cannot see.
      if (body.group.toString() !== groupId.toString()) {
        return handleError(
          res,
          new Error("The submitted group does not own the submitted project."),
          400,
        );
      }

      // Generate a name for the sample
      let sampleName = body.name;

      if (isTplexSample && (!sampleName || sampleName.trim() === "")) {
        // TPlex mode: Create ONE sample with CSV stored as metadata.
        // Generate name from first CSV row if no name provided.
        sampleName = generateTplexName(tplexCsv[0]);
      }

      // Check for existing sample with same name and project (idempotency)
      if (sampleName) {
        const existingSample = await Sample.findOne({
          project: projectId,
          name: sampleName,
        }).populate("additionalFiles");

        if (existingSample) {
          // The existing sample is returned populated, so returning it is a
          // read and has to be authorised like one. It used to be handed back
          // on the strength of the lookup alone, which is what made the
          // operator injection above worth exploiting.
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
        // Convert JSON array to CSV text format for storage (backward compatibility)
        // Extract headers from first row
        const headers = Object.keys(tplexCsv[0]);

        // Create CSV header row
        const headerRow = headers.map(toCsvField).join(",");

        // Create CSV data rows
        const dataRows = tplexCsv.map((row) =>
          headers.map((header) => toCsvField(row[header])).join(","),
        );

        // Combine header and data rows
        const tplexCsvText = [headerRow, ...dataRows].join("\r\n");

        // Create single sample with entire CSV as metadata
        const newSample = new Sample({
          name: sampleName,
          project: projectId,
          scientificName: null, // TPlex samples don't have individual values
          commonName: null,
          ncbi: null,
          conditions: null,
          // The session, never the body: `owner` was an unvalidated client
          // string naming whoever the caller liked.
          owner: req.user.username,
          group: groupId,
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
          project: projectId,
          scientificName: body.scientificName,
          commonName: body.commonName,
          ncbi: body.ncbi,
          conditions: body.conditions,
          // The session, never the body: `owner` was an unvalidated client
          // string naming whoever the caller liked.
          owner: req.user.username,
          group: groupId,
          tplexCsv: null, // Not a TPlex sample
        });

        savedSample = await newSample.save();

        // Handle additional file uploads (only for non-TPlex samples)
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

      // Send email after response (non-blocking)
      sendOverseerEmail({ type: "Sample", data: savedSample }).catch((err) => {
        console.error(
          `Failed to send overseer email for sample ${savedSample._id}:`,
          err,
        );
      });
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
