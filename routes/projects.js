const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const _path = require("path");

const Project = require("../models/Project");
const { isAuthenticated } = require("./middleware");
const {
  canReadGroup,
  canWriteGroup,
  groupsICanCreate,
} = require("../lib/utils/groupAccess");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const { visibleGroupIds } = require("../lib/utils/fullAccessUsers");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { parsePreservationDate } = require("../lib/hpc-preservation");
const { projectStorageLocations } = require("../lib/project-storage-locations");
const { handleError, compareFilesToDirectory } = require("./_utils");
const {
  resolveStorageState,
  locationFor,
  notApplicableReconciliation,
} = require("../lib/storage-state");

/**
 * Narrows a request value to something usable as a mongoose id.
 * Type-guarded before it reaches a query: express parses `?id[$ne]=null` into
 * an object, and isValid() alone accepts any 12-character string.
 * @param {*} value - Value from req.body or req.query.
 * @returns {string|null} The id, or null if it cannot be used as one.
 */
const asObjectId = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{24}$/.test(value) &&
  mongoose.Types.ObjectId.isValid(value)
    ? value
    : null;

/**
 * Narrows a request value to a string.
 * undefined, not "": mongoose validates undefined against required, so a bad
 * value becomes a 400 rather than an empty field.
 * @param {*} value - Value from req.body or req.query.
 * @returns {string|undefined} The string, or undefined if it was not one.
 */
const asString = (value) => (typeof value === "string" ? value : undefined);

/**
 * Narrows a request value to a real boolean. Strings are refused, not coerced:
 * "false" is truthy and would set the opposite of what the caller asked for.
 * @param {*} value - Value from req.body or req.query.
 * @returns {boolean|undefined} The boolean, or undefined if it was not one.
 */
const asBoolean = (value) => (typeof value === "boolean" ? value : undefined);

/**
 * The id of the group a project belongs to, populated or not.
 * @param {Object} project - A Project document.
 * @returns {*} The group id, or undefined if the project has no group.
 */
const groupIdOf = (project) =>
  project && project.group ? project.group._id || project.group : undefined;

// Operational provenance is intentionally absent from ordinary project JSON.
router.get("/project/reconciliation-history", isAuthenticated, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).send({ error: "Admin access required" });
  const id = asObjectId(req.query.id);
  if (!id) return res.status(400).send({ error: "Valid project ID required" });
  try {
    const project = await Project.findById(id).select("registrationProvenance +reconciliationHistory").lean();
    if (!project) return res.status(404).send({ error: "Project not found" });
    return res.send({ projectId: project._id, registration: project.registrationProvenance || null,
      history: project.reconciliationHistory || [] });
  } catch (error) { return handleError(res, error, 500, "Failed to retrieve reconciliation history."); }
});

// Explicit admin retrieval includes retired documents. Normal model queries hide
// them; this fixed collection allowlist never accepts a caller-supplied filter.
router.get("/admin/reconciliation-record", isAuthenticated, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).send({ error: "Admin access required" });
  const collections = ["projects", "samples", "runs", "reads", "additionalfiles", "files", "ingestjobs", "newsitems", "archiveReconciliations"];
  const id = asObjectId(req.query.id);
  if (!id || !collections.includes(req.query.collection)) return res.status(400).send({ error: "Valid collection and ID required" });
  try {
    const record = await mongoose.connection.db.collection(req.query.collection).findOne({ _id: new mongoose.Types.ObjectId(id) });
    if (!record) return res.status(404).send({ error: "Record not found" });
    return res.send({ collection: req.query.collection, record });
  } catch (error) { return handleError(res, error, 500, "Could not retrieve administrative record"); }
});

/**
 * GET /projects
 * Fetches all projects visible to the authenticated user, sorted by most recent.
 */
router
  .route("/projects")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      // Live ids, not the token's `groups` claim: that claim still lists groups
      // deleted since login.
      const groupIds = await visibleGroupIds(req.user);
      const projects = await Project.iCanSee(req.user, groupIds).populate(
        "group",
      );
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
 * Fetches the names of all projects. Deliberately not scoped to the caller's
 * groups: Project.name is unique, so the client needs the whole list to warn
 * that a new name is taken.
 */
