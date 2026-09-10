const express = require("express");
const mongoose = require("mongoose");
let router = express.Router();
const Project = require("../models/Project");
const Sample = require("../models/Sample");
const Run = require("../models/Run");
const Read = require("../models/Read");
const Group = require("../models/Group");
const { isAuthenticated, hasFullRecordsAccess } = require("./middleware");
const {
  hasFullRecordsAccess: userHasFullRecordsAccess,
} = require("../lib/utils/fullAccessUsers");
const _path = require("path");
const { handleError } = require("./_utils");
const {
  resolveStorageState,
  relativePathWithinProject,
  appendUri,
} = require("../lib/storage-state");

const ENTITY_TYPES = ["project", "sample", "run"];

const ENTITY_MODELS = {
  project: Project,
  sample: Sample,
  run: Run,
};

/**
 * True when `value` is an array and every element of it is a string.
 * @param {*} value - Candidate value from a request body.
 * @returns {boolean} True if `value` is a string array.
 */
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Who may write ENA accessions: the same ENA population as the /accessions/csv
 * export, not plain group membership — an accession is the identifier ENA
 * issues, written back only by the submission round-trip.
 * @param {object} req - The Express request.
 * @param {object} res - The Express response.
 * @param {Function} next - The next middleware.
 */
const requireAccessionWrite = (req, res, next) => {
  if (userHasFullRecordsAccess(req.user)) {
    return next();
  }

  const username = req.user && req.user.username;
  console.error(`[AUTHZ] Refused accession write to "${username}"`);
  return res.status(403).send({
    error: `User '${username}' does not have permission to modify accessions`,
  });
};

/**
 * Whether the group a record belongs to is still live. Not a capability check:
 * the capability is requireAccessionWrite above, and using a *read* check here
 * would authorise a write. `$ne: true`, not `false`, for pre-field documents.
 * @param {*} groupId - Group id taken from the record being written.
 * @returns {Promise<boolean>} True if the group exists and is not soft-deleted.
 */
const groupIsLive = async (groupId) => {
  if (!groupId) {
    return false;
  }

  const group = await Group.findOne({
    _id: groupId,
    deleted: { $ne: true },
  }).select("_id");

  return Boolean(group);
};

/**
 * Updates accessions for a given entity type.
 * @param {string} type - The entity type ('project', 'sample', or 'run')
 * @param {string[]} accessions - Array of accession strings
 * @param {string} typeId - The entity's MongoDB ID
 * @param {string} [releaseDate] - Optional release date (only for projects)
 * @returns {Promise<object>} The updated entity
 */
const updateEntityAccessions = async (
  type,
  accessions,
  typeId,
  releaseDate = null,
) => {
  const Model = ENTITY_MODELS[type];
  if (!Model) {
    throw new Error(`Invalid entity type: ${type}`);
  }

  const updateInfo = { accessions };
  if (type === "project" && releaseDate) {
    updateInfo.releaseDate = releaseDate;
  }

  const updatedEntity = await Model.findByIdAndUpdate(typeId, updateInfo, {
    new: true,
  });
  if (!updatedEntity) {
    throw new Error(`${type} with ID ${typeId} not found`);
  }
  return updatedEntity;
};

router
  .route("/accessions/new")
  .all(isAuthenticated)
  .all(requireAccessionWrite)
  .post(async (req, res) => {
    const { accessions, releaseDate, type, typeId } = req.body || {};

    // `.includes` on a fixed list, not a lookup: type "constructor" would find
    // a truthy value on Object.prototype.
    if (typeof type !== "string" || !ENTITY_TYPES.includes(type)) {
      return res.status(400).send({
        error: "Invalid or missing type. Must be project, sample, or run.",
      });
    }

    if (!typeId) {
      return res.status(400).send({ error: "Missing typeId" });
    }

    // The string check is not redundant: `findById({ $ne: null })` is read as a
    // query condition, not a cast failure, and matches an arbitrary record.
    if (
      typeof typeId !== "string" ||
      !mongoose.Types.ObjectId.isValid(typeId)
    ) {
      return res.status(400).send({ error: "typeId is not a valid ID" });
    }

    if (!isStringArray(accessions)) {
      return res
        .status(400)
        .send({ error: "accessions must be an array of strings" });
    }

    if (
      releaseDate !== undefined &&
      releaseDate !== null &&
      typeof releaseDate !== "string"
    ) {
      return res.status(400).send({ error: "releaseDate must be a string" });
    }

    try {
      // Loaded before writing so the record's group can be checked first.
      const entity = await ENTITY_MODELS[type].findById(typeId);

      if (!entity) {
        return res
          .status(404)
          .send({ error: `${type} with ID ${typeId} not found` });
      }

      // The capability was settled by requireAccessionWrite; all that is left
      // is whether the record's group is still live.
      if (!(await groupIsLive(entity.group))) {
        console.error(
          `[AUTHZ] Refused accession write on ${type} ${typeId} (group ${entity.group}) to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to modify accessions for this ${type}`,
        });
      }

      await updateEntityAccessions(type, accessions, typeId, releaseDate);
      res.status(200).send();
    } catch (error) {
      const statusCode = error.message.includes("not found") ? 404 : 500;
      res.status(statusCode).send({ error: error.message });
    }
  });

