/**
 * Read-only pre-deploy check for the unique { sample, name } index on Run.
 *
 *   node scripts/check-run-duplicates.js
 *
 * Run this BEFORE deploying. The index is what stops two simultaneous
 * submissions creating two Runs for the same sample and name. Mongoose builds
 * indexes in the background and only *logs* a failure, so if a duplicate pair
 * already exists the index is silently never created and the race stays open
 * with nothing in the API reporting a problem.
 *
 * Nothing is written and nothing is locked. Safe to run against production at
 * any time, including while the API is serving.
 *
 * Exit 0: no duplicates, safe to deploy.
 * Exit 1: duplicates listed, resolve them first.
 * Exit 2: could not connect or query.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGODB_URI;

async function main() {
  if (!MONGO_URI) {
    console.error("MONGODB_URI is not set. Nothing to check.");
    process.exit(2);
  }

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
    const duplicates = await mongoose.connection
      .collection("runs")
      .aggregate([
        { $group: { _id: { sample: "$sample", name: "$name" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    const total = await mongoose.connection.collection("runs").countDocuments();

    if (duplicates.length === 0) {
      console.log(`Checked ${total} runs. No duplicate { sample, name } pairs.`);
      console.log("Safe to deploy — the unique index will build.");
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(
      `Checked ${total} runs. Found ${duplicates.length} duplicate { sample, name } pair(s):\n`,
    );
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
        "",
        "After deploying, confirm the index actually exists:",
        "  db.runs.getIndexes()   // look for a unique index on { sample, name }",
      ].join("\n"),
    );

    await mongoose.disconnect();
    process.exit(1);
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  }
}

main();
