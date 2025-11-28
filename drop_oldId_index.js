/**
 * Script to drop stale unique indexes from all collections.
 * Run with: node drop_oldId_index.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function dropStaleIndexes() {
  try {
    await mongoose.connect(process.env.DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Connected to MongoDB\n");

    const db = mongoose.connection.db;

    // Collections and the stale indexes to check/drop
    // These are fields that either:
    // - Have unique: false (suggesting unique was removed)
    // - Are optional "old*" migration fields that shouldn't be unique
    const collectionsToCheck = {
      projects: ["oldId_1", "oldSafeName_1", "releaseDate_1"],
      samples: ["oldId_1", "oldSafeName_1"],
      groups: ["oldId_1"],
      runs: ["oldId_1", "oldSafeName_1"],
      reads: ["run_1", "oldReadId_1", "oldSiblingID_1", "oldRunID_1"],
      additionalfiles: [
        "run_1",
        "sample_1",
        "project_1",
        "oldAdditionalFileId_1",
      ],
      files: ["oldParentID_1", "oldReadId_1", "oldAdditionalFileId_1"],
    };

    for (const [collectionName, indexesToDrop] of Object.entries(
      collectionsToCheck,
    )) {
      console.log(`--- Checking ${collectionName} ---`);

      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();

      console.log("Current indexes:", indexes.map((i) => i.name).join(", "));

      for (const indexName of indexesToDrop) {
        const foundIndex = indexes.find((i) => i.name === indexName);
        if (foundIndex) {
          console.log(`Found ${indexName} index, dropping it...`);
          await collection.dropIndex(indexName);
          console.log(`Successfully dropped ${indexName} index`);
        } else {
          console.log(`No ${indexName} index found - OK`);
        }
      }
      console.log("");
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

dropStaleIndexes();
