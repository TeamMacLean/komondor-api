const mongoose = require("mongoose");
const { join } = require("path");
const generateSafeName = require("../lib/utils/generateSafeName").default;
const fs = require("fs");
const NewsItem = require("./NewsItem");
const { buildVisibilityFilter } = require("../lib/utils/fullAccessUsers");

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
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

schema.pre("validate", async function () {
  // `name` is required, but this hook runs before required-field validation.
  // Without this guard the .replace() below throws a bare TypeError, which
  // surfaces to the client as an opaque 500 instead of a validation message.
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

schema.pre("bulkWrite", (next) => {
  next();
});
schema.pre("updateOne", (next) => {
  const data = this.getUpdate();
  next();
});
schema.post("update", (next) => {
  const data = this.getUpdate();
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

schema.statics.iCanSee = function iCanSee(user) {
  const filter = buildVisibilityFilter(user);
  return Project.find(filter === null ? {} : filter);
};

const Project = mongoose.model("Project", schema);

module.exports = Project;
