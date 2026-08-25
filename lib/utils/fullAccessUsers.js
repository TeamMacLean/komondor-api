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
 * Whether a user holds the cross-group read capability.
 *
 * This is now only asked by routes/middleware.js, to gate the accessions
 * export. It is deliberately *not* consulted when building a visibility
 * filter: expressing "sees everything" as a missing filter let those
 * principals read records in soft-deleted groups. Their reach is expressed as
 * a group list instead — Group.GroupsIAmIn hands them every live group — so
 * that one function decides who may read what.
 *
 * @param {object} user - The authenticated user object.
 * @returns {boolean} True if the user has the cross-group read capability.
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
 * There is deliberately no `hasFullRecordsAccess` short-circuit here, for the
 * same reason there is none in groupAccess.canReadGroup: it returned null,
 * null means "no filter", and `Model.find({})` includes records belonging to
 * *soft-deleted* groups — which canReadGroup refuses. Admins and
 * FULL_RECORDS_ACCESS_USERS were the only principals who could see that
 * disagreement, and the admin screen is where they would see it. Their reach
 * is now expressed the same way everyone else's is: GroupsIAmIn hands them
 * every live group, and those ids arrive here as `groupIds`.
 *
 * Consequently this never returns null and can never produce an empty filter:
 * unresolvable membership matches nothing rather than everything.
 *
 * @param {object} user - The authenticated user object. Only used to fail
 *   closed; the group ids carry the whole decision.
 * @param {Array} groupIds - The live group ids to authorise against, from
 *   {@link visibleGroupIds}. There is no fallback to the `groups` claim on the
 *   token: that claim is only as fresh as the token, and trusting it is the
 *   bug the live lookup exists to remove.
 * @returns {object} A mongoose filter.
 */
const buildVisibilityFilter = (user, groupIds) => {
  // No principal at all: match nothing, whatever ids the caller resolved.
  if (!user) {
    return { _id: { $in: [] } };
  }

  const ids = normaliseGroupIds(groupIds);

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
 * @returns {Promise<object>} A mongoose filter.
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
 * Always an array, for every principal. It used to return null — "no filter at
 * all" — for admins and FULL_RECORDS_ACCESS_USERS, which made the list, search
 * and news queries `Model.find({})` and so served records belonging to
 * soft-deleted groups, while canReadGroup refused the very same group on the
 * per-record route. Deriving the ids from groupsICanRead for *everyone* is
 * what makes the two layers agree: GroupsIAmIn already gives those principals
 * every group, and it already excludes deleted ones.
 *
 * The cost is one extra Group.find per list/search/news request for the
 * principals that previously skipped it (search resolves once per model, so
 * three), and a `$in` carrying every live group id instead of no filter at
 * all. Both scale with the number of groups, which is small and administrator-
 * created; neither scales with the number of records.
 *
 * groupAccess is required lazily because models/Group requires this module: a
 * top-level require would close the cycle Group -> fullAccessUsers ->
 * groupAccess -> Group.
 *
 * @param {object} user - The authenticated user object.
 * @returns {Promise<Array>} The live group ids the user may read.
 */
const visibleGroupIds = async (user) => {
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
