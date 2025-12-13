//import { Schema, model } from 'mongoose';
const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const Run = require("./Run");
const _path = require("path");

const schema = new Schema(
  {
    run: {
      type: Schema.Types.ObjectId,
      ref: "Run",
      required: true,
      unique: false,
    },
    file: {
      type: Schema.Types.ObjectId,
      ref: "File",
      required: true,
      unique: true,
    },
    MD5: { type: String }, // Original MD5 checksum provided by user
    destinationMd5: { type: String }, // MD5 calculated after file moved to destination
    md5Mismatch: { type: Boolean, default: null }, // null = not checked, true = mismatch, false = match
    MD5LastChecked: { type: Date }, // Timestamp when MD5 was last checked
    paired: { type: Boolean }, // removed required because of migration script
    sibling: { type: Schema.Types.ObjectId, ref: "Read" },

    oldReadId: { type: String }, // George added, basically a flag for migration
    oldSiblingID: { type: String }, //https://stackoverflow.com/questions/7955040/mongodb-mongoose-unique-if-not-null
    oldRunID: { type: String },

    skipPostSave: { type: Boolean, default: false },

    indexed: { type: Boolean, default: false },

    // check with Martin whether to keep these
    // oldLegacyPath: { type: String },
    // oldFileName: { type: String },
    // oldSafeName: { type: String },
    // oldProcessed: { type: Boolean },
    // oldFastQCLocation: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

schema.pre("save", function (next) {
  this.wasNew = this.isNew;
  next();
});

schema.post("save", async function (doc) {
  if (doc.skipPostSave) {
    return;
  }

  try {
    const run = await Run.findById(doc.run);
    if (!run) {
      throw new Error(`Run not found for Read: ${doc._id}, run ID: ${doc.run}`);
    }

    await doc.populate("file").execPopulate();
    if (!doc.file) {
      throw new Error(`File not found for Read: ${doc._id}`);
    }

    const relPath = await run.getRelativePath();
    if (!relPath) {
      throw new Error(`Could not get relative path for Run: ${run._id}`);
    }

    // we are relying on /raw dir to have been previously created!
    const rawPath = _path.join(relPath, "raw");
    const relPathWithFilename = _path.join(rawPath, doc.file.originalName);
    console.log("calling file.moveToFolderAndSave() with", relPathWithFilename);
    await doc.file.moveToFolderAndSave(relPathWithFilename);
  } catch (e) {
    console.error("Error in Read post-save hook:", e);
    throw e;
  }
});

const Read = model("Read", schema);

module.exports = Read;
