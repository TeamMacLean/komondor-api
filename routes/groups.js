const { isAuthenticated, isAdmin } = require("./middleware");
const { canWriteGroup } = require("../lib/utils/groupAccess");
const { toSafeName } = require("../lib/utils/generateSafeName");
const { resolveBelow } = require("../lib/utils/safePath");

const fs = require("fs").promises;
const mongoose = require("mongoose");
const express = require("express");
let router = express.Router();
const Group = require("../models/Group");

/**
 * Narrows a request-supplied id to a string mongoose can safely look up.
 *
 * Returns null rather than throwing so callers can choose the status code.
 * The type check is the load-bearing half: `Group.findById({ $ne: null })` is
 * not a cast error — mongoose reads the object as a query condition and hands
 * back the first group whose _id is not null. Every id on these routes decides
 * *which* group is edited, deleted or restored, so an arbitrary match is a
 * privilege escalation rather than a nuisance.
 *
 * The 24-hex test is the other half, and matches what routes/projects.js,
 * routes/samples.js and routes/runs.js already do: `ObjectId.isValid()` answers
 * true for *any* 12-character string, which it then casts from its raw bytes,
 * so "project-1234" becomes a real but entirely different id. That only ever
 * produced a confusing 404 here, but one guard written four ways is how the
 * four drift apart.
 *
 * @param {*} value - The candidate id from the request body.
 * @returns {string|null} The id, or null if it is not a well-formed ObjectId.
 */
const asGroupId = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{24}$/.test(value) &&
  mongoose.Types.ObjectId.isValid(value)
    ? value
    : null;

/**
 * Whether the group's datastore directory already holds something.
 *
 * Fails closed: a datastore that cannot be inspected is assumed to hold data,
 * because the only caller uses this to decide whether renaming a group would
 * strand its files.
 *
 * @param {string} safeName - The group's current safeName.
 * @returns {Promise<boolean>} True if data is (or may be) filed under it.
 */
const datastoreHasContents = async (safeName) => {
  // resolveBelow, not resolveWithin: a group with no safeName would otherwise
  // resolve to DATASTORE_ROOT itself and answer for the whole datastore.
  const directory = resolveBelow(process.env.DATASTORE_ROOT, safeName);

  if (!directory) {
    console.error(
      `[GROUPS] Cannot locate the datastore directory for "${safeName}"; treating it as non-empty`,
    );
    return true;
  }

  try {
    const entries = await fs.readdir(directory);
    return entries.length > 0;
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }

    console.error(
      `[GROUPS] Could not read the datastore directory for "${safeName}":`,
      err,
    );
    return true;
  }
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
 * GET /groups
 * Fetches all groups the authenticated user belongs to.
 */
router
  .route("/groups")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const user = req.user;

    // Soft-deleted groups no longer authorise anything, so GroupsIAmIn now
    // filters them out of every answer. The admin screen still needs to see
    // them — it renders a "Deleted" tag and is the only place a group can be
    // found in order to resurrect it — so admins may ask for them back
    // explicitly. Compared against the literal string, which also rejects the
    // array express produces for a repeated query parameter.
    const includeDeleted = req.query.includeDeleted === "true";

    if (includeDeleted && !user.isAdmin) {
      return res.status(403).send({ error: "Admin access required" });
    }

    try {
      const groups = await Group.GroupsIAmIn(user, { includeDeleted });

      console.log(
        user.username,
        groups.map((g) => g.name),
      );
      res.status(200).send({ groups });
    } catch (err) {
      res.status(500).send({ error: err.message || err });
    }
  });

/**
 * POST /groups/new
 * Creates a new group. Only admins can create groups.
 */
router
  .route("/groups/new")
  .all(isAuthenticated)
  .all(isAdmin)
  .post((req, res) => {
    const body = req.body || {};

    if (typeof body.name !== "string" || !body.name.trim()) {
      return res
        .status(400)
        .send({ error: "name is required and must be a non-empty string" });
    }

    if (!isStringArray(body.ldapGroups)) {
      return res
        .status(400)
        .send({ error: "ldapGroups must be an array of strings" });
    }

    new Group({
      name: body.name,
      ldapGroups: body.ldapGroups,
    })
      .save()
      .then((savedGroup) => {
        res.status(201).send({ group: savedGroup });
      })
      .catch((err) => {
        console.error(err);
        res.status(500).send({ error: err.message || err });
      });
  });

/**
 * POST /groups/edit
 * Edits an existing group.
 *
 * Members may change the group's cosmetic fields; only an admin may change
 * `ldapGroups` or `name`.
 *
 * `ldapGroups` *is* the membership rule — every request resolves a user's
 * groups by matching their directory DNs against it — so a member who can
 * rewrite it can add their own DN to any pattern they like, or capture a whole
 * directory group, and hand themselves the group's data. Restricting it to
 * admins is the difference between editing a group and editing who is in it.
 *
 * `name` is not cosmetic either. The pre-validate hook on Group re-derives
 * `safeName` from it and the post-save hook mkdirs DATASTORE_ROOT/<safeName>,
 * so a rename silently forks the group's datastore: new uploads land in a new
 * tree while everything already filed stays orphaned under the old name. It is
 * also the group identifier in the ENA export. Renaming is therefore an admin
 * action, and is refused outright once the group's directory holds anything —
 * see the check below.
 */
