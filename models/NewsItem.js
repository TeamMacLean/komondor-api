const mongoose = require("mongoose");
const { buildVisibilityFilter } = require("../lib/utils/fullAccessUsers");

const schema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    typeId: { type: String, required: true },
    owner: { type: String, required: true },
    group: { type: String, required: true },
    name: { type: String, required: true },
    body: { type: String, required: true },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

/**
 * The records this user may see, as a chainable mongoose Query.
 *
 * DELIBERATELY SYNCHRONOUS, and it must stay that way. A mongoose Query is a
 * thenable, so an `async` static returning `Model.find(...)` has the Query
 * executed by the caller's own await: the caller gets an array of documents
 * and every `.populate()`/`.sort()`/`.where()` chain throws. The database
 * round-trip that resolves live group membership therefore happens *before*
 * this call, and its result is passed in.
 *
 * `groupIds` is required precisely because it is the security-relevant half.
 * Omitting it used to mean "fall back to user.groups", the claim baked into
 * the JWT at login — which kept serving a group's records for the rest of a
 * token's life after that group was soft-deleted, while the per-record routes
 * refused the very same group. A missing argument now fails loudly instead of
 * quietly restoring that behaviour.
 *
 * @param {object} user - The authenticated user object.
 * @param {Array|null} groupIds - The live group ids from
 *   {@link module:lib/utils/fullAccessUsers.visibleGroupIds}; null for a
 *   full-access user, for whom no filter applies at all.
 * @returns {mongoose.Query} A query scoped to what the user may read.
 */
schema.statics.iCanSee = function iCanSee(user, groupIds) {
  if (groupIds !== null && !Array.isArray(groupIds)) {
    throw new TypeError(
      "NewsItem.iCanSee(user, groupIds) requires the live group ids from " +
        "visibleGroupIds(user); calling it with the user alone would fall " +
        "back to the token's stale groups claim.",
    );
  }

  const filter = buildVisibilityFilter(user, groupIds);
  return NewsItem.find(filter === null ? {} : filter);
};

const NewsItem = mongoose.model("NewsItem", schema);

module.exports = NewsItem;
