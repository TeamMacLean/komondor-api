const mongoose = require("mongoose");

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

schema.statics.iCanSee = function iCanSee(user) {
  // if statement unnecessary
  if (
    user.username === "admin" ||
    process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username)
  ) {
    return NewsItem.find({});
  }
  const filters = [{ owner: user.username }];
  if (user.groups) {
    user.groups.map((g) => {
      filters.push({ group: g });
    });
  }
  return NewsItem.find({ $or: filters });
};

const NewsItem = mongoose.model("NewsItem", schema);

module.exports = NewsItem;
