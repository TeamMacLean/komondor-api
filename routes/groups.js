const { isAuthenticated, isAdmin } = require("./middleware");

const express = require("express");
let router = express.Router();
const Group = require("../models/Group");

/**
 * Helper to check if user belongs to a group
 */
async function userBelongsToGroup(user, groupId) {
  const userGroups = await Group.GroupsIAmIn(user);
  return userGroups.some((g) => g._id.toString() === groupId.toString());
}

/**
 * GET /groups
 * Fetches all groups the authenticated user belongs to.
 */
router
  .route("/groups")
  .all(isAuthenticated)
  .get((req, res) => {
    const user = req.user;

    Group.GroupsIAmIn(user)
      .then((groups) => {
        console.log(
          user.username,
          groups.map((g) => g.name),
        );
        res.status(200).send({ groups });
      })
      .catch((err) => {
        res.status(500).send({ error: err.message || err });
      });
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
    new Group({
      name: req.body.name,
      ldapGroups: req.body.ldapGroups,
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
 * Edits an existing group. Only admins or members of the group can edit it.
 */
router
  .route("/groups/edit")
  .all(isAuthenticated)
  .post(async (req, res) => {
    if (!req.body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    try {
      // Check permission: must be admin or member of the group
      const canEdit =
        req.user.isAdmin || (await userBelongsToGroup(req.user, req.body.id));

      if (!canEdit) {
        return res
          .status(403)
          .send({ error: "You do not have permission to edit this group" });
      }

      const group = await Group.findById(req.body.id);
      if (!group) {
        return res.status(404).send({ error: "Group not found" });
      }

      group.ldapGroups = req.body.ldapGroups;
      group.name = req.body.name;

      if (req.body.sendToEna !== undefined) {
        group.sendToEna = req.body.sendToEna;
      }

      const savedGroup = await group.save();
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
    if (!req.body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    try {
      const group = await Group.findById(req.body.id);
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
 */
router
  .route("/groups/resurrect")
  .all(isAuthenticated)
  .all(isAdmin)
  .post(async (req, res) => {
    if (!req.body.id) {
      return res.status(400).send({ error: "Group ID not provided" });
    }

    try {
      const group = await Group.findById(req.body.id);
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
