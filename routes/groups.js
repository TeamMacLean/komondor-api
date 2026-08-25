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
 * The type check is load-bearing: `findById({ $ne: null })` is read as a query
 * condition, not a cast error, and matches an arbitrary group.
 * @param {*} value - Candidate id from the request body.
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
 * Fails closed: an uninspectable datastore is assumed to hold data.
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
 * @param {*} value - Candidate value from a request body.
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

    // GroupsIAmIn hides deleted groups; the admin screen needs them to
    // resurrect one. Compared to the literal string, which also rejects the
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
 * Edits an existing group. Members may change cosmetic fields; only an admin
 * may change `ldapGroups`, which *is* the membership rule, or `name`, from
 * which safeName and the group's datastore directory are derived.
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
      // Write capability, not read: read mode hands out every group.
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

      // Compared to the stored value, not merely "is name present": clients
      // resend the whole group object, and that is not a rename.
      const wantsRename = body.name !== undefined && body.name !== group.name;

      if (wantsRename && !req.user.isAdmin) {
        console.error(
          `[AUTHZ] Refused rename of ${groupId} to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to rename this group`,
        });
      }

      // A rename changes safeName, and File paths start with it, so renaming a
      // populated group would strand its files. Refused; move it out of band.
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

      // Only fields the request carried: assigning unconditionally sets an
      // omitted `name` to undefined and fails validation.
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

      // The old (empty) directory is left behind; say so rather than leaving an
      // operator to find it.
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
 * findById, not GroupsIAmIn: GroupsIAmIn filters out the very group this route
 * exists to restore, so authorisation comes from isAdmin instead.
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
