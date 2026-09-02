/**
 * Read-only inventory of stored ingest work that this release's stricter
 * validation would refuse.
 *
 *   node scripts/inspect-ingest-backlog.js
 *
 * Run this BEFORE deploying, alongside check-run-duplicates.js.
 *
 * Why it exists. POST /runs/:id/reingest re-validates the MERGED payload in
 * full — including entries the caller never resubmitted — so a stored
 * IngestJob whose payload was legal under the old rules can become
 * un-correctable. An audit established that a plain no-body reingest is NOT
 * the escape hatch I had claimed it was:
 *
 *   - A stored " A.fq" delivered canonically as A.fq replays, and the worker
 *     re-attempts a file that is already in the datastore.
 *   - A stored one-way pair replays to a "complete" run with one paired Read
 *     and one unpaired Read.
 *   - An already-delivered non-canonical entry cannot be repaired through the
 *     API at all: the canonical spelling is 409, the old spelling is 400, and
 *     omitting it carries the invalid spelling forward.
 *
 * The right response is to look before deploying rather than to migrate
 * blindly. The durable queue postdates the currently deployed master, so
 * production may have no ingestjobs collection at all — in which case there
 * is nothing to do, and this script says so in one line.
 *
 * Writes nothing, locks nothing. Safe against production while it serves.
 *
 * Exit 0: nothing stored would be refused.
 * Exit 1: something would be. Each item is listed with what is wrong.
 * Exit 2: could not connect or query.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { safeBasename } = require("../lib/utils/safePath");

const MONGO_URI = process.env.MONGODB_URI;

// A job in one of these has no further work to do, so its payload will never
// be re-validated.
const SETTLED = ["done", "completed", "succeeded"];

/**
 * The problems in one stored file list, as plain sentences.
 * @param {Array<object>} files - rawFiles or additionalFiles from a payload.
 * @param {string} label - Which list this is, for the message.
 * @returns {string[]} One message per problem; empty when the list is fine.
 */
function inspectFileList(files, label) {
  if (!Array.isArray(files)) {
    return [];
  }

  const problems = [];
  const canonical = new Map();

  files.forEach((file, index) => {
    const name = file && file.name;
    if (typeof name !== "string") {
      return;
    }

    const bare = safeBasename(name);
    if (bare !== name) {
      problems.push(
        bare === null
          ? `${label}[${index}] "${name}" is not a usable filename`
          : `${label}[${index}] "${name}" is not a bare filename (would need "${bare}")`,
      );
    }

    const key = bare || name;
    canonical.set(key, (canonical.get(key) || 0) + 1);
  });

  canonical.forEach((count, name) => {
    if (count > 1) {
      problems.push(`${label} name "${name}" appears ${count} times`);
    }
  });

  // Pairing, by whichever mechanism the payload used.
  const byName = new Map(
    files
      .filter((file) => file && typeof file.name === "string")
      .map((file) => [safeBasename(file.name) || file.name, file]),
  );

  files.forEach((file, index) => {
    if (!file || typeof file.sibling !== "string") {
      return;
    }
    const own = safeBasename(file.name || "") || file.name;
    const mateName = safeBasename(file.sibling) || file.sibling;

    if (mateName === own) {
      problems.push(`${label}[${index}] "${own}" names itself as its sibling`);
      return;
    }
    const mate = byName.get(mateName);
    if (!mate) {
      problems.push(
        `${label}[${index}] "${own}" names sibling "${file.sibling}", which is not in the list`,
      );
      return;
    }
    const mateSibling =
      typeof mate.sibling === "string"
        ? safeBasename(mate.sibling) || mate.sibling
        : null;
    if (mateSibling !== own) {
      problems.push(
        `${label}[${index}] "${own}" names "${mateName}", which does not name it back`,
      );
    }
  });

  const byRow = new Map();
  files.forEach((file) => {
    if (!file || file.paired !== true) {
      return;
    }
    if (typeof file.sibling === "string") {
      return; // paired by sibling, already checked above
    }
    if (file.rowID === undefined || file.rowID === null) {
      problems.push(
        `${label} entry "${file.name}" is paired but names no sibling and has no rowID`,
      );
      return;
    }
    const row = String(file.rowID);
    byRow.set(row, (byRow.get(row) || 0) + 1);
  });
  byRow.forEach((count, row) => {
    if (count !== 2) {
      problems.push(`${label} rowID "${row}" has ${count} paired entries`);
    }
  });

  return problems;
}

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
    const collections = await mongoose.connection.db
      .listCollections({ name: "ingestjobs" })
      .toArray();

    if (collections.length === 0) {
      console.log(
        "No ingestjobs collection: the durable queue has never run here. Nothing to inspect.",
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    const jobs = await mongoose.connection
      .collection("ingestjobs")
      .find({ status: { $nin: SETTLED } })
      .project({ runId: 1, status: 1, payload: 1 })
      .toArray();

    console.log(`Checked ${jobs.length} unfinished ingest job(s).`);

    const flagged = [];
    jobs.forEach((job) => {
      const payload = job.payload || {};
      const problems = [
        ...inspectFileList(payload.rawFiles, "rawFiles"),
        ...inspectFileList(payload.additionalFiles, "additionalFiles"),
      ];
      if (problems.length > 0) {
        flagged.push({ job, problems });
      }
    });

    if (flagged.length === 0) {
      console.log(
        "\nNothing stored would be refused by this release's validation.",
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(
      `\n${flagged.length} job(s) hold a payload this release would refuse:\n`,
    );
    flagged.forEach(({ job, problems }) => {
      console.log(`  run ${job.runId} (job ${job._id}, status ${job.status})`);
      problems.forEach((problem) => console.log(`    - ${problem}`));
      console.log("");
    });

    console.log(
      [
        "These will fail a reingest that carries a replacement payload, because",
        "the merged list is re-validated in full — including entries the caller",
        "did not resubmit. A plain no-body reingest replays the stored payload",
        "unchanged and will NOT repair them.",
        "",
        "Repair each by hand before deploying: correct the stored payload's",
        "names and pairing to what the files on disk actually are. Do not",
        "blanket-migrate — the shapes above are not interchangeable, and a run",
        "whose files are already delivered needs a different correction from one",
        "whose files never arrived.",
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

if (require.main === module) {
  main();
}

module.exports = { inspectFileList };
