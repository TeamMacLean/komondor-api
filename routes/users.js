const { isAuthenticated } = require("./middleware");

const User = require("../models/User");
const Project = require("../models/Project");
const { verifyUserExists } = require("../lib/ldap");
const { resolveVisibilityFilter } = require("../lib/utils/fullAccessUsers");
const { handleError } = require("./_utils");

const express = require("express");
let router = express.Router();

/**
 * The fields the user *list* is projected down to: the union of what
 * komondor-power's CSV owner check and komondor-web's admin screen read.
 * Narrow it further only after checking those two.
 */
const USER_LIST_FIELDS = "_id username name";

/**
 * The fields the single-user profile is projected down to. Wider than the list
 * because komondor-web renders a profile card; isAdmin and groups stay withheld.
 */
const USER_PROFILE_FIELDS = "_id username name email company";

router
  .route("/users")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      const users = await User.find({}, USER_LIST_FIELDS);
      res.status(200).send({ users });
    } catch (err) {
      handleError(res, err, 500, "Failed to retrieve users.");
    }
  });

router
  .route("/user")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { username } = req.query;

    if (!username || typeof username !== "string") {
      return handleError(res, new Error('"username" param required'), 400);
    }

    // The caller's own visibility still applies here, or /user?username=… would
    // be a way to read any owner's projects. $and, not a merge: both conditions
    // must hold and neither may overwrite the other's keys.
    const visibility = await resolveVisibilityFilter(req.user);
    const projectFilter = { $and: [{ owner: username }, visibility] };

    try {
      const [foundProjects, foundUser] = await Promise.all([
        Project.find(projectFilter).populate("group"),
        User.findOne({ username }, USER_PROFILE_FIELDS),
      ]);

      // toObject() first: spreading a mongoose document yields $__ and _doc.
      const userFields = foundUser ? foundUser.toObject() : {};

      res.status(200).send({
        user: {
          ...userFields,
          username,
          projects: foundProjects,
        },
      });
    } catch (err) {
      handleError(res, err, 500, `Failed to retrieve user ${username}.`);
    }
  });

/**
 * POST /users/verify-ldap — checks a username exists in LDAP, for validating
 * project owners who may not have logged in yet.
 * Body: { username: string }. Returns: { exists, user?: { username, cn, mail } }
 */
router
  .route("/users/verify-ldap")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const { username } = req.body || {};

    if (!username || typeof username !== "string") {
      return res.status(400).send({ error: '"username" is required' });
    }

    try {
      const result = await verifyUserExists(username);
      res.status(200).send(result);
    } catch (err) {
      console.error("LDAP verification error:", err);
      res.status(500).send({
        error: "Failed to verify user in LDAP",
        message: err.message,
      });
    }
  });

module.exports = router;
