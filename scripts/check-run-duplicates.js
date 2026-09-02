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
 *  2. Another index already blocks the build. mongoose builds indexes in the
 *     background and only *logs* IndexKeySpecsConflict/IndexOptionsConflict
 *     rather than throwing, so the app starts and serves traffic with the
 *     old index still in place and nothing visible saying so. Two shapes
 *     block it, both confirmed by execution against MongoDB 7.0:
 *       - something else occupies the auto-generated name with different
 *         options (85 or 86, depending which option differs);
 *       - an EQUIVALENT index exists under a different name (85, "Index
 *         already exists with a different name"). This script used to assert
 *         that case was impossible.
 *     A same-keys index under a different name with DIFFERENT options is
 *     genuinely fine — MongoDB builds the unique one alongside it.
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
// { unique: true }) call declares — nothing else.
const EXPECTED_OPTIONS = { unique: true };

// Every field a listIndexes entry may carry and still describe an index
// EQUIVALENT to the one models/Run.js declares.
//
// An allowlist, not a denylist. The previous version listed four options that
// must be absent (partialFilterExpression, collation, sparse,
// expireAfterSeconds) and therefore called anything it had not thought of
// "safe": an audit executed a storageEngine-carrying index against real
// MongoDB 7 and got IndexOptionsConflict (85) from a spec this script had
// just cleared. Any field not named here means "not the same index", which
// at worst asks an operator to look at something harmless — the opposite
// error ships a deploy whose unique index never builds.
//
// `v` is the index version, `ns` appears on older servers, and `background`
// is a build hint modern servers ignore: verified by execution that an
// existing background:true index accepts the schema's own build unchanged.
const EQUIVALENT_INDEX_FIELDS = new Set([
  "v",
  "key",
  "name",
  "ns",
  "unique",
  "background",
]);

/**
 * Whether an existing index is fully equivalent to what models/Run.js's own
 * schema.index() call will try to build — keys AND every option MongoDB
 * would compare, not only the two (unique, name) this check used to cover.
 *
 * Name is deliberately NOT part of this: an equivalent index under a
 * different name is still a conflict (see findIndexConflicts).
 *
 * @param {Object|null} idx - An index spec from collection.indexes().
 * @returns {boolean} True only if this index is the one the schema declares.
 */
function isEquivalentToSchemaIndex(idx) {
  if (!hasExpectedKeys(idx)) {
    return false;
  }
  if (Boolean(idx.unique) !== Boolean(EXPECTED_OPTIONS.unique)) {
    return false;
  }
  return Object.keys(idx).every((field) => EQUIVALENT_INDEX_FIELDS.has(field));
}

/**
 * Every existing index that would stop models/Run.js's own
 * schema.index({ sample: 1, name: 1 }, { unique: true }) from building.
 *
 * Two distinct shapes, both executed against real MongoDB 7.0:
 *
 *  1. Something else already occupies the auto-generated name with different
 *     options — IndexKeySpecsConflict (86).
 *  2. An EQUIVALENT index already exists under a different name —
 *     IndexOptionsConflict (85), "Index already exists with a different
 *     name". This one was not merely unchecked, it was explicitly denied: a
 *     test asserted a custom-named same-keys index could not collide, on the
 *     reasoning that mongoose's build only collides on the name it generates.
 *     Real MongoDB disagrees, and the audit that ran it was right.
 *
 * A same-keys index that is NOT equivalent (a non-unique one, say) under a
 * different name is genuinely fine — verified by execution: MongoDB treats
 * differing options as a different index and builds alongside it.
 *
 * @param {Array<Object>} indexes - The result of collection.indexes().
 * @returns {Array<{index: Object, reason: string}>} Conflicts, empty if none.
 */
function findIndexConflicts(indexes) {
  const conflicts = [];

  for (const idx of indexes || []) {
    if (idx.name === INDEX_NAME) {
      if (!isEquivalentToSchemaIndex(idx)) {
        conflicts.push({
          index: idx,
          // Which of the two errors comes back depends on the option: a
          // storageEngine difference was observed as 85, a
          // partialFilterExpression or sparse difference as 86. Naming both
          // rather than guessing one, so the message matches what the
          // operator will actually see in the log.
          reason: `"${INDEX_NAME}" already exists with different options (IndexOptionsConflict 85 or IndexKeySpecsConflict 86)`,
        });
      }
      continue;
    }

    if (isEquivalentToSchemaIndex(idx)) {
      conflicts.push({
        index: idx,
        // Worth stating precisely, because it reads like a false alarm and is
        // not: this index IS enforcing the uniqueness constraint right now
        // (verified — a duplicate insert against it is refused 11000). What
        // it blocks is STARTUP. models/Run.js's Run.init() rejects with 85
        // rather than logging, and server.js awaits it, so the app does not
        // boot at all. Dropping a healthy index would be indefensible if the
        // only cost were a log line; it is defensible because the
        // alternative is a deploy that will not start.
        reason: `"${idx.name}" is the same index under a different name — it IS enforcing uniqueness, but Run.init() rejects on it (IndexOptionsConflict, error 85) and the app will not boot`,
      });
    }
  }

  return conflicts;
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
 * @param {Array<{index: Object}>} [conflicts] - The conflicting indexes to
 *   drop, from findIndexConflicts. Defaults to just the auto-generated name,
 *   for callers that already know that is the only one.
 * @returns {Promise<void>}
 * @throws {Error} If the create fails after the drop already succeeded —
 *   the collection is left with no relevant index at all, and this is
 *   deliberately fatal rather than swallowed.
 */
async function fixStaleIndex(collection, conflicts) {
  const lastCheck = await collection
    .aggregate([
      {
        $group: {
          _id: { sample: "$sample", name: "$name" },
          count: { $sum: 1 },
        },
      },
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

  // Every conflicting index, not just the auto-generated name: an equivalent
  // index under a different name blocks the build too (error 85), and
  // dropping only the named one would leave --fix reporting success against
  // a collection whose index still had not been rebuilt.
  //
  // `undefined` means the caller has not looked, and the auto-generated name
  // is the historical assumption. An EMPTY array is a different statement —
  // "I looked and there are none" — and must not be read as the same thing,
  // or a caller that checked would drop a healthy index.
  const toDrop =
    conflicts === undefined
      ? [INDEX_NAME]
      : [...new Set(conflicts.map((conflict) => conflict.index.name))];

  if (toDrop.length === 0) {
    console.log("Nothing to drop: no conflicting index.");
    return;
  }

  // The drop loop is inside this try, not before it. With two or more
  // conflicting indexes, a failure on the SECOND drop leaves the first
  // already gone and createIndex never reached — the operator needs the
  // same warning as a failed create, because the collection is in the same
  // state either way.
  try {
    for (const name of toDrop) {
      await collection.dropIndex(name);
    }

    await collection.createIndex(
      { sample: 1, name: 1 },
      { unique: true, name: INDEX_NAME },
    );
  } catch (repairErr) {
    console.error(
      [
        "",
        "FATAL: an index was dropped but the unique index is not in place",
        `(${repairErr.message}). The "runs" collection may now have NO index`,
        "enforcing { sample, name } uniqueness at all. This needs immediate",
        "attention — most likely a duplicate was inserted during this run;",
        "re-run this script's report mode (no --fix) to check, resolve any",
        "duplicates found, then re-run --fix.",
      ].join("\n"),
    );
    throw repairErr;
  }

  // Re-read and re-classify rather than trusting that a successful
  // createIndex means the job is done. A collection created with
  // `indexOptionDefaults` (or a default collation) stamps those options onto
  // every index it builds, INCLUDING this rebuild — so the new index can
  // come back still classified as a conflict, and a caller that trusted the
  // create would report "Fixed" and send the operator round the same loop
  // next run. Saying so is the whole value here.
  const remaining = findIndexConflicts(await collection.indexes());
  if (remaining.length > 0) {
    console.error(
      [
        "",
        "The rebuild completed but the collection STILL reports a conflict:",
        ...remaining.map((conflict) => `  ${conflict.reason}`),
        "",
        "This usually means the collection carries index option defaults",
        "(indexOptionDefaults, or a default collation) that are stamped onto",
        "every index it builds, so rebuilding cannot clear it. Do NOT re-run",
        "--fix — it will drop and rebuild to the same state. Resolve the",
        "collection's own defaults instead.",
      ].join("\n"),
    );
    throw new Error(
      "The unique index was rebuilt but is still classified as conflicting",
    );
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
        {
          $group: {
            _id: { sample: "$sample", name: "$name" },
            count: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    const total = await collection.countDocuments();
    // Every index, not just the one under the auto-generated name: an
    // equivalent index under ANY other name blocks the build too (error 85),
    // which this script used to assert was impossible.
    const conflicts = findIndexConflicts(await collection.indexes());
    const indexConflict = conflicts.length > 0;

    console.log(`Checked ${total} runs.`);

    if (duplicates.length === 0) {
      console.log("No duplicate { sample, name } pairs.");
    } else {
      console.log(
        `Found ${duplicates.length} duplicate { sample, name } pair(s):\n`,
      );
      duplicates.forEach((d) => {
        console.log(
          `  sample=${d._id.sample}  name=${JSON.stringify(d._id.name)}`,
        );
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
          `Found ${conflicts.length} index(es) that will stop the unique { sample, name } index building:`,
        ].join("\n"),
      );
      conflicts.forEach((conflict) => {
        console.log(`\n  ${conflict.reason}`);
        console.log(JSON.stringify(conflict.index, null, 2));
      });
      console.log(
        [
          "",
          "Mongoose builds this index in the background and only LOGS a refusal —",
          "the app starts and serves traffic with the race still open.",
        ].join("\n"),
      );

      if (duplicates.length > 0) {
        console.log(
          "\nNot attempting a fix: duplicate documents exist, so a rebuilt unique index would fail the same way. Resolve the duplicates first.",
        );
      } else if (fix) {
        const names = conflicts.map((conflict) => `"${conflict.index.name}"`);
        console.log(
          `\nFixing: dropping ${names.join(", ")} and rebuilding "${INDEX_NAME}" as unique...`,
        );
        await fixStaleIndex(collection, conflicts);
        console.log("\nFixed. The unique index is now in place.");
      } else {
        console.log(
          "\nRe-run with --fix to drop and rebuild this index, or resolve it manually.",
        );
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
  findIndexConflicts,
  fixStaleIndex,
  hasExpectedKeys,
  INDEX_NAME,
};
