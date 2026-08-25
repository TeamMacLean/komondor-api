const { isAuthenticated } = require("./middleware");

const User = require("../models/User");
const Project = require("../models/Project");
const { verifyUserExists } = require("../lib/ldap");
const { resolveVisibilityFilter } = require("../lib/utils/fullAccessUsers");
const { handleError } = require("./_utils");

const express = require("express");
let router = express.Router();

/**
 * The fields the user *list* is projected down to.
 *
 * GET /users returned User.find({}) — every field of every account — to any
 * authenticated caller. That published the whole directory's email addresses
 * and, more useful to an attacker than the addresses, `isAdmin` and `groups`:
 * a ready-made list of who to target and which groups they can reach.
 *
 * It cannot simply be made admin-only. komondor-power calls it as an ordinary
 * user from the CSV upload flow, to check that the project owners named in a
 * spreadsheet exist (server/services/csvOrchestrator/.../checkProjectOwnersExist.ts),
 * and reads only `username`; komondor-web's admin screen reads `_id`, `username`
 * and `name`. This projection is the union of the two, so both keep working
 * while the leak closes. Narrow it further only after checking those two.
 */
const USER_LIST_FIELDS = "_id username name";

/**
 * The fields the single-user profile is projected down to.
 *
 * Wider than the list because komondor-web's pages/user/index.vue renders a
 * profile card: it reads `name`, `email` and `company`, and builds the
 * identicon from `_id`. `isAdmin`, `groups` and `lastLogin` are still withheld
 * — nothing renders them, and they describe the account rather than the person.
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

    // The profile lists the named user's projects, and used to list *all* of
    // them: an unfiltered `Project.find({ owner })`, where GET /projects goes
    // through Project.iCanSee. That made /user?username=… a way around the
    // visibility filter — pick any owner and read their projects, whatever
    // group they are in. Composed with $and rather than merged so the two
    // conditions stay independent conjuncts: the requested owner and the
    // caller's own group visibility both have to hold, and neither can
    // overwrite the other's keys the way a shallow merge would.
    //
    // resolveVisibilityFilter, not buildVisibilityFilter: membership is
    // re-derived from the database, so a group soft-deleted since the caller's
    // token was issued stops being visible here too.
    //
    // Unconditional. There used to be a `visibility === null ? { owner } : …`
    // branch here, from when the filter builder returned null — "no filter at
    // all" — for admins and FULL_RECORDS_ACCESS_USERS. That branch was the
    // *unfiltered* one, and it is exactly the wrong thing to leave lying
    // around: resolveVisibilityFilter can no longer return null (an
    // unresolvable membership is now `{ _id: { $in: [] } }`, matching nothing),
    // so the branch was dead, and anything that reintroduced a null would have
    // silently served another user's projects rather than failing closed.
    const visibility = await resolveVisibilityFilter(req.user);
    const projectFilter = { $and: [{ owner: username }, visibility] };

    try {
      const [foundProjects, foundUser] = await Promise.all([
        Project.find(projectFilter).populate("group"),
        User.findOne({ username }, USER_PROFILE_FIELDS),
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
