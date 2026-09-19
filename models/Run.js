//import { Schema, model } from 'mongoose';
const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const NewsItem = require("./NewsItem");

const fs = require("fs");
const { join } = require("path");

//import generateSafeName from '../lib/utils/generateSafeName';
const generateSafeName = require("../lib/utils/generateSafeName").default;
const { buildVisibilityFilter } = require("../lib/utils/fullAccessUsers");

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

    // MD5 verification tracking
    md5VerificationStatus: {
      type: String,
      enum: ["pending", "in_progress", "complete", "failed"],
      default: "pending",
    },
    md5VerificationAttempts: { type: Number, default: 0 },
    md5VerificationLastAttempt: { type: Date },
    md5VerificationCompletedAt: { type: Date },
    // A completed check is not necessarily a passing check. Preserve the
    // outcome separately, including deliberately skipped verification.
    md5VerificationResult: {
      verified: Number,
      mismatches: Number,
      errors: Number,
      skipped: Number,
      total: Number,
      disabled: Boolean,
    },

    // Error details surfaced when status is 'error'
    statusError: { type: String },

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

// Indexes for performance.
//
// { sample, name } must be unique: POST /runs/new's findOne idempotency check
// is only advisory without it, so two concurrent identical POSTs both insert.
// NB on an existing collection, check for duplicates first — createIndex fails
// on them and mongoose logs that failure rather than throwing.
schema.index({ sample: 1, name: 1 }, { unique: true }); // For idempotency checks
schema.index({ status: 1 }); // For querying runs by status
schema.index({ md5VerificationStatus: 1 }); // For background job queries
schema.index({ createdAt: -1 }); // For sorting by creation time
schema.index({ group: 1, createdAt: -1 }); // For group-specific queries

schema.pre("validate", function () {
  if (this.forceSafeName) {
    return Promise.resolve();
  }

  // This hook runs before required-field validation, so without the guard the
  // .replace() below throws a TypeError and the client gets a 500, not a
  // validation message.
  if (typeof this.name !== "string" || !this.name) {
    this.invalidate("name", "Run name is required.", this.name);
    return Promise.resolve();
  }

  const baseSafeName = this.name
    .replace("&", "and")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const escapedSafeName = baseSafeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return Run.find({
    safeName: { $regex: new RegExp("^" + escapedSafeName, "i") },
    _id: { $ne: this._id },
  })
    .select("safeName")
    .then((matchingRuns) => {
      return generateSafeName(this.name, matchingRuns);
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
        return fs.promises.mkdir(absPath, { recursive: true });
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

/**
 * The records this user may see, as a chainable mongoose Query.
 *
 * Must stay synchronous: an `async` static would have the caller's await
 * execute the Query, so callers would get an array and every chained
 * .populate()/.sort() would throw.
 *
 * @param {object} user - The authenticated user.
 * @param {Array} groupIds - Live group ids from visibleGroupIds(user). Required
 *   rather than defaulted, because falling back to the token's `groups` claim
 *   serves soft-deleted groups until the token expires. `null` is accepted and
 *   maps to a filter matching nothing, so the old sentinel fails closed.
 * @returns {mongoose.Query} A query scoped to what the user may read.
 */
schema.statics.iCanSee = function iCanSee(user, groupIds) {
  if (groupIds !== null && !Array.isArray(groupIds)) {
    throw new TypeError(
      "Run.iCanSee(user, groupIds) requires the live group ids from " +
        "visibleGroupIds(user); calling it with the user alone would fall " +
        "back to the token's stale groups claim.",
    );
  }

  const filter = buildVisibilityFilter(user, groupIds);
  // Passed straight through, with no null-to-{} fallback: that fallback is a
  // path to an unfiltered Run.find({}).
  return Run.find(filter);
};

const Run = model("Run", schema);

module.exports = Run;
