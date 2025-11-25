//import { Schema, model } from 'mongoose';
const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const NewsItem = require("./NewsItem");

const fs = require("fs");
const { join } = require("path");

//import generateSafeName from '../lib/utils/generateSafeName';
const generateSafeName = require("../lib/utils/generateSafeName").default;

const schema = new Schema(
  {
    name: { type: String, required: true }, // should NOT have unique, rely on path instead
    safeName: { type: String, required: true },
    sample: { type: Schema.Types.ObjectId, ref: "Sample", required: true },

    forceSafeName: { type: Boolean, default: false }, // workaround for old db migration

    sequencingProvider: { type: String, required: true },
    sequencingTechnology: { type: String, required: true },
    librarySource: { type: String, required: true },
    libraryType: { type: String, required: true }, // TODO link to librarytype actual model
    librarySelection: { type: String, required: true },
    insertSize: { type: String, required: false }, // required for some types, let frontend decide
    libraryStrategy: { type: String, required: true },
    owner: { type: String, required: true },
    group: { type: Schema.Types.ObjectId, ref: "Group", required: true },

    // Run processing status
    status: {
      type: String,
      enum: ["pending", "processing", "complete", "error"],
      default: "pending",
    },

    // ensure each element in array is unique?
    additionalFilesUploadIDs: [{ type: String }], // George has changed to array and renamed

    accessions: [{ type: String, unique: false, required: false }], // unique except null TODO

    // George add
    oldId: { type: String, required: false },
    oldSafeName: { type: String, unique: false, required: false }, // temp?
    path: { type: String }, // George add unique: true; surely required is true also? Also, why did Martin remove this?

    // Martin has removed
    // submissionToGalaxy: true/false,

    // NB
    // create new ID
    // create new safeName

    // no reference to reads , nb
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

schema.pre("validate", function () {
  if (this.forceSafeName) {
    return Promise.resolve();
  }

  return Run.find({})
    .then((allOthers) => {
      return generateSafeName(
        this.name,
        allOthers.filter((f) => f._id.toString() !== this._id.toString()),
      );
    })
    .then((safeName) => {
      this.safeName = safeName;

      const doc = this;
      return doc
        .populate({
          path: "sample",
        })
        .execPopulate()
        .then((populatedDoc) => {
          try {
            this.path = join(populatedDoc.sample.path, populatedDoc.safeName);
            return Promise.resolve();
          } catch (e) {
            return Promise.reject(e);
          }
        });
    });
});

schema.pre("save", function (next) {
  this.wasNew = this.isNew;
  next();
});

schema.post("save", async function (next) {
  const doc = this;

  const alreadyMadeArray = await NewsItem.find({ typeId: doc._id });
  const alreadyMade = !!alreadyMadeArray.length;

  if (alreadyMade) {
    console.log(
      "Run already a newsitem, so not creating that or making directory",
    );
    return Promise.resolve();
  } else {
    //create news item
    const NewsItem = require("./NewsItem");
    return new NewsItem({
      type: "run",
      typeId: doc._id,
      owner: doc.owner,
      group: doc.group,
      name: doc.name,
      body: doc.sequencingProvider,
    })
      .save()
      .then(() => {
        // create directory
        const absPath = join(process.env.DATASTORE_ROOT, this.path);
        return fs.promises.mkdir(absPath);
      })
      .catch((err) => {
        console.error(err);
        Promise.resolve();
      });
  }
});

schema.virtual("additionalFiles", {
  ref: "AdditionalFile",
  localField: "_id",
  foreignField: "run",
  justOne: false, // set true for one-to-one relationship
});
schema.virtual("rawFiles", {
  ref: "Read",
  localField: "_id",
  foreignField: "run",
  justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
  const doc = this;
  return doc
    .populate({
      path: "group",
    })
    .populate({
      path: "sample",
      populate: {
        path: "project",
      },
    })
    .execPopulate()
    .then((populatedDoc) => {
      return join(
        populatedDoc.group.safeName,
        populatedDoc.sample.project.safeName,
        populatedDoc.sample.safeName,
        populatedDoc.safeName,
      );
    });
};

schema.methods.getAbsPath = function getPath() {
  const doc = this;

  return doc.getRelativePath().then((relPath) => {
    return join(process.env.DATASTORE_ROOT, relPath);
  });
};

schema.statics.iCanSee = function iCanSee(user) {
  // if statement unnecessary
  if (
    user.username === "admin" ||
    process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username)
  ) {
    return Run.find({});
  }
  const filters = [{ owner: user.username }];
  if (user.groups) {
    user.groups.map((g) => {
      filters.push({ group: g });
    });
  }
  return Run.find({ $or: filters });
};

const Run = model("Run", schema);

module.exports = Run;