router.get("/projects/names", isAuthenticated, async (req, res) => {
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
    const { id: rawId } = req.query;
    if (!rawId) {
      return handleError(res, new Error("Project ID not provided."), 400);
    }

    const id = asObjectId(rawId);
    if (!id) {
      return handleError(res, new Error("Project ID is not a valid ID."), 400);
    }

    try {
      const project = await Project.findById(id, "+archiveMigration")
        .populate("group")
        .populate({ path: "samples", populate: { path: "group" } })
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .exec();

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      // Group membership is the whole test; no `owner ===` fallback, which the
      // list filter does not have either (see lib/utils/groupAccess).
      const canAccess = await canReadGroup(req.user, groupIdOf(project));
      if (!canAccess) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to view this project.`,
          ),
          403,
        );
      }

      const storageState = resolveStorageState(project);
      let actualAdditionalFiles = null;
      let additionalFilesStatus = notApplicableReconciliation(
        storageState.state,
      );

      if (storageState.state === "hpc") {
        const additionalDir = _path.join(
          process.env.DATASTORE_ROOT,
          project.path,
          "additional",
        );
        const comparison = await compareFilesToDirectory(
          project.additionalFiles,
          additionalDir,
          project,
        );
        actualAdditionalFiles = comparison.actualFiles;
        additionalFilesStatus = comparison.status;
      }

      require("../lib/physical-file-path").attachFileLocations(project.additionalFiles, project);
      res.status(200).send({
        project,
        location: locationFor(project, project.path),
        storageLocations: await projectStorageLocations(project),
        actualAdditionalFiles,
        additionalFilesStatus,
      });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve project ${id}.`);
    }
  });

