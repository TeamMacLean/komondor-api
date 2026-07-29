const express = require("express");
const mongoose = require("mongoose");
let router = express.Router();
const Project = require("../models/Project");
const Sample = require("../models/Sample");
const Run = require("../models/Run");
const Read = require("../models/Read");
const { isAuthenticated } = require("./middleware");
const _path = require("path");
const { handleError } = require("./_utils");

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
  const models = {
    project: Project,
    sample: Sample,
    run: Run,
  };

  const Model = models[type];
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
  .post(async (req, res) => {
    const { accessions, releaseDate, type, typeId } = req.body || {};

    if (!type || !["project", "sample", "run"].includes(type)) {
      return res.status(400).send({
        error: "Invalid or missing type. Must be project, sample, or run.",
      });
    }

    if (!typeId) {
      return res.status(400).send({ error: "Missing typeId" });
    }

    if (!mongoose.Types.ObjectId.isValid(typeId)) {
      return res.status(400).send({ error: "typeId is not a valid ID" });
    }

    if (accessions !== undefined && !Array.isArray(accessions)) {
      return res.status(400).send({ error: "accessions must be an array" });
    }

    try {
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

/**
 * Renders one value as a CSV field, quoting it when it contains a delimiter.
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

router
  .route("/accessions/csv")
  .all(isAuthenticated)
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