const getMatrixOfData = async () => {
  const runsWithSamplesAndGroups = await Run.find({})
    .populate("sample")
    .populate("group");

  const projects = await Project.find({});
  const reads = await Read.find({}).populate("file");

  const projectsById = projects.reduce((acc, p) => {
    acc[p._id.toString()] = p;
    return acc;
  }, {});

  const result = runsWithSamplesAndGroups
    .map((runPlus) => {
      // An orphaned run cannot produce a row; skipping keeps the export working.
      if (!runPlus.sample || !runPlus.sample.project) {
        console.error(
          `Run ${runPlus._id} has no populated sample/project; skipping`,
        );
        return null;
      }

      if (!runPlus.group) {
        console.error(`Run ${runPlus._id} has no populated group; skipping`);
        return null;
      }

      const runsProjIdStr = runPlus.sample.project.toString();
      const targetProjectObj = projectsById[runsProjIdStr];

      if (!targetProjectObj) {
        console.error(
          `Project not found for run ${runPlus._id}: project ID ${runsProjIdStr}`,
        );
        return null;
      }

      const relatedReads = reads.filter((read) => {
        return read.run && read.run.toString() === runPlus._id.toString();
      });

      const relatedReadsPaths = relatedReads
        .filter((read) => read.file && read.file.path)
        .map((read) => {
          const filePath = read.file.path;
          const storage = resolveStorageState(targetProjectObj);

          if (storage.authoritativeLocation === "hpc") {
            const readsRootPath =
              process.env.READS_ROOT_PATH || "/tsl/data/reads";
            return _path.posix.join(
              readsRootPath,
              String(filePath).replace(/^\/+/, ""),
            );
          }

          if (storage.authoritativeLocation === "s3") {
            const relative = relativePathWithinProject(
              targetProjectObj,
              filePath,
            );
            if (relative !== null) {
              return appendUri(targetProjectObj.storage.s3Uri, relative);
            }
          }

          console.warn(
            `[accessions/csv] Could not resolve authoritative storage URI for File ${read.file._id || "unknown"} (${filePath}) in Project ${targetProjectObj._id}`,
          );
          return `unresolved:${filePath}`;
        });
      const relatedReadsPathsString = relatedReadsPaths.join(";");

      return [
        runPlus.group.safeName,
        runPlus.owner,
        targetProjectObj.releaseDate,
        targetProjectObj.safeName,
        runsProjIdStr,
        (targetProjectObj.accessions || []).join(";"),
        runPlus.sample.safeName,
        runPlus.sample._id.toString(),
        (runPlus.sample.accessions || []).join(";"),
        runPlus.safeName,
        runPlus._id.toString(),
        (runPlus.accessions || []).join(";"),
        runPlus.createdAt,
        relatedReadsPathsString,
      ];
    })
    .filter(Boolean); // Filter out null entries from missing projects

  return result;
};

// Spreadsheet software evaluates a cell starting with one of these, and this
// CSV is built from user-controlled names. Kept identical to routes/samples.js.
const FORMULA_START = /^[=+\-@\t\r]/;

// ...but a signed number is data, not a formula, and quoting it would break
// consumers reading the column as numeric.
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Renders one value as a CSV field: quoted when it contains a delimiter, and
 * neutralised when a spreadsheet would otherwise execute it.
 * @param {*} value - The raw field value.
 * @returns {string} A CSV-safe field.
 */
const toCsvField = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  // String(value), not a nicer date format: consumers parse what Array#join
  // already produced.
  const stringValue = String(value);

  if (FORMULA_START.test(stringValue) && !PLAIN_NUMBER.test(stringValue)) {
    // Prefixed *and* quoted: the apostrophe stops evaluation, the quotes keep a
    // leading tab or CR from splitting the row.
    return `"'${stringValue.replace(/"/g, '""')}"`;
  }

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

const HEADINGS = [
  "group",
  "owner",
  "ena_project_submission_date",
  "project_name",
  "project_id",
  "project_accession",
  "sample_name",
  "sample_id",
  "sample_accession",
  "run_name",
  "run_id",
  "run_accession",
  "run_creation_date",
  "list_of_read_files",
];

// Returns every run in the database by design, so it is gated on the same
// predicate as cross-group reads.
router
  .route("/accessions/csv")
  .all(isAuthenticated)
  .all(hasFullRecordsAccess)
  .get(async (req, res) => {
    try {
      // The heading row keeps its trailing comma: consumers parse that format.
      let csv = HEADINGS.join(",") + ",\n";

      const matrixOfData = await getMatrixOfData();

      //merge the data with CSV
      matrixOfData.forEach(function (row) {
        csv += row.map(toCsvField).join(",");
        csv += "\n";
      });

      res.status(200).send({ csv });
    } catch (error) {
      handleError(res, error, 500, "Failed to build accessions CSV.");
    }
  });

module.exports = router;
