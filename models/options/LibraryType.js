const mongoose = require("mongoose");

module.exports = mongoose.model(
  "LibraryType",
  new mongoose.Schema({
    value: { type: String, required: true, unique: true },
    paired: { type: Boolean, required: true },
    extensions: { type: [String], required: true },
    indexed: { type: Boolean, default: false },
  })
);
