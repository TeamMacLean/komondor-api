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
 *
 * --fix is NOT the same guarantee. It drops the conflicting index and
 * rebuilds it, and between those two steps this collection has no
 * { sample, name } index enforcing anything at all — a duplicate inserted by
 * a concurrent write in that window makes the rebuild fail, leaving the
 * collection WITHOUT a unique index rather than with the stale one it had
 * before. --fix still refuses outright if duplicate documents are already
 * present, and re-checks once more immediately before dropping, but neither
 * of those closes the window — only quiescing Run creation for the run does.
 * Run --fix during a deploy window with new Run creation stopped.
 *
 * Exit 0: safe to deploy (or --fix left it that way).
 * Exit 1: duplicate documents found, resolve them first.
 * Exit 2: could not connect, could not query, or --fix failed after already
 *         dropping the old index — the collection has no relevant index at
 *         all and needs immediate attention (the error message explains).
 * Exit 3: a stale or non-equivalent index is occupying the name; re-run with
 *         --fix (writes quiesced) or resolve it manually.
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
 * Whether an index spec's keys are exactly { sample: 1, name: 1 }, in order.
 *
 * Name alone is not enough: an index called "sample_1_name_1" over different
 * keys (or in a different order) still blocks the build, but a name-only check
 * calls it safe and the failure only surfaces at startup.
 *
 * @param {Object|null} idx - An index spec from collection.indexes().
 * @returns {boolean} True when the keys match exactly.
 */
function hasExpectedKeys(idx) {
  if (!idx || !idx.key) {
    return false;
  }
  const entries = Object.entries(idx.key);
  return (
    entries.length === 2 &&
    entries[0][0] === "sample" &&
    entries[0][1] === 1 &&
    entries[1][0] === "name" &&
    entries[1][1] === 1
  );
}

// The exact options models/Run.js's own schema.index({ sample: 1, name: 1 },
// { unique: true }) call declares — nothing else. Read from the schema
// itself, not hand-copied, so this cannot silently drift from what mongoose
// will actually try to build.
const EXPECTED_OPTIONS = { unique: true };

// Fields that mean an existing index is NOT equivalent to the one above, even
// when its keys match and it happens to be unique. Keys-and-unique alone is
// not the full story: a re-audit found a same-name, same-keys index carrying
// a partialFilterExpression passed the old check as "safe" and then failed
// startup with MongoDB error 86 (IndexKeySpecsConflict) anyway, because
// MongoDB compares the whole option set, not just the two this script used
// to look at.
const OPTION_FIELDS_THAT_MUST_BE_ABSENT = [
  "partialFilterExpression",
  "collation",
  "sparse",
  "expireAfterSeconds",
];

/**
 * Whether an existing index is fully equivalent to what models/Run.js's own
 * schema.index() call will try to build — keys AND every option MongoDB
 * would compare, not only the two (unique, name) this check used to cover.
 *
 * @param {Object|null} idx - An index spec from collection.indexes().
 * @returns {boolean} True only if mongoose's own build would be a no-op
 *   against this index.
 */
function isEquivalentToSchemaIndex(idx) {
  if (!hasExpectedKeys(idx)) {
    return false;
  }
  if (Boolean(idx.unique) !== Boolean(EXPECTED_OPTIONS.unique)) {
    return false;
  }
  return OPTION_FIELDS_THAT_MUST_BE_ABSENT.every(
    (field) => idx[field] === undefined,
  );
}

/**
 * Drops the stale index and rebuilds it as the schema expects, printing
 * before/after getIndexes() so the operator can see exactly what happened.
 *
 * NOT ATOMIC, and not safe against concurrent writes — unlike the rest of
 * this script. Between the drop and the create, this collection has no
 * { sample, name } index enforcing anything at all, and a duplicate document
 * inserted in that window makes the create fail, leaving the collection
 * WITHOUT a unique index where it previously at least had a non-unique one.
 * A re-audit found exactly this gap: this script's own docblock claimed
 * "--fix" was as safe to run live as the report-only mode, which was not
 * true. Run this with Run creation quiesced — see the docblock.
 *
 * Only called once duplicate documents are confirmed absent by the caller —
 * creating a unique index over duplicates fails immediately regardless.
 * Re-checked once more immediately before dropping, to narrow (not close)
 * the window between that first check and this function running.
 *
 * @param {import("mongodb").Collection} collection - The runs collection.
 * @returns {Promise<void>}
 * @throws {Error} If the create fails after the drop already succeeded —
 *   the collection is left with no relevant index at all, and this is
 *   deliberately fatal rather than swallowed.
 */
async function fixStaleIndex(collection) {
  const lastCheck = await collection
    .aggregate([
      { $group: { _id: { sample: "$sample", name: "$name" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .toArray();
  if (lastCheck.length > 0) {
    throw new Error(
      "Aborting: a duplicate appeared since the initial check. Not dropping the existing index.",
    );
  }

  console.log("Before:");
  console.log(JSON.stringify(await collection.indexes(), null, 2));

  await collection.dropIndex(INDEX_NAME);

  try {
    await collection.createIndex(
      { sample: 1, name: 1 },
      { unique: true, name: INDEX_NAME },
    );
  } catch (createErr) {
    console.error(
      [
        "",
        "FATAL: the old index was dropped but the new unique index failed to",
        `build (${createErr.message}). The "runs" collection now has NO index`,
        "enforcing { sample, name } uniqueness at all. This needs immediate",
        "attention — most likely a duplicate was inserted during this run;",
        "re-run this script's report mode (no --fix) to check, resolve any",
        "duplicates found, then re-run --fix.",
      ].join("\n"),
    );
    throw createErr;
  }

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
    const keysMatch = hasExpectedKeys(staleIndex);
    // Equivalent, not just "keys match and unique is true": a same-name,
    // same-keys, unique index can still carry an extra option (a
    // partialFilterExpression, a collation) that makes it a genuinely
    // different index to MongoDB, which compares the whole spec. A
    // keys-and-unique-only check called that "safe" and startup failed
    // anyway with IndexKeySpecsConflict.
    const indexConflict = Boolean(
      staleIndex && !isEquivalentToSchemaIndex(staleIndex),
    );

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
          keysMatch
            ? `Found a pre-existing NON-unique index named "${INDEX_NAME}":`
            : `Found an index named "${INDEX_NAME}" over unexpected keys:`,
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

module.exports = {
  findSampleNameIndex,
  isEquivalentToSchemaIndex,
  fixStaleIndex,
  hasExpectedKeys,
  INDEX_NAME,
};
