const Group = require("../../models/Group");
const { isEnaAdmin } = require("./enaAdmins");

/**
 * Group authorisation. Read and write are separate capabilities on purpose:
 * full-access users read every group but write only where they are members.
 * ENA admins additionally create records and submit/retry run ingestion across
 * live groups.
 */

/**
 * Returns true when `groups` contains the group with id `groupId`.
 * @param {Array} groups - Groups the user holds the capability over.
 * @param {*} groupId - Group id to look for.
 * @returns {boolean} True if the group is present.
 */
const containsGroup = (groups, groupId) => {
  // Array.isArray, not truthiness: a non-array must fail closed.
  if (!Array.isArray(groups) || !groupId) {
    return false;
  }

  const wanted = groupId.toString();

  return groups.some(
    (group) => group && group._id && group._id.toString() === wanted,
  );
};

/** Groups the user may read. @param {Object} user @returns {Promise<Array>} */
const groupsICanRead = async (user) =>
  Group.GroupsIAmIn(user, { mode: "read" });

/** Groups the user may create, edit or delete. @param {Object} user @returns {Promise<Array>} */
const groupsICanWrite = async (user) =>
  Group.GroupsIAmIn(user, { mode: "write" });

/**
 * Groups where projects, samples and runs may be created and run ingestion
 * submitted/retried. ENA admins use their live read scope (all active groups);
 * everyone else needs ordinary write
 * access. Never bypass the lookup: deleted or nonexistent groups must fail.
 * @param {Object} user - Authenticated user.
 * @returns {Promise<Array>} Groups available for record creation.
 */
const groupsICanCreate = async (user) => {
  if (!user) {
    return [];
  }
  return isEnaAdmin(user.username)
    ? groupsICanRead(user)
    : groupsICanWrite(user);
};

/** @param {Object} user @param {*} groupId @returns {Promise<boolean>} */
const canCreateInGroup = async (user, groupId) => {
  if (!user || !groupId) {
    return false;
  }
  return containsGroup(await groupsICanCreate(user), groupId);
};

/**
 * Whether the user may read records belonging to a group.
 * No isAdmin short-circuit: it would let a deleted group keep authorising admins.
 * @param {Object} user - Authenticated user.
 * @param {*} groupId - Group being accessed.
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
 * @param {Object} user - Authenticated user.
 * @param {*} groupId - Group being written to.
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
 * @param {Function} getGroupId - (req) => group id, may be async.
 * @param {"read"|"write"} mode - Capability to require.
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

/** Middleware requiring read access. @param {Function} getGroupId @returns {Function} */
const requireGroupRead = (getGroupId) => requireGroupAccess(getGroupId, "read");

/** Middleware requiring write access. @param {Function} getGroupId @returns {Function} */
const requireGroupWrite = (getGroupId) =>
  requireGroupAccess(getGroupId, "write");

module.exports = {
  groupsICanRead,
  groupsICanWrite,
  groupsICanCreate,
  canCreateInGroup,
  canReadGroup,
  canWriteGroup,
  requireGroupRead,
  requireGroupWrite,
};
