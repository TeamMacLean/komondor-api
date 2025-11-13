const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const _path = require("path");

const Project = require("../models/Project");
const { isAuthenticated } = require("./middleware");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, getActualFiles } = require("./_utils");

/**
 * GET /projects
 * Fetches all projects visible to the authenticated user, sorted by most recent.
 */
router
  .route("/projects")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      const projects = await Project.iCanSee(req.user);
      // Sort projects by creation date in descending order
      const sortedProjects = projects.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
      res.status(200).send({ projects: sortedProjects });
    } catch (error) {
      handleError(res, error, 500, "Failed to retrieve projects.");
    }
  });

/**
 * GET /projects/names
 * Fetches the names of all projects. This is a public endpoint.
 */
router.get("/projects/names", async (req, res) => {
  try {
    const projects = await Project.find({}).select("name");
    const projectNames = projects.map((project) => project.name);
    res.status(200).send({ projectNames });
  } catch (error) {
    handleError(res, error, 500, "Failed to retrieve project names.");
  }
});

/**
 * GET /project?id=:id
 * Fetches a single project by its ID, along with its associated data and files on disk.
 */
router
  .route("/project")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return handleError(res, new Error("Project ID not provided."), 400);
    }

    try {
      const project = await Project.findById(id)
        .populate("group")
        .populate({ path: "samples", populate: { path: "group" } })
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .exec();

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      const additionalDir = _path.join(
        process.env.DATASTORE_ROOT,
        project.path,
        "additional",
      );
      const actualAdditionalFiles = await getActualFiles(additionalDir);

      res.status(200).send({ project, actualAdditionalFiles });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve project ${id}.`);
    }
  });

/**
 * PUT /project/toggle-nudgeable
 * Toggles the 'nudgeable' status of a project.
 */
router
  .route("/project/toggle-nudgeable")
  .all(isAuthenticated)
  .put(async (req, res) => {
    const { _id, nudgeable } = req.body;

    if (!_id || nudgeable === undefined) {
      return handleError(
        res,
        new Error(
          "Required parameters '_id' and 'nudgeable' were not provided.",
        ),
        400,
      );
    }

    try {
      const updatedProject = await Project.findByIdAndUpdate(
        _id,
        { $set: { nudgeable } },
        { new: true, useFindAndModify: false },
      );

      if (!updatedProject) {
        return handleError(res, new Error("Project not found."), 404);
      }

      res
        .status(200)
        .send({ message: "Nudgeable status updated successfully." });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        "Failed to update project's nudgeable status.",
      );
    }
  });

/**
 * POST /projects/new
 * Creates a new project, handles associated file uploads, and sends a notification email.
 */
router
  .route("/projects/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedProject; // To hold the created project document

    try {
      // A specific group ID that has special 'nudgeable' logic.
      // TODO: This could be made more robust, e.g., by fetching group by name or using an env variable.
      const twoBladesObjectId = "5fc012bda3efcb29338b7cf3";

      const newProject = new Project({
        name: req.body.name,
        group: req.body.group,
        shortDesc: req.body.shortDesc,
        longDesc: req.body.longDesc,
        owner: req.body.owner,
        doNotSendToEna: req.body.doNotSendToEna,
        doNotSendToEnaReason: req.body.doNotSendToEnaReason,
        // Nudgeable is false only if the group is '2Blades'.
        nudgeable: req.body.group !== twoBladesObjectId,
        nudges: [],
      });

      savedProject = await newProject.save();

      const { additionalFiles } = req.body;
      if (additionalFiles && additionalFiles.length > 0) {
        await sortAdditionalFiles(
          additionalFiles,
          "project",
          savedProject._id,
          savedProject.path,
        );
      }

      // Email is sent after all database and file operations are successful.
      await sendOverseerEmail({ type: "Project", data: savedProject });

      res.status(201).send({ project: savedProject });
    } catch (error) {
      // If an error occurs after the project has been saved, we must roll back the change.
      if (savedProject && savedProject._id) {
        console.error(
          `An error occurred. Rolling back creation of project ${savedProject._id}.`,
        );
        await Project.deleteOne({ _id: savedProject._id });
        // Note: This doesn't clean up partially moved files. That would require a more complex transaction system.
      }

      // Check for Mongoose validation error
      if (error.name === "ValidationError") {
        return handleError(res, error, 400, "Project validation failed.");
      }

      handleError(res, error, 500, "Failed to create new project.");
    }
  });

module.exports = router;
