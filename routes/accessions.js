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

const ENTITY_TYPES = ["project", "sample", "run"];

const ENTITY_MODELS = {
  project: Project,
  sample: Sample,
  run: Run,
};

/**
 * True when `value` is an array and every element of it is a string.
 *
 * @param {*} value - The candidate value from a request body.
 * @returns {boolean} True if `value` is a string array.
 */
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Who may write ENA accessions.
 *
 * Deliberately the same population as the /accessions/csv export rather than
 * plain group membership. An accession is not the researcher's own metadata: it
 * is the identifier ENA issues, and the only thing that ever writes one back is
 * the submission round-trip run by the people named in FULL_RECORDS_ACCESS_USERS
 * — this route is the return leg of the export the same predicate already gates.
 * komondor-web agrees: components/AddAccessionModal.vue renders only for
 * `isEnaAdmin` (the web-side twin of that list), and its own comment says the
 * real check belongs here. Letting an ordinary group member set an accession
 * would let them point a public ENA record at the wrong data, through a field no
 * UI offers them.
 *
 * This wraps the shared predicate rather than reusing the `hasFullRecordsAccess`
 * middleware only because that middleware's 403 talks about exporting records,
 * which would be a confusing thing to read after a failed write.
 *
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
 * Whether the group a record belongs to is still live.
 *
 * This is not a capability check and must not be read as one. Authorisation for
 * an accession write is `requireAccessionWrite` above, which is deliberately
 * cross-group; what is left to decide per record is whether the group it sits in
 * still exists and has not been retired. routes/groups.js soft-deletes a group
 * by setting `deleted`, and a retired group must stop authorising writes into
 * records nobody can see any longer.
 *
 * It asks the Group collection directly rather than going through
 * `canReadGroup`, which is what used to stand here. For this route's callers —
 * who read across every group — canReadGroup answers exactly this question and
 * nothing else, so the two behave identically today; the difference is that a
 * *read* capability was being used to authorise a write, the one place in the
 * codebase where the split asserted throughout lib/utils/groupAccess.js did not
 * hold. Had `requireAccessionWrite` ever been widened, that stand-in would have
 * silently handed whoever it let through a cross-group write of `releaseDate`,
 * which drives ENA release. Asking the group cannot drift that way.
 *
 * `$ne: true` rather than `false` so groups written before the field existed
 * still count as live.
 *
 * @param {*} groupId - The group id taken from the record being written.
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

    // `.includes` on a fixed list rather than a lookup in ENTITY_MODELS: a body
    // sending type "constructor" would find a truthy value on Object.prototype.
    if (typeof type !== "string" || !ENTITY_TYPES.includes(type)) {
      return res.status(400).send({
        error: "Invalid or missing type. Must be project, sample, or run.",
      });
    }

    if (!typeId) {
      return res.status(400).send({ error: "Missing typeId" });
    }

    // The string check is not redundant. `findById({ $ne: null })` is not a
    // cast failure — mongoose reads the object as a query condition and matches
    // the first document whose _id is not null, i.e. an arbitrary record.
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
      // Load before writing. findByIdAndUpdate applied the change to whatever
      // the id named, in any group, with nothing in between to check first.
      const entity = await ENTITY_MODELS[type].findById(typeId);

      if (!entity) {
        return res
          .status(404)
          .send({ error: `${type} with ID ${typeId} not found` });
      }

      // Who may write an accession was settled by requireAccessionWrite, the
      // named ENA capability this route is gated on. All that is left is
      // whether the record's group is still live — see groupIsLive, which
      // explains why that is asked of the Group collection and not of a read
      // capability.
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

  // Build a map of project IDs to projects for efficient lookup
  const projectsById = projects.reduce((acc, p) => {
    acc[p._id.toString()] = p;
    return acc;
  }, {});

  const result = runsWithSamplesAndGroups
    .map((runPlus) => {
      // A run whose sample or group has been removed cannot produce a row.
      // Skipping it keeps the export working instead of failing the whole
      // request with a TypeError on the first orphan.
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

      // Use READS_ROOT_PATH from environment, defaulting to production path
      const readsRootPath = process.env.READS_ROOT_PATH || "/tsl/data/reads";
      const relatedReadsPaths = relatedReads
        .filter((read) => read.file && read.file.path)
        .map((read) => _path.join(readsRootPath, read.file.path));
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

// Spreadsheet software evaluates a cell whose first character is one of these.
// This endpoint is the one that actually produces a downloadable CSV, and it is
// built from project/sample/run names and accession strings that users control,
// so a name like `=cmd|'/C calc'!A0` would execute on the machine of whoever
// opens the export. Kept identical to routes/samples.js so the two agree.
const FORMULA_START = /^[=+\-@\t\r]/;

// ...but a leading sign in front of a plain number is data, not a formula.
// Forcing those to text would break any consumer reading a column as numeric.
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Renders one value as a CSV field: quoted when it contains a delimiter, and
 * neutralised when a spreadsheet would otherwise execute it.
 *
 * Names are free text, so an unescaped comma silently shifts every later column
 * of that row into the wrong heading.
 *
 * @param {*} value - The raw field value.
 * @returns {string} A CSV-safe field.
 */
const toCsvField = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  // String(value) rather than a nicer date format on purpose: this is the
  // representation Array#join already produced, and consumers parse it.
  const stringValue = String(value);

  if (FORMULA_START.test(stringValue) && !PLAIN_NUMBER.test(stringValue)) {
    // Prefixed *and* quoted: the apostrophe is what stops the cell being
    // evaluated, the quotes keep a leading tab or CR inside the field instead
    // of letting it split the row.
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

// This export ignores group membership by design — it returns every run in the
// database — so it is gated on the same predicate as cross-group reads. It was
// previously reachable by any authenticated user: a member of a single group,
// or of none, could export the lot.
router
  .route("/accessions/csv")
  .all(isAuthenticated)
  .all(hasFullRecordsAccess)
  .get(async (req, res) => {
    try {
      // Note: the heading row keeps its trailing comma, as consuming services
      // parse the existing format.
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
