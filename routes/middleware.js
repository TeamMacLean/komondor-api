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
 * Not `isAdmin`: the ENA admins who use the accessions export are named in
 * FULL_RECORDS_ACCESS_USERS and their tokens carry no isAdmin claim.
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
 * Must be used after isAuthenticated. Gates mutations, so it asks for the
 * *write* capability (see lib/utils/groupAccess).
 * @param {Function} getGroupId - (req) => the group id to check.
 */
module.exports.belongsToGroup = function (getGroupId) {
  const { requireGroupWrite } = require("../lib/utils/groupAccess");

  return requireGroupWrite(getGroupId);
};
