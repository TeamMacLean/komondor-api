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

// Indexes for performance
//
// { sample, name } is unique because POST /runs/new treats a hit on
// Run.findOne({ sample, name }) as an idempotent repeat and returns the
// existing run. Without the constraint that check is advisory: two concurrent
// identical POSTs both miss the findOne, both insert, and the second run
// queues a second ingest for the same source files — which can only fail, the
// first ingest having already moved them (File.moveToFolderAndSave refuses to
// clobber a destination).
//
// NB adding this to an existing collection needs a duplicate check first:
// createIndex fails outright if any { sample, name } pair is already doubled
// up, and mongoose logs that failure rather than throwing.
schema.index({ sample: 1, name: 1 }, { unique: true }); // For idempotency checks
schema.index({ status: 1 }); // For querying runs by status
schema.index({ md5VerificationStatus: 1 }); // For background job queries
schema.index({ createdAt: -1 }); // For sorting by creation time
schema.index({ group: 1, createdAt: -1 }); // For group-specific queries

schema.pre("validate", function () {
  if (this.forceSafeName) {
    return Promise.resolve();
  }

  // `name` is required, but this hook runs before required-field validation.
  // Without this guard the .replace() below throws a bare TypeError, which
  // surfaces to the client as an opaque 500 instead of a validation message.
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
 * @param {Array} groupIds - The live group ids from
 *   {@link module:lib/utils/fullAccessUsers.visibleGroupIds}. Always an array,
 *   for every principal including a full-access one: `null` used to mean "no
 *   filter applies at all", which is what let those principals read records in
 *   soft-deleted groups. `null` is still *accepted* here, and maps to a filter
 *   matching nothing, so anything that reintroduces the old sentinel fails
 *   closed rather than reopening the collection.
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
  // No `filter === null ? {} : filter` fallback. buildVisibilityFilter can
  // no longer return null, so that branch was dead — and it was the branch
  // that produced an *unfiltered* query. Passing the filter straight through
  // means this static has no path at all to `Run.find({})`.
  return Run.find(filter);
};

const Run = model("Run", schema);

module.exports = Run;
