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
 * Reduces a list of group ids to the distinct, non-empty strings in it.
 *
 * Ids arrive either as strings from a token claim or as ObjectIds from the
 * database, and the four record models disagree about the type (`NewsItem.group`
 * is a String, the rest are ObjectId refs), so everything is normalised to a
 * string: mongoose casts those for either schema. It also means a claim that
 * somehow carried an object cannot reach mongo as a query operator.
 *
 * @param {*} ids - The candidate group ids.
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
 * Returns null when the user should see everything (caller should not filter).
 *
 * Visibility is *group* visibility, and nothing else. `owner` used to be a
 * standalone `$or` clause, which made it a permanent read grant that removing
 * somebody from a group could not withdraw: they kept reading every record they
 * had ever created there. Worse, `owner` is copied verbatim out of req.body
 * when a record is created, so a client could name any username as the owner
 * and hand that person access to a group they were never in. Owning a record
 * now only ever narrows what group membership already allows — every record
 * model requires `group`, so nothing is left unreachable by dropping the clause.
 *
 * @param {object} user - The authenticated user object.
 * @param {Array} [groupIds] - The group ids to authorise against. Defaults to
 *   the `groups` claim on the token, which is only as fresh as the token;
 *   {@link resolveVisibilityFilter} passes the live list instead.
 * @returns {object|null} A mongoose filter, or null for unrestricted access.
 */
const buildVisibilityFilter = (user, groupIds) => {
  if (hasFullRecordsAccess(user)) {
    return null;
  }

  const ids = normaliseGroupIds(
    Array.isArray(groupIds) ? groupIds : user && user.groups,
  );

  // Belongs to nothing: match nothing rather than everything.
  if (ids.length === 0) {
    return { _id: { $in: [] } };
  }

  return { group: { $in: ids } };
};

/**
 * The database-backed form of {@link buildVisibilityFilter}.
 *
 * `user.groups` is baked into the JWT at login, so a group soft-deleted
 * afterwards stayed in the claim for the rest of that token's life. The
 * per-record routes refused it — canReadGroup goes through GroupsIAmIn, which
 * filters `deleted` — while the list, search and news endpoints went on serving
 * its records from the stale claim. Two layers of the same system disagreeing
 * about one group is the failure this is here to stop, so membership is
 * re-derived through the very function the per-record checks use.
 *
 * groupAccess is required lazily because models/Group requires this module: a
 * top-level require would close the cycle Group -> fullAccessUsers ->
 * groupAccess -> Group.
 *
 * @param {object} user - The authenticated user object.
 * @returns {Promise<object|null>} A mongoose filter, or null for unrestricted access.
 */
const resolveVisibilityFilter = async (user) =>
  buildVisibilityFilter(user, await visibleGroupIds(user));

/**
 * The live group ids a user may read, in the form `iCanSee` wants them.
 *
 * This is the half of the visibility decision that has to touch the database.
 * It exists as its own export because `iCanSee` cannot be async — a mongoose
 * Query is a thenable, so an async static returning one has it executed by the
 * caller's await (see the comment on any model's iCanSee). Callers await this
 * first and hand the result to the synchronous query builder.
 *
 * Returns null, not an empty array, for a user with full records access: null
 * means "no filter at all", where [] means "belongs to nothing, match
 * nothing". The two are opposites, so they must not be conflated.
 *
 * groupAccess is required lazily because models/Group requires this module: a
 * top-level require would close the cycle Group -> fullAccessUsers ->
 * groupAccess -> Group.
 *
 * @param {object} user - The authenticated user object.
 * @returns {Promise<Array|null>} The live group ids, or null for full access.
 */
const visibleGroupIds = async (user) => {
  if (hasFullRecordsAccess(user)) {
    return null;
  }

  // GroupsIAmIn throws without a user; visibility fails closed.
  if (!user) {
    return [];
  }

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
