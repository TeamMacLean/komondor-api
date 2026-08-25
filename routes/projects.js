const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const _path = require("path");

const Project = require("../models/Project");
const { isAuthenticated } = require("./middleware");
const {
  canReadGroup,
  canWriteGroup,
  groupsICanWrite,
} = require("../lib/utils/groupAccess");
const { sortAdditionalFiles } = require("../lib/sortAssociatedFiles");
const {
  visibleGroupIds,
} = require("../lib/utils/fullAccessUsers");
const sendOverseerEmail = require("../lib/utils/sendOverseerEmail");
const { handleError, compareFilesToDirectory } = require("./_utils");

/**
 * Narrows a request value to something usable as a mongoose id.
 *
 * Express parses `?id[$ne]=null` into an object and mongoose treats
 * `{ _id: { $ne: null } }` as a perfectly good query, so an unchecked query
 * parameter turns findById() into "hand me any project at all".
 *
 * `ObjectId.isValid()` on its own is not that guard. It answers true for
 * numbers, and — the case that matters here — for *any* 12-character string,
 * which it then casts from its raw bytes: "project-1234" and "sample_names"
 * both pass and become garbage ids, turning a boundary check into a confusing
 * 404. The 24-hex test is what actually closes it, and it keeps this file
 * consistent with routes/samples.js and routes/runs.js, which guard the same
 * way.
 *
 * @param {*} value - A value taken straight from req.body or req.query.
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
 *
 * Returning undefined rather than "" for a bad value matters: mongoose applies
 * schema defaults and required-field validation to undefined, so a rejected
 * value fails as a 400 validation error instead of being stored as empty.
 *
 * @param {*} value - A value taken straight from req.body or req.query.
 * @returns {string|undefined} The string, or undefined if it was not one.
 */
const asString = (value) => (typeof value === "string" ? value : undefined);

/**
 * Narrows a request value to a real boolean.
 *
 * Strings are refused rather than coerced, because "false" is truthy and would
 * set the opposite of what the caller asked for.
 *
 * @param {*} value - A value taken straight from req.body or req.query.
 * @returns {boolean|undefined} The boolean, or undefined if it was not one.
 */
const asBoolean = (value) => (typeof value === "boolean" ? value : undefined);

/**
 * The id of the group a project belongs to, whether or not `group` is populated.
 *
 * @param {Object} project - A Project document.
 * @returns {*} The group id, or undefined if the project has no group.
 */
const groupIdOf = (project) =>
  project && project.group ? project.group._id || project.group : undefined;

/**
 * GET /projects
 * Fetches all projects visible to the authenticated user, sorted by most recent.
 */
router
  .route("/projects")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      // Membership is re-derived from the database rather than trusted from
      // the token's `groups` claim, so a group soft-deleted since login stops
      // being visible here as well as on the per-record routes.
      const groupIds = await visibleGroupIds(req.user);
      const projects = await Project.iCanSee(req.user, groupIds).populate(
        "group",
      );
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
 * Fetches the names of all projects.
 *
 * Deliberately not scoped to the caller's groups: Project.name is unique, so
 * the client needs the whole list to tell a user their new name is taken. It is
 * authenticated because names alone still describe work in other groups, and
 * this route used to answer anonymous callers.
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
      const project = await Project.findById(id)
        .populate("group")
        .populate({ path: "samples", populate: { path: "group" } })
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .exec();

      if (!project) {
        return handleError(res, new Error("Project not found."), 404);
      }

      // Reading a record needs the *read* capability, which is broader than
      // write: FULL_RECORDS_ACCESS_USERS may see every group's projects here
      // but cannot create or edit one (see lib/utils/groupAccess).
      //
      // Group membership is the whole test. An `owner === req.user.username`
      // fallback used to sit beside it, and it was a permanent read grant that
      // removing somebody from the group could not withdraw. Worse, `owner` was
      // copied verbatim out of req.body until this branch and no migration has
      // rewritten the records created that way, so a historical project can
      // name an arbitrary username and hand that person a cross-group read for
      // good. The list filter dropped the same clause
      // (lib/utils/fullAccessUsers buildVisibilityFilter); dropping it here too
      // is what makes the two agree about one record.
      const canAccess = await canReadGroup(req.user, groupIdOf(project));
      if (!canAccess) {
        return handleError(
          res,
          new Error(`User '${req.user.username}' does not have permission to view this project.`),
          403,
        );
      }

      const additionalDir = _path.join(
        process.env.DATASTORE_ROOT,
        project.path,
        "additional",
      );
      const {
        actualFiles: actualAdditionalFiles,
        status: additionalFilesStatus,
      } = await compareFilesToDirectory(project.additionalFiles, additionalDir);

      res.status(200).send({ project, actualAdditionalFiles, additionalFilesStatus });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve project ${id}.`);
    }
  });

/**
 * PUT /project/toggle-nudgeable
 * Toggles the 'nudgeable' status of a project.
 *
 * The project is loaded before it is updated so the caller can be authorised
 * against the group that actually owns it. Going straight to
 * findByIdAndUpdate() let any authenticated user flip the flag on any project
 * in any group, because the request body is the only thing naming the target.
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

      // Creating a project is a write, so it needs the write capability — a
      // cross-group *reader* must not be able to create records in a group they
      // are not in. The group document comes back with the same call, which is
      // what the nudgeable default below is derived from.
      const writableGroups = await groupsICanWrite(req.user);
      const targetGroup = writableGroups.find(
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

      // The client's value wins when it sent a real one — komondor-power
      // carries a nudgeable column through its whole pipeline and this route
      // used to drop it. Otherwise the group decides: a nudge chases an ENA
      // submission, so a group that does not send to ENA has nothing to chase.
      // This replaces a hardcoded '2Blades' group id, which was a stand-in for
      // exactly this flag and only covered one of the groups that carry it.
      const explicitNudgeable = asBoolean(requestedNudgeable);
      const nudgeable = explicitNudgeable ?? targetGroup.sendToEna === true;

      // Falling back is kinder to clients than a 400, but silently discarding
      // the value is how this field got lost in the first place.
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
        // The session, never the body. `owner` arriving from req.body was an
        // unvalidated client string that named whoever the caller liked. No
        // read path grants on it any more, but it is displayed and exported as
        // "who submitted this", so it still has to be the authenticated caller.
        owner: req.user.username,
        doNotSendToEna: asBoolean(doNotSendToEna),
        doNotSendToEnaReason: asString(doNotSendToEnaReason),
        nudgeable,
        nudges: [],
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

      // Email is sent after all database and file operations are successful.
      // Non-fatal: a failing email should not roll back a successfully saved project.
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