// Retention is administrative metadata and remains editable after archiving.
// Never save the Project here: ordinary save hooks can derive paths or create
// directories. The conditional update also prevents a stale page overwriting
// another administrator's decision.
router.put("/project/hpc-preservation", isAuthenticated, async (req, res) => {
  if (
    req.user.isAdmin !== true ||
    typeof req.user.username !== "string" ||
    !req.user.username.trim()
  ) {
    return res.status(403).send({ error: "Admin access required" });
  }
  const body = req.body || {};
  const allowed = ["_id", "preserveOnHpcUntil", "expectedPreserveOnHpcUntil"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return res.status(400).send({ error: "Unsupported HPC preservation field" });
  }
  const id = asObjectId(body._id);
  if (!id) return res.status(400).send({ error: "Valid project ID required" });

  let until;
  let expected;
  try {
    until = parsePreservationDate(body.preserveOnHpcUntil);
    expected = parsePreservationDate(body.expectedPreserveOnHpcUntil);
  } catch (error) {
    return res.status(400).send({ error: error.message });
  }

  try {
    const updated = await Project.findOneAndUpdate(
      // MongoDB's null equality also matches a legacy missing field.
      { _id: id, preserveOnHpcUntil: expected },
      {
        $set: { preserveOnHpcUntil: until },
        $push: {
          hpcPreservationHistory: {
            at: new Date(),
            by: req.user.username,
            previousUntil: expected,
            until,
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) {
      const exists = await Project.findById(id).select("_id").lean();
      if (!exists) return res.status(404).send({ error: "Project not found" });
      return res.status(409).send({
        error: "The HPC preservation date changed. Reload the project before saving again.",
      });
    }
    return res.send({
      projectId: updated._id,
      preserveOnHpcUntil: updated.preserveOnHpcUntil || null,
    });
  } catch (error) {
    return handleError(res, error, 500, "Failed to update HPC preservation date.");
  }
});

/**
 * PUT /project/toggle-nudgeable
 * Toggles the 'nudgeable' status of a project. The project is loaded before it
 * is updated so the caller is authorised against the group that owns it, not
 * against the request body.
 */
router
  .route("/project/toggle-nudgeable")
  .all(isAuthenticated)
  .put(async (req, res) => {
    const { _id: rawId, nudgeable: rawNudgeable } = req.body || {};

    if (!rawId || rawNudgeable === undefined) {
      return handleError(
        res,
        new Error(
          "Required parameters '_id' and 'nudgeable' were not provided.",
        ),
        400,
      );
    }

    const _id = asObjectId(rawId);
    if (!_id) {
      return handleError(res, new Error("'_id' is not a valid ID."), 400);
    }

    // A real boolean, not a truthy one: "false" would set the opposite flag.
    const nudgeable = asBoolean(rawNudgeable);
    if (nudgeable === undefined) {
      return handleError(
        res,
        new Error("'nudgeable' must be true or false."),
        400,
      );
    }

    try {
      const project = await Project.findById(_id).select("group");

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      const canWrite = await canWriteGroup(req.user, groupIdOf(project));
      if (!canWrite) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to modify this project.`,
          ),
          403,
        );
      }

      const updatedProject = await Project.findByIdAndUpdate(
        _id,
        { $set: { nudgeable } },
        { new: true },
      );

      // Deleted between the two queries; nothing was written.
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
      const {
        group: rawGroup,
        name,
        shortDesc,
        longDesc,
        doNotSendToEna,
        doNotSendToEnaReason,
        nudgeable: requestedNudgeable,
        additionalFiles,
      } = req.body || {};

      if (!rawGroup) {
        return handleError(res, new Error("Group ID is required."), 400);
      }

      const groupId = asObjectId(rawGroup);
      if (!groupId) {
        return handleError(res, new Error("Group ID is not a valid ID."), 400);
      }

      // ENA admins may create across groups; read access alone is insufficient.
      const creatableGroups = await groupsICanCreate(req.user);
      const targetGroup = creatableGroups.find(
        (group) => group && group._id && group._id.toString() === groupId,
      );

      if (!targetGroup) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to create a project in this group.`,
          ),
          403,
        );
      }

      // The client's value wins; otherwise the group decides, since a nudge
      // chases an ENA submission a non-ENA group never makes.
      const explicitNudgeable = asBoolean(requestedNudgeable);
      const nudgeable = explicitNudgeable ?? targetGroup.sendToEna === true;

      if (requestedNudgeable !== undefined && explicitNudgeable === undefined) {
        console.warn(
          `[projects/new] Ignoring non-boolean 'nudgeable' (${typeof requestedNudgeable}) from "${req.user.username}"; using the group default.`,
        );
      }

      const newProject = new Project({
        name: asString(name),
        group: groupId,
        shortDesc: asString(shortDesc),
        longDesc: asString(longDesc),
        // From the session, never the body: `owner` is displayed and exported
        // as "who submitted this".
        owner: req.user.username,
        doNotSendToEna: asBoolean(doNotSendToEna),
        doNotSendToEnaReason: asString(doNotSendToEnaReason),
        nudgeable,
        nudges: [],
        storage: { state: "hpc" },
      });

      savedProject = await newProject.save();

      if (Array.isArray(additionalFiles) && additionalFiles.length > 0) {
        await sortAdditionalFiles(
          additionalFiles,
          "project",
          savedProject._id,
          savedProject.path,
          req.user.username,
        );
      }

      // Non-fatal: a failing email must not roll back a saved project.
      try {
        await sendOverseerEmail({ type: "Project", data: savedProject });
      } catch (emailError) {
        console.error(
          `[projects/new] Failed to send overseer email for project ${savedProject._id}:`,
          emailError,
        );
      }

      res.status(201).send({ project: savedProject });
    } catch (error) {
      // Roll back a project already saved when a later step failed.
      if (savedProject && savedProject._id) {
        console.error(
          `An error occurred. Rolling back creation of project ${savedProject._id}.`,
        );
        await Project.deleteOne({ _id: savedProject._id });
        // Does not clean up partially moved files.
      }

      if (error.name === "ValidationError") {
        return handleError(res, error, 400, "Project validation failed.");
      }

      handleError(res, error, 500, "Failed to create new project.");
    }
  });

module.exports = router;
