const express = require("express");
let router = express.Router();
const Project = require("../models/Project");
const Sample = require("../models/Sample");
const Run = require("../models/Run");
const Read = require("../models/Read");
const { isAuthenticated } = require("./middleware");
const _path = require("path");
const fs = require("fs");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");

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
    const { accessions, releaseDate, type, typeId } = req.body;

    if (!type || !["project", "sample", "run"].includes(type)) {
      return res.status(400).send({
        error: "Invalid or missing type. Must be project, sample, or run.",
      });
    }

    if (!typeId) {
      return res.status(400).send({ error: "Missing typeId" });
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
      const runsProjIdStr = runPlus.sample.project.toString();
      const targetProjectObj = projectsById[runsProjIdStr];

      if (!targetProjectObj) {
        console.error(
          `Project not found for run ${runPlus._id}: project ID ${runsProjIdStr}`,
        );
        return null;
      }

      const relatedReads = reads.filter((read) => {
        return read.run.toString() === runPlus._id.toString();
      });

      // Use READS_ROOT_PATH from environment, defaulting to production path
      const readsRootPath = process.env.READS_ROOT_PATH || "/tsl/data/reads";
      const relatedReadsPaths = relatedReads.map((read) =>
        _path.join(readsRootPath, read.file.path),
      );
      const relatedReadsPathsString = relatedReadsPaths.join(";");

      return [
        runPlus.group.safeName,
        runPlus.owner,
        targetProjectObj.releaseDate,
        targetProjectObj.safeName,
        runsProjIdStr,
        targetProjectObj.accessions.join(";"),
        runPlus.sample.safeName,
        runPlus.sample._id.toString(),
        runPlus.sample.accessions.join(";"),
        runPlus.safeName,
        runPlus._id.toString(),
        runPlus.accessions.join(";"),
        runPlus.createdAt,
        relatedReadsPathsString,
      ];
    })
    .filter(Boolean); // Filter out null entries from missing projects

  return result;
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
      var csv = "";
      HEADINGS.forEach(function (row) {
        csv += row;
        csv += ",";
      });
      csv += "\n";

      const matrixOfData = await getMatrixOfData();

      //merge the data with CSV
      matrixOfData.forEach(function (row) {
        csv += row.join(",");
        csv += "\n";
      });

      res.status(200).send({ csv });
    } catch (error) {
      res.status(500).send({ error });
    }
  });

module.exports = router;
