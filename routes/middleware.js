module.exports.isAuthenticated = function (req, res, next) {
  if (req.user) {
    next();
  } else {
    return res.status(401).send({ error: "Authentication required" });
  }
};

/**
 * Middleware to check if the user is an admin.
 * Must be used after isAuthenticated.
 */
module.exports.isAdmin = function (req, res, next) {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    return res.status(403).send({ error: "Admin access required" });
  }
};

/**
 * Middleware for routes that expose records across every group.
 * Must be used after isAuthenticated.
 *
 * `isAdmin` is too narrow for these: the people who use the accessions export
 * are ENA admins named in FULL_RECORDS_ACCESS_USERS, and their tokens do not
 * carry the isAdmin claim. `hasFullRecordsAccess` covers both, and is the same
 * predicate `iCanSee` uses to decide who may read across groups.
 */
module.exports.hasFullRecordsAccess = function (req, res, next) {
  const { hasFullRecordsAccess } = require("../lib/utils/fullAccessUsers");

  if (req.user && hasFullRecordsAccess(req.user)) {
    return next();
  }

  console.error(
    `[AUTHZ] Refused cross-group export to "${req.user && req.user.username}"`,
  );
  return res
    .status(403)
    .send({ error: "You do not have permission to export all records" });
};

/**
 * Middleware to check if user belongs to at least one of the specified groups.
 * Must be used after isAuthenticated.
 *
 * Membership gates a mutation, so this asks for the *write* capability: users
 * named in FULL_RECORDS_ACCESS_USERS read across every group but write only in
 * the groups they actually belong to. The check itself lives in
 * lib/utils/groupAccess so this middleware and the route handlers share one
 * implementation and cannot drift apart.
 *
 * @param {Function} getGroupId - Function that takes req and returns the group ID to check
 */
module.exports.belongsToGroup = function (getGroupId) {
  const { requireGroupWrite } = require("../lib/utils/groupAccess");

  return requireGroupWrite(getGroupId);
};
