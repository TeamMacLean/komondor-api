const mongoose = require("mongoose");
const { join } = require("path");
const generateSafeName = require("../lib/utils/generateSafeName").default;
const fs = require("fs");
const NewsItem = require("./NewsItem");
const { buildVisibilityFilter } = require("../lib/utils/fullAccessUsers");
const {
  STORAGE_STATES,
  MIGRATION_PHASES,
  publicStorageSummary,
} = require("../lib/storage-state");

const ArchiveMigrationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    phase: { type: String, enum: MIGRATION_PHASES, required: true },
    movedBy: { type: String, required: true },
    osUser: String,
    awsIdentityArn: String,
    awsAccountId: String,
    startedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    sourceRoot: { type: String, required: true },
    sourceRelativeRoot: { type: String, required: true },
    lastError: {
      at: Date,
      phase: String,
      message: String,
    },
    failedAt: Date,
    resumeCount: { type: Number, default: 0 },
    lastResumedBy: String,
    lastResumedAt: Date,
    anomalyAcknowledgement: {
      by: String,
      at: Date,
      manifestSha256: String,
    },
    manifests: {
      version: Number,
      sourceS3Uri: String,
      sourceSha256: String,
      sourceSealedAt: Date,
      verificationS3Uri: String,
      verificationSha256: String,
      verificationSealedAt: Date,
      fileCount: Number,
      totalBytes: Number,
      skippedEntries: Number,
    },
    confirmedAbsentBy: String,
    abortedBy: String,
    abortedAt: Date,
    restartedFrom: [String],
  },
  { _id: false },
);

const projectToJson = (_doc, ret) => {
  ret.storage = publicStorageSummary(ret);
  // This is operational audit state, not part of the public API contract.
  delete ret.archiveMigration;
  return ret;
};

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // keep unique but update UI to reflect this // TODO
    safeName: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    shortDesc: { type: String, required: true },
    longDesc: { type: String, required: true },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    isPublic: { type: Boolean, default: false },

    // GG new fields
    oldId: { type: String }, // TODO i dont think i need this but hard to extract // warning, post migration i removed unique=true
    oldSafeName: { type: String, unique: false, required: false }, // temp?
    secondaryOwner: { type: String, required: false },
    path: { type: String, required: false, unique: true }, // George add unique: true; surely required is true also?

    accessions: [{ type: String, unique: false }], // unique except null TODO
    releaseDate: { type: String, unique: false }, // 'DD-MM-YYYY' format; ENA

    // TODO ensure each is unique?
    additionalFilesUploadIDs: [{ type: String }], // George has created (was missing with Martin)

    // George, these 2 are entirely redundant
    doNotSendToEna: { type: Boolean, default: false },
    doNotSendToEnaReason: { type: String },

    // NUDGE feature 13-9-2022
    nudges: {
      type: [Date],
    },
    nudgeable: { type: Boolean, default: true },

    // Project is the single source of truth for storage. There is no default:
    // legacy records without this field deliberately resolve to "hpc".
    storage: {
      state: { type: String, enum: STORAGE_STATES },
      s3Uri: String,
      s3VerifiedAt: Date,
      hpcVerifiedAbsentAt: Date,
      archivedAt: Date,
    },
    archiveMigration: {
      type: ArchiveMigrationSchema,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: projectToJson },
  },
);

schema.index({ "storage.state": 1 });

schema.pre("validate", async function () {
  // Runs before required-field validation, so guard: .replace() on a missing
  // name throws a TypeError the client sees as a 500, not a validation error.
  if (typeof this.name !== "string" || !this.name) {
    this.invalidate("name", "Project name is required.", this.name);
    return;
  }

  const baseSafeName = this.name
    .replace("&", "and")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const escapedSafeName = baseSafeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matchingOthers = await Project.find({
    safeName: { $regex: new RegExp("^" + escapedSafeName, "i") },
    _id: { $ne: this._id },
  }).select("safeName");
  const safeName = await generateSafeName(this.name, matchingOthers);
  this.safeName = safeName;
  const doc = this;
  const populatedDoc = await doc
    .populate({
      path: "group",
    })
    .execPopulate();
  try {
    this.path = join("/", populatedDoc.group.safeName, populatedDoc.safeName);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
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
      "already made this project, so wont check dir or make newsitem",
    );
    return Promise.resolve();
  } else {
    console.log("new project");

    async function createNewsItem() {
      try {
        const savedNewsItem = await new NewsItem({
          type: "project",
          typeId: doc._id,
          owner: doc.owner,
          group: doc.group._id || doc.group,
          name: doc.name,
          body: doc.shortDesc,
        }).save();
        return Promise.resolve();
      } catch (err) {
        console.error(err);
        return Promise.resolve();
      }
    }

    // PLEASE ADJUST OTHER MODELS

    // create directory
    const absPath = join(process.env.DATASTORE_ROOT, this.path);
    try {
      console.log("will make this dir", absPath, "...:");
      await fs.promises.mkdir(absPath, { recursive: true });
    } catch (e) {
      console.log("...error mkdir of new project", e, absPath);
      // find another way to mkdir
      return Promise.reject(e);
    }
    console.log("...dir creation (probably) successful, now create newsitem");
    return createNewsItem();
  }
});

// Any query hook added here needs a regular function, not an arrow: `this`
// must be the query for `this.getUpdate()` to exist.
schema.pre("bulkWrite", (next) => {
  next();
});

schema.virtual("samples", {
  ref: "Sample",
  localField: "_id",
  foreignField: "project",
  justOne: false, // set true for one-to-one relationship
});

schema.virtual("additionalFiles", {
  ref: "AdditionalFile",
  localField: "_id",
  foreignField: "project",
  justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
  const doc = this;
  return doc
    .populate({
      path: "group",
    })
    .execPopulate()
    .then((populatedDoc) => {
      return join(populatedDoc.group.safeName, populatedDoc.safeName);
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
      "Project.iCanSee(user, groupIds) requires the live group ids from " +
        "visibleGroupIds(user); calling it with the user alone would fall " +
        "back to the token's stale groups claim.",
    );
  }

  const filter = buildVisibilityFilter(user, groupIds);
  // Passed straight through: a `filter || {}` fallback here would be find({}).
  // The public transform needs the hidden migration timestamps/error to derive
  // migrationHealth. It strips the whole archiveMigration object before JSON.
  return Project.find(filter).select("+archiveMigration");
};

const Project = mongoose.model("Project", schema);

module.exports = Project;
