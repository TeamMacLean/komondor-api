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

schema.statics.iCanSee = function iCanSee(user) {
  const filter = buildVisibilityFilter(user);
  return NewsItem.find(filter === null ? {} : filter);
};

const NewsItem = mongoose.model("NewsItem", schema);

module.exports = NewsItem;
