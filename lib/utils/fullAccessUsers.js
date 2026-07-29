/**
 * Parses the FULL_RECORDS_ACCESS_USERS environment variable into a list of usernames.
 *
 * The variable may be a JSON array (`["alice", "bob"]`) or a comma-separated
 * string (`alice,bob`). Both forms are supported so existing deployments keep
 * working whichever format they use.
 *
 * Previously callers did `process.env.FULL_RECORDS_ACCESS_USERS.includes(username)`,
 * which is a *substring* test against the raw string. A username such as "s" or
 * "user" matched the literal text of the JSON array and silently granted access
 * to every record in the database. This module does exact matching instead.
 *
 * @returns {string[]} The configured usernames, or an empty array if unset/unparseable.
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
 * Determines whether a user may see every record, regardless of group membership.
 *
 * @param {object} user - The authenticated user object.
 * @returns {boolean} True if the user has unrestricted read access.
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
 * Builds the mongoose filter describing the records a user may see.
 * Returns null when the user should see everything (caller should not filter).
 *
 * @param {object} user - The authenticated user object.
 * @returns {object|null} A mongoose `$or` filter, or null for unrestricted access.
 */
const buildVisibilityFilter = (user) => {
  if (hasFullRecordsAccess(user)) {
    return null;
  }

  const filters = [];

  if (user && typeof user.username === "string" && user.username) {
    filters.push({ owner: user.username });
  }

  if (user && Array.isArray(user.groups)) {
    user.groups.forEach((group) => {
      if (group) {
        filters.push({ group });
      }
    });
  }

  // No identifying information at all: match nothing rather than everything.
  if (filters.length === 0) {
    return { _id: { $in: [] } };
  }

  return { $or: filters };
};

module.exports = {
  getFullAccessUsers,
  hasFullRecordsAccess,
  buildVisibilityFilter,
};
