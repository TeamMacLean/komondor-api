const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const NewsItem = require("./NewsItem");

const generateSafeName = require("../lib/utils/generateSafeName").default;
const fs = require("fs");
const { join } = require("path");

const schema = new Schema(
  {
    name: { type: String, required: false }, // Keep as false if frontend sends null for Tplex initially
    safeName: { type: String, required: false }, // Still required:false for schema (but generated in hook)
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    scientificName: { type: String, required: false },
    commonName: { type: String, required: false },
    ncbi: { type: String, required: false },
    conditions: { type: String, required: false },
    owner: { type: String, required: true },
    group: { type: Schema.Types.ObjectId, ref: "Group", required: true },

    oldId: { type: String },

    accessions: [{ type: String, unique: false }],

    additionalFilesUploadIDs: [{ type: String }],

    path: { type: String, required: false, unique: true },
    oldSafeName: { type: String, unique: false, required: false },
    sampleGroup: { type: String, required: false },

    tplexCsv: { type: String, required: false },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

// Indexes for performance
schema.index({ project: 1, name: 1 }); // For idempotency checks
schema.index({ group: 1, createdAt: -1 }); // For group-specific queries
schema.index({ createdAt: -1 }); // For sorting by creation time

schema.pre("validate", function (next) {
  const doc = this;

  // Handle conditional required fields based on tplexCsv
  if (!doc.tplexCsv) {
    // Non-tplex samples require these fields
    if (!doc.scientificName) {
      doc.invalidate(
        "scientificName",
        "Scientific Name is required for non-Tplex samples.",
        doc.scientificName,
      );
    }
    if (!doc.commonName) {
      doc.invalidate(
        "commonName",
        "Common Name is required for non-Tplex samples.",
        doc.commonName,
      );
    }
    if (!doc.ncbi) {
      doc.invalidate(
        "ncbi",
        "NCBI Taxonomy ID is required for non-Tplex samples.",
        doc.ncbi,
      );
    }
    if (!doc.conditions) {
      doc.invalidate(
        "conditions",
        "Conditions are required for non-Tplex samples.",
        doc.conditions,
      );
    }
    if (doc.ncbi && isNaN(doc.ncbi)) {
      doc.invalidate("ncbi", "NCBI Taxonomy ID must be a number.", doc.ncbi);
    }
  } else {
    // Tplex samples: convert empty strings to null
    if (doc.scientificName === "") doc.scientificName = null;
    if (doc.commonName === "") doc.commonName = null;
    if (doc.ncbi === "") doc.ncbi = null;
    if (doc.conditions === "") doc.conditions = null;
  }

  // Generate base name for safeName creation
  const baseNameForSafeName =
    doc.name && doc.name.length > 0
      ? doc.name
      : `tplex-sample-${doc.project.toString().slice(-6)}`;

  // Generate safeName and set paths
  const baseSafeName = baseNameForSafeName
    .replace("&", "and")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const escapedSafeName = baseSafeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  Sample.find({
    safeName: { $regex: new RegExp("^" + escapedSafeName, "i") },
    _id: { $ne: doc._id },
  })
    .select("safeName")
    .then((matchingSamples) => {
      // Return existing safeName or generate new one
      if (doc.safeName) {
        return Promise.resolve(doc.safeName);
      }

      return generateSafeName(baseNameForSafeName, matchingSamples);
    })
    .then((safeName) => {
      doc.safeName = safeName;

      // Set name to safeName if not already provided
      if (!doc.name || doc.name === "") {
        doc.name = doc.safeName;
      }

      return doc.populate({ path: "project" }).execPopulate();
    })
    .then((populatedDoc) => {
      // Debug logging
      // console.log("Debug path generation:", {
      //   projectExists: !!populatedDoc.project,
      //   projectPath: populatedDoc.project && populatedDoc.project.path,
      //   safeName: doc.safeName,
      //   safeNameType: typeof doc.safeName,
      // });

      if (!populatedDoc.project) {
        throw new Error("Project not found for sample path generation.");
      }

      if (!populatedDoc.project.path) {
        throw new Error("Project path not found for sample path generation.");
      }

      if (!doc.safeName) {
        throw new Error("SafeName not generated for sample path generation.");
      }

      doc.path = join(populatedDoc.project.path, doc.safeName);
      next();
    })
    .catch((err) => {
      console.error("Error in Sample pre-validate hook:", err);
      doc.invalidate(
        "general",
        `An error occurred during sample validation: ${err.message}`,
      );
      next(err);
    });
});

schema.pre("save", function (next) {
  this.wasNew = this.isNew;

  if (this.tplexCsv === "") {
    this.tplexCsv = undefined;
  }

  next();
});

schema.post("save", async function (next) {
  const doc = this;

  const alreadyMadeArray = await NewsItem.find({ typeId: doc._id });
  const alreadyMade = !!alreadyMadeArray.length;

  if (alreadyMade) {
    console.log(
      "Sample already a newsitem, so not creating that or making directory",
    );
  } else {
    //create news item
    // name and body for NewsItem are now guaranteed to exist due to pre('validate')
    await new NewsItem({
      type: "sample",
      typeId: doc._id,
      owner: doc.owner,
      group: doc.group,
      name: doc.name, // Will always have a value now
      body: doc.conditions || "Tplex data available in CSV.", // Conditions might still be null for Tplex
      //originallyAdded: doc.originallyAdded,
    }).save();

    // create directory
    const absPath = join(process.env.DATASTORE_ROOT, this.path);
    await fs.promises.mkdir(absPath, { recursive: true }).catch((err) => {
      if (err.code === "EEXIST") {
        console.log(`Directory ${absPath} already exists.`);
      } else {
        console.error("Error creating directory for sample:", err);
      }
    });
  }
});

schema.virtual("runs", {
  ref: "Run",
  localField: "_id",
  foreignField: "sample",
  justOne: false,
});

schema.virtual("additionalFiles", {
  ref: "AdditionalFile",
  localField: "_id",
  foreignField: "sample",
  justOne: false,
});

schema.methods.getRelativePath = function () {
  const doc = this;
  return doc
    .populate({
      path: "group",
    })
    .populate({
      path: "project",
    })
    .execPopulate()
    .then((populatedDoc) => {
      return join(
        populatedDoc.group.safeName,
        populatedDoc.project.safeName,
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
    return Sample.find({});
  }
  const filters = [{ owner: user.username }];
  if (user.groups) {
    user.groups.map((g) => {
      filters.push({ group: g });
    });
  }
  return Sample.find({ $or: filters });
};

const Sample = model("Sample", schema);

module.exports = Sample;
