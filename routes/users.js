const { isAuthenticated } = require("./middleware");

const User = require("../models/User");
const Project = require("../models/Project");
const { verifyUserExists } = require("../lib/ldap");
const { handleError } = require("./_utils");

const express = require("express");
let router = express.Router();

router
  .route("/users")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      const users = await User.find({});
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

    try {
      const [foundProjects, foundUser] = await Promise.all([
        Project.find({ owner: username }),
        User.findOne({ username }),
      ]);

      // `foundUser` is a mongoose document; spreading it directly would leak
      // internal fields ($__, _doc, …) instead of the user's data, so convert
      // it to a plain object first.
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
 * Verify if a username exists in LDAP.
 * This is used to validate project owners who may not have logged in yet.
 * POST /users/verify-ldap
 * Body: { username: string }
 * Returns: { exists: boolean, user?: { username, cn, mail } }
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
