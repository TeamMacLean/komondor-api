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
 * Middleware to check if user belongs to at least one of the specified groups.
 * Must be used after isAuthenticated.
 * @param {Function} getGroupId - Function that takes req and returns the group ID to check
 */
module.exports.belongsToGroup = function (getGroupId) {
  return async function (req, res, next) {
    try {
      const groupId = await getGroupId(req);
      if (!groupId) {
        return res.status(400).send({ error: "Group ID not provided" });
      }

      const Group = require("../models/Group");
      const userGroups = await Group.GroupsIAmIn(req.user);
      const userGroupIds = userGroups.map((g) => g._id.toString());

      if (userGroupIds.includes(groupId.toString())) {
        next();
      } else if (req.user.isAdmin) {
        // Admins can access any group
        next();
      } else {
        return res
          .status(403)
          .send({
            error: "You do not have permission to access this resource",
          });
      }
    } catch (error) {
      return res
        .status(500)
        .send({ error: "Failed to verify group membership" });
    }
  };
};
