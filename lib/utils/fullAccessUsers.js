/**
 * Parses FULL_RECORDS_ACCESS_USERS (JSON array or comma-separated) into usernames.
 * Match exactly: `.includes()` on the raw string is a substring test, so a
 * username like "s" would match the config text and be granted access.
 * @returns {string[]} Configured usernames, empty if unset or unparseable.
 */
const getFullAccessUsers = () => {
  const raw = process.env.FULL_RECORDS_ACCESS_USERS;

  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return [];
  }

  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (typeof parsed === "string") {
      return parsed.trim() ? [parsed.trim()] : [];
    }
  } catch (e) {
    // Not JSON — fall through to comma-separated parsing.
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * Whether a user holds the cross-group read capability.
 * Not for visibility filters — use visibleGroupIds, which excludes deleted groups.
 * @param {object} user - Authenticated user.
 * @returns {boolean} True if the user has cross-group read.
 */
const hasFullRecordsAccess = (user) => {
  if (!user) {
    return false;
  }

  if (user.isAdmin === true) {
    return true;
  }

  const username = user.username;
  if (!username || typeof username !== "string") {
    return false;
  }

  if (username === "admin") {
    return true;
  }

  return getFullAccessUsers().includes(username);
};

/**
 * Reduces a list of group ids to the distinct, non-empty strings in it.
 * Strings, not raw values: models disagree on the type (NewsItem.group is a
 * String, the rest ObjectId), and an object would reach mongo as an operator.
 * @param {*} ids - Candidate group ids.
 * @returns {string[]} The usable ids.
 */
const normaliseGroupIds = (ids) => {
  if (!Array.isArray(ids)) {
    return [];
  }

  const seen = new Set();

  ids.forEach((id) => {
    if (id === null || id === undefined || id === "") {
      return;
    }

    const asString = id.toString();
    if (asString) {
      seen.add(asString);
    }
  });

  return [...seen];
};

/**
 * Builds the mongoose filter describing the records a user may see.
 * Group visibility only — no `owner` clause: owner is copied from req.body, so
 * it would grant reads that removing the user from the group cannot withdraw.
 * Never returns null or `{}`: unresolvable membership must match nothing.
 * @param {object} user - Authenticated user, only used to fail closed.
 * @param {Array} groupIds - Live group ids from {@link visibleGroupIds}, not the token claim.
 * @returns {object} A mongoose filter.
 */
const buildVisibilityFilter = (user, groupIds) => {
  if (!user) {
    return { _id: { $in: [] } };
  }

  const ids = normaliseGroupIds(groupIds);

  if (ids.length === 0) {
    return { _id: { $in: [] } };
  }

  return { group: { $in: ids } };
};

/**
 * The database-backed form of {@link buildVisibilityFilter}.
 * @param {object} user - Authenticated user.
 * @returns {Promise<object>} A mongoose filter.
 */
const resolveVisibilityFilter = async (user) =>
  buildVisibilityFilter(user, await visibleGroupIds(user));

/**
 * The live group ids a user may read, in the form `iCanSee` wants them.
 * Separate from iCanSee because iCanSee cannot be async: a mongoose Query is a
 * thenable, so the caller's await would execute it prematurely.
 * @param {object} user - Authenticated user.
 * @returns {Promise<Array>} Live group ids the user may read.
 */
const visibleGroupIds = async (user) => {
  if (!user) {
    return [];
  }

  // Lazy require: models/Group requires this module, so a top-level require
  // would close the cycle Group -> fullAccessUsers -> groupAccess -> Group.
  const { groupsICanRead } = require("./groupAccess");
  const groups = await groupsICanRead(user);

  return (Array.isArray(groups) ? groups : []).map(
    (group) => group && group._id,
  );
};

module.exports = {
  getFullAccessUsers,
  hasFullRecordsAccess,
  buildVisibilityFilter,
  resolveVisibilityFilter,
  visibleGroupIds,
};
