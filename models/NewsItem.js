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
 * Synchronous on purpose: a mongoose Query is a thenable, so an async static
 * returning one has it executed by the caller's await and every chain throws.
 * @param {object} user - Authenticated user.
 * @param {Array} groupIds - Live group ids from visibleGroupIds(user); the
 *   token's `groups` claim is stale for groups deleted since login.
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
  // Passed straight through: a `filter || {}` fallback here would be find({}).
  return NewsItem.find(filter);
};

const NewsItem = mongoose.model("NewsItem", schema);

module.exports = NewsItem;
