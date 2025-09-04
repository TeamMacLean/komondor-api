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

// --- MODIFIED pre('validate') hook ---
schema.pre("validate", function (next) {
  const doc = this;

  // Step 1: Handle conditional required fields based on tplexCsv
  if (!doc.tplexCsv) {
    // If tplexCsv is falsey (not a tplex sample), make these fields effectively required for validation
    // `name` is now always set via safeName, so its explicit invalidation here is only for user-provided name validity.
    // If name is null/undefined at this point, it means the user didn't provide it, and we will set it from safeName later.
    // This part should focus on validating user-provided input.
    if (!doc.name) {
      // This will be overridden by safeName later, but if you want to *force* user input
      // OR handle a backend-initiated save of a non-Tplex without a name.
      // doc.invalidate("name", "Name is required for non-Tplex samples.", doc.name);
    }
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
    // If it IS a tplex sample, ensure these fields are explicitly null/undefined if they come as empty strings
    if (doc.scientificName === "") doc.scientificName = null;
    if (doc.commonName === "") doc.commonName = null;
    if (doc.ncbi === "") doc.ncbi = null;
    if (doc.conditions === "") doc.conditions = null;
    // `name` is explicitly set via safeName below, so no need to nullify it here.
  }

  // Step 2: Handle safeName generation and then assign it to 'name'
  // safeName must *always* be generated.
  // The base name for safeName generation:
  // - If it's a non-tplex sample with a name: use doc.name
  // - If it's a tplex sample OR a non-tplex without a name: use a fallback based on project ID
  const baseNameForSafeName =
    doc.name && doc.name.length > 0
      ? doc.name
      : `tplex-sample-${doc.project.toString().slice(-6)}`;

  Sample.find({})
    .then((allOthers) => {
      const filteredOthers = allOthers.filter(
        (f) => f._id.toString() !== doc._id.toString(),
      );
      // Generate safeName. If doc.safeName already exists (e.g., on update), keep it.
      return (
        this.safeName ||
        generateSafeName(
          this.name,
          allOthers.filter((f) => f._id.toString() !== this._id.toString()),
        )
      );
    })
    .then((generatedSafeName) => {
      doc.safeName = generatedSafeName;

      // --- NEW: Assign generated safeName to 'name' if 'name' is not already provided ---
      // This ensures 'name' always has a value for all samples.
      // If doc.name was already set by user input (non-Tplex), it keeps that value.
      // If doc.name was null/empty (Tplex), it gets the safeName.
      if (!doc.name || doc.name === "") {
        doc.name = doc.safeName;
      }
      // --- END NEW ---

      return doc
        .populate({
          path: "project",
        })
        .execPopulate();
    })
    .then((populatedDoc) => {
      try {
        if (!populatedDoc.project || !populatedDoc.project.path) {
          throw new Error(
            "Project or Project path not found for sample path generation.",
          );
        }
        doc.path = join(populatedDoc.project.path, doc.safeName);
        next();
      } catch (e) {
        console.error("Error generating sample path:", e);
        doc.invalidate("path", e.message, doc.path);
        next(e);
      }
    })
    .catch((err) => {
      console.error("Error in Sample pre-validate hook:", err);
      doc.invalidate(
        "general",
        "An error occurred during sample validation: " + err.message,
      );
      next(err);
    });
});
// --- END MODIFIED pre('validate') hook ---

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

schema.methods.toENA = function toENA() {
  const sample = this;

  js2xmlparser.parse("sample", sample);
};

const Sample = model("Sample", schema);

module.exports = Sample;
