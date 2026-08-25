/**
 * Read-only pre-deploy check for the unique { sample, name } index on Run.
 *
 *   node scripts/check-run-duplicates.js          # report only
 *   node scripts/check-run-duplicates.js --fix     # also repair a stale index
 *
 * Run this BEFORE deploying. The index is what stops two simultaneous
 * submissions creating two Runs for the same sample and name. There are two
 * separate ways it can fail to end up built, and this script checks both:
 *
 *  1. Duplicate documents already exist, so createIndex rejects them.
 *  2. A pre-existing NON-unique index already occupies the same
 *     auto-generated name (this collection used to declare { sample, name }
 *     without `unique`). mongoose builds indexes in the background and only
 *     *logs* IndexKeySpecsConflict/IndexOptionsConflict rather than
 *     throwing, so the app starts and serves traffic with the old,
 *     non-unique index still in place and nothing visible saying so.
 *
 * Without --fix, nothing is written and nothing is locked: safe to run
 * against production at any time, including while the API is serving.
 * --fix drops and rebuilds ONLY the conflicting { sample, name } index, and
 * only when no duplicate documents remain (rebuilding as unique would just
 * fail again otherwise).
 *
 * Exit 0: safe to deploy (or --fix left it that way).
 * Exit 1: duplicate documents found, resolve them first.
 * Exit 2: could not connect or query.
 * Exit 3: a stale non-unique index is occupying the name; re-run with --fix
 *         or resolve it manually.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGODB_URI;

// mongoose's auto-generated name for schema.index({ sample: 1, name: 1 }).
// This is what a background index build has to slot into.
const INDEX_NAME = "sample_1_name_1";

/**
 * The current { sample, name } index, if any, under mongoose's auto-generated
 * name — regardless of whether it is unique. Callers decide what that means.
 *
 * @param {import("mongodb").Collection} collection - The runs collection.
 * @returns {Promise<Object|null>} The index spec, or null if absent.
 */
async function findSampleNameIndex(collection) {
  const indexes = await collection.indexes();
  return indexes.find((idx) => idx.name === INDEX_NAME) || null;
}

/**
 * Drops the stale non-unique index and rebuilds it as unique, printing
 * before/after getIndexes() so the operator can see exactly what happened.
 * Only call this once duplicate documents are confirmed absent — creating a
 * unique index over duplicates fails immediately, so there is nothing to gain
 * from attempting it here.
 *
 * @param {import("mongodb").Collection} collection - The runs collection.
 */
async function fixStaleIndex(collection) {
  console.log("Before:");
  console.log(JSON.stringify(await collection.indexes(), null, 2));

  await collection.dropIndex(INDEX_NAME);
  await collection.createIndex(
    { sample: 1, name: 1 },
    { unique: true, name: INDEX_NAME },
  );

  console.log("After:");
  console.log(JSON.stringify(await collection.indexes(), null, 2));
}

async function main() {
  if (!MONGO_URI) {
    console.error("MONGODB_URI is not set. Nothing to check.");
    process.exit(2);
  }

  const fix = process.argv.includes("--fix");

  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
    });
  } catch (err) {
    console.error(`Could not connect to MongoDB: ${err.message}`);
    process.exit(2);
  }

  try {
    const collection = mongoose.connection.collection("runs");

    const duplicates = await collection
      .aggregate([
        { $group: { _id: { sample: "$sample", name: "$name" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    const total = await collection.countDocuments();
    const staleIndex = await findSampleNameIndex(collection);
    // unique:true is only present on the spec once the index actually is one.
    const indexConflict = staleIndex && !staleIndex.unique;

    console.log(`Checked ${total} runs.`);

    if (duplicates.length === 0) {
      console.log("No duplicate { sample, name } pairs.");
    } else {
      console.log(`Found ${duplicates.length} duplicate { sample, name } pair(s):\n`);
      duplicates.forEach((d) => {
        console.log(`  sample=${d._id.sample}  name=${JSON.stringify(d._id.name)}`);
        console.log(`    ${d.count} runs: ${d.ids.join(", ")}`);
      });
      console.log(
        [
          "",
          "Resolve these before deploying: keep the run that has files attached and",
          "delete or rename the others. Until then the unique index will fail to",
          "build, and mongoose will only log it — the deploy will otherwise look fine.",
        ].join("\n"),
      );
    }

    if (indexConflict) {
      console.log(
        [
          "",
          `Found a pre-existing NON-unique index named "${INDEX_NAME}":`,
          JSON.stringify(staleIndex, null, 2),
          "",
          "Mongoose will try to build the new unique index under this same",
          "auto-generated name. MongoDB refuses when a same-named index already",
          "exists with different options, and mongoose only LOGS that refusal —",
          "the app starts and serves traffic with the race still open.",
        ].join("\n"),
      );

      if (duplicates.length > 0) {
        console.log(
          "\nNot attempting a fix: duplicate documents exist, so a rebuilt unique index would fail the same way. Resolve the duplicates first.",
        );
      } else if (fix) {
        console.log(`\nFixing: dropping and rebuilding "${INDEX_NAME}" as unique...`);
        await fixStaleIndex(collection);
        console.log("\nFixed. The unique index is now in place.");
      } else {
        console.log("\nRe-run with --fix to drop and rebuild this index, or resolve it manually.");
      }
    }

    await mongoose.disconnect();

    if (duplicates.length > 0) {
      process.exit(1);
    }
    if (indexConflict && !fix) {
      process.exit(3);
    }

    console.log("\nSafe to deploy — the unique index will build.");
    process.exit(0);
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findSampleNameIndex, fixStaleIndex, INDEX_NAME };