router
  .route("/groups/edit")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const body = req.body || {};

    if (!body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    const groupId = asGroupId(body.id);
    if (!groupId) {
      return res.status(400).send({ error: "Group ID is not a valid ID" });
    }

    try {
      // Editing a group is a mutation, so this asks for the *write* capability.
      // In read mode a FULL_RECORDS_ACCESS_USERS user is handed every group,
      // which would have let them edit groups they are not in.
      if (!(await canWriteGroup(req.user, groupId))) {
        console.error(
          `[AUTHZ] Refused group edit on ${groupId} to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to modify this resource`,
        });
      }

      const wantsLdapChange = body.ldapGroups !== undefined;

      if (wantsLdapChange && !req.user.isAdmin) {
        console.error(
          `[AUTHZ] Refused ldapGroups change on ${groupId} to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to modify the LDAP groups of this group`,
        });
      }

      if (wantsLdapChange && !isStringArray(body.ldapGroups)) {
        return res
          .status(400)
          .send({ error: "ldapGroups must be an array of strings" });
      }

      if (
        body.name !== undefined &&
        (typeof body.name !== "string" || !body.name.trim())
      ) {
        return res
          .status(400)
          .send({ error: "name must be a non-empty string" });
      }

      if (body.sendToEna !== undefined && typeof body.sendToEna !== "boolean") {
        return res.status(400).send({ error: "sendToEna must be a boolean" });
      }

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).send({ error: "Group not found" });
      }

      // A request carrying the name it already has is not a rename, and clients
      // do resend the whole group object — checking against the stored value
      // rather than merely "is name present" keeps that working for members.
      const wantsRename = body.name !== undefined && body.name !== group.name;

      if (wantsRename && !req.user.isAdmin) {
        console.error(
          `[AUTHZ] Refused rename of ${groupId} to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to rename this group`,
        });
      }

      // A rename that changes safeName moves the group's datastore directory
      // out from under its data. Nothing here moves the tree to follow it: File
      // documents store paths relative to DATASTORE_ROOT that begin with the
      // group's safeName, so a move that did not also rewrite every one of them
      // would strand the files it just relocated — and the new safeName is only
      // known after save(), which would leave a failed move with the database
      // pointing at a directory that does not exist. A rename is refused
      // instead, and moving a populated datastore stays a deliberate,
      // out-of-band operation.
      //
      // toSafeName is the slug alone, while the hook appends "_2" on collision,
      // so a group whose safeName carries a suffix is compared conservatively:
      // the worst case is refusing a rename that would not actually have moved
      // anything, which is the direction to be wrong in.
      if (wantsRename && toSafeName(body.name) !== group.safeName) {
        if (await datastoreHasContents(group.safeName)) {
          console.error(
            `[GROUPS] Refused rename of ${groupId}: "${group.safeName}" already holds data`,
          );
          return res.status(409).send({
            error:
              "This group's datastore directory already holds files, so it cannot be renamed. Move the directory before renaming the group.",
          });
        }
      }

      // Only fields the request actually carried are applied. Assigning them
      // unconditionally meant a request that omitted `name` set it to undefined
      // and failed validation, so editing one field required resending all.
      if (wantsLdapChange) {
        group.ldapGroups = body.ldapGroups;
      }

      if (body.name !== undefined) {
        group.name = body.name;
      }

      if (body.sendToEna !== undefined) {
        group.sendToEna = body.sendToEna;
      }

      const previousSafeName = group.safeName;
      const savedGroup = await group.save();

      // The post-save hook has just created a directory for the new safeName.
      // The old one was empty or the rename would have been refused above, but
      // it is still left behind, so say so rather than leaving an operator to
      // find it.
      if (savedGroup && savedGroup.safeName !== previousSafeName) {
        console.log(
          `Group ${groupId} renamed: new files will be filed under "${savedGroup.safeName}". The empty "${previousSafeName}" directory is left behind and can be removed.`,
        );
      }

      res.status(200).send({ group: savedGroup });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: err.message || err });
    }
  });

/**
 * POST /groups/delete
 * Soft-deletes a group. Only admins can delete groups.
 */
router
  .route("/groups/delete")
  .all(isAuthenticated)
  .all(isAdmin)
  .post(async (req, res) => {
    const body = req.body || {};

    if (!body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    const groupId = asGroupId(body.id);
    if (!groupId) {
      return res.status(400).send({ error: "Group ID is not a valid ID" });
    }

    try {
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).send({ error: "Group not found" });
      }

      group.deleted = true;
      await group.save();
      res.status(200).send({ message: "Group deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: err.message || err });
    }
  });

/**
 * POST /groups/resurrect
 * Restores a soft-deleted group. Only admins can resurrect groups.
 *
 * The lookup is Group.findById on purpose, not Group.GroupsIAmIn: the soft-delete
 * filter lives in GroupsIAmIn, which is the authorisation path. A route whose
 * whole job is to undo a soft-delete has to be able to see a deleted group, so
 * it goes to the collection directly and takes its authorisation from isAdmin
 * instead.
 */
router
  .route("/groups/resurrect")
  .all(isAuthenticated)
  .all(isAdmin)
  .post(async (req, res) => {
    const body = req.body || {};

    if (!body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    const groupId = asGroupId(body.id);
    if (!groupId) {
      return res.status(400).send({ error: "Group ID is not a valid ID" });
    }

    try {
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).send({ error: "Group not found" });
      }

      group.deleted = false;
      await group.save();
      res.status(200).send({ message: "Group restored successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: err.message || err });
    }
  });

module.exports = router;
