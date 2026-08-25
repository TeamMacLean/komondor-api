const Group = require("../../models/Group");

/**
 * The single place route handlers ask "may this user do X in this group?".
 *
 * routes/projects.js, routes/samples.js and routes/runs.js each grew their own
 * copy of userCanAccessGroup() on top of Group.GroupsIAmIn, and all three used
 * it to authorise writes as well as reads. That is how the cross-group *read*
 * capability held by FULL_RECORDS_ACCESS_USERS silently became a licence to
 * write into every group. One implementation, asked two different questions,
 * means the two cannot drift apart again.
 */

/**
 * Returns true when `groups` contains the group with id `groupId`.
 *
 * @param {Array} groups - Groups the user holds the capability over.
 * @param {*} groupId - The group id to look for (ObjectId or string).
 * @returns {boolean} True if the group is present.
 */
const containsGroup = (groups, groupId) => {
  if (!Array.isArray(groups) || !groupId) {
    return false;
  }

  const wanted = groupId.toString();

  return groups.some((group) => group && group._id && group._id.toString() === wanted);
};

/**
 * Every group whose records the user may read.
 * Admins and FULL_RECORDS_ACCESS_USERS get all of them.
 *
 * @param {Object} user - The authenticated user object.
 * @returns {Promise<Array>} Groups readable by the user.
 */
const groupsICanRead = async (user) => Group.GroupsIAmIn(user, { mode: "read" });

/**
 * Every group whose records the user may create, edit or delete.
 * Only admins get all of them; everyone else gets their real membership.
 *
 * @param {Object} user - The authenticated user object.
 * @returns {Promise<Array>} Groups writable by the user.
 */
const groupsICanWrite = async (user) =>
  Group.GroupsIAmIn(user, { mode: "write" });

/**
 * Whether the user may read records belonging to a group.
 *
 * There is deliberately no `user.isAdmin` short-circuit here: an admin's
 * authority is already expressed by GroupsIAmIn handing them every group, and
 * short-circuiting would let a soft-deleted group keep authorising admins.
 *
 * @param {Object} user - The authenticated user object.
 * @param {*} groupId - The group id being accessed.
 * @returns {Promise<boolean>} True if the user may read the group.
 */
const canReadGroup = async (user, groupId) => {
  if (!user || !groupId) {
    return false;
  }

  return containsGroup(await groupsICanRead(user), groupId);
};

/**
 * Whether the user may write records belonging to a group.
 *
 * @param {Object} user - The authenticated user object.
 * @param {*} groupId - The group id being written to.
 * @returns {Promise<boolean>} True if the user may write to the group.
 */
const canWriteGroup = async (user, groupId) => {
  if (!user || !groupId) {
    return false;
  }

  return containsGroup(await groupsICanWrite(user), groupId);
};

/**
 * Builds the express middleware for one capability.
 *
 * @param {Function} getGroupId - (req) => group id, may be async.
 * @param {"read"|"write"} mode - The capability to require.
 * @returns {Function} An express middleware.
 */
const requireGroupAccess = (getGroupId, mode) => {
  const verb = mode === "write" ? "modify" : "view";

  return async function (req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).send({ error: "Authentication required" });
      }

      const groupId = await getGroupId(req);
      if (!groupId) {
        return res.status(400).send({ error: "Group ID not provided" });
      }

      const allowed =
        mode === "write"
          ? await canWriteGroup(req.user, groupId)
          : await canReadGroup(req.user, groupId);

      if (!allowed) {
        console.error(
          `[AUTHZ] Refused ${mode} on group ${groupId} to "${req.user.username}"`,
        );
        return res.status(403).send({
          error: `User '${req.user.username}' does not have permission to ${verb} this resource`,
        });
      }

      return next();
    } catch (error) {
      console.error("[AUTHZ] Failed to verify group membership:", error);
      return res
        .status(500)
        .send({ error: "Failed to verify group membership" });
    }
  };
};

/**
 * Middleware requiring read access to the group named by `getGroupId`.
 *
 * @param {Function} getGroupId - (req) => group id, may be async.
 * @returns {Function} An express middleware.
 */
const requireGroupRead = (getGroupId) => requireGroupAccess(getGroupId, "read");

/**
 * Middleware requiring write access to the group named by `getGroupId`.
 *
 * @param {Function} getGroupId - (req) => group id, may be async.
 * @returns {Function} An express middleware.
 */
const requireGroupWrite = (getGroupId) =>
  requireGroupAccess(getGroupId, "write");

module.exports = {
  groupsICanRead,
  groupsICanWrite,
  canReadGroup,
  canWriteGroup,
  requireGroupRead,
  requireGroupWrite,
};
