/**
 * Read-only inventory of stored ingest work that this release's stricter
 * validation would refuse: malformed payloads, orphan Runs, missing/renamed
 * LibraryTypes (including duplicates), and paired/indexed contradictions.
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
 * Exit 0: nothing unfinished would be refused.
 * Exit 1: something would be. Each item is listed with what is wrong.
 * Exit 2: could not connect or query.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { resolveMongoUri } = require("../lib/utils/validateEnv");
const {
  validateIngestFilesPayload,
  validateRawFilesForLibraryType,
} = require("../lib/ingest-payload-validation");

const MONGO_URI = resolveMongoUri(process.env);

// A job in one of these has no further work to do, so its payload will never
// be re-validated.
const SETTLED = ["done", "completed", "succeeded"];
const castMongooseBoolean = mongoose.Schema.Types.Boolean.cast();

const asObjectId = (value) => {
  const rendered = value === undefined || value === null ? "" : String(value);
  return /^[a-f\d]{24}$/i.test(rendered)
    ? new mongoose.Types.ObjectId(rendered)
    : null;
};

// The inspector reads raw BSON while the worker reads through the Mongoose
// LibraryType model. Match Mongoose's Boolean casting (including indexed's
// default false) or legacy values such as 1 / "true" become a false green.
const castBooleanField = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  try {
    const cast = castMongooseBoolean(value);
    return cast === undefined ? defaultValue : cast;
  } catch (_err) {
    // Hydration leaves a failed paired cast undefined and applies indexed's
    // default. Those are exactly the defaults supplied by the caller.
    return defaultValue;
  }
};

const asWorkerLibraryType = (libraryType) =>
  libraryType && {
    ...libraryType,
    paired: castBooleanField(libraryType.paired, undefined),
    indexed: castBooleanField(libraryType.indexed, false),
  };

/**
 * Mirrors every validation dependency the worker needs before it can move an
 * unfinished job's bytes. It stays model-free: the production inspector must
 * not compile schemas (and therefore indexes) merely by being imported.
 *
 * @param {object} job - Raw ingestjobs document.
 * @param {object|null} run - Raw Runs document referenced by the job.
 * @param {object|null} libraryType - Raw LibraryTypes document for the Run.
 * @param {object} [options]
 * @param {number} [options.libraryTypeCount] - Exact-value option matches.
 * @returns {string[]} Refusal reasons.
 */
const validateStoredJob = (
  job,
  run,
  libraryType,
  { libraryTypeCount = libraryType ? 1 : 0 } = {}
) => {
  const payload = (job && job.payload) || {};
  const problems = [...validateIngestFilesPayload(payload)];

  if (!run) {
    problems.push(
      `Referenced Run ${
        job && job.runId ? job.runId : "(missing runId)"
      } does not exist`
    );
    return [...new Set(problems)];
  }

  if (typeof run.libraryType !== "string" || run.libraryType.length === 0) {
    problems.push(`Run ${run._id} has no libraryType value`);
    return [...new Set(problems)];
  }

  if (libraryTypeCount > 1) {
    problems.push(
      `Run ${run._id} references ambiguous LibraryType "${run.libraryType}": ${libraryTypeCount} option documents exist`
    );
    return [...new Set(problems)];
  }

  if (!libraryType) {
    problems.push(
      `Run ${run._id} references LibraryType "${run.libraryType}", but that option does not exist`
    );
    return [...new Set(problems)];
  }

  problems.push(
    ...validateRawFilesForLibraryType(
      payload.rawFiles,
      asWorkerLibraryType(libraryType)
    )
  );
  return [...new Set(problems)];
};

async function main() {
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
        "No ingestjobs collection: the durable queue has never run here. Nothing to inspect."
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

    const runObjectIds = jobs
      .map((job) => asObjectId(job.runId))
      .filter(Boolean);
    const runs =
      runObjectIds.length === 0
        ? []
        : await mongoose.connection
            .collection("runs")
            .find({ _id: { $in: runObjectIds } })
            .project({ libraryType: 1 })
            .toArray();
    const runsById = new Map(runs.map((run) => [String(run._id), run]));

    const libraryTypeValues = [
      ...new Set(
        runs
          .map((run) => run.libraryType)
          .filter((value) => typeof value === "string" && value.length > 0)
      ),
    ];
    // Query each referenced value exactly as LibraryType.findOne({ value })
    // does in the worker. A bulk `$in` followed by a JavaScript Map is not
    // equivalent when the collection has a case-insensitive default
    // collation: Mongo can match two differently-cased values that JS would
    // split into separate keys, hiding an ambiguous option.
    const libraryTypesByValue = new Map(
      await Promise.all(
        libraryTypeValues.map(async (value) => [
          value,
          await mongoose.connection
            .collection("librarytypes")
            .find({ value })
            .project({ value: 1, paired: 1, indexed: 1 })
            .toArray(),
        ])
      )
    );

    const flagged = [];
    jobs.forEach((job) => {
      const run = runsById.get(String(job.runId)) || null;
      const libraryTypeMatches = run
        ? libraryTypesByValue.get(run.libraryType) || []
        : [];
      const libraryType =
        libraryTypeMatches.length === 1 ? libraryTypeMatches[0] : null;
      // These are the same pure functions used by POST /runs/new, replacement
      // reingests and the worker. A hand-copied subset previously returned 0
      // for malformed jobs that the route rejected with 400; checking only
      // payload shape likewise missed a renamed LibraryType and semantic
      // paired/indexed contradictions the worker refuses before moving bytes.
      const problems = validateStoredJob(job, run, libraryType, {
        libraryTypeCount: libraryTypeMatches.length,
      });
      if (problems.length > 0) {
        flagged.push({ job, problems });
      }
    });

    if (flagged.length === 0) {
      console.log(
        "\nNothing stored would be refused by this release's validation."
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(
      `\n${flagged.length} job(s) hold a payload this release would refuse:\n`
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
        "Repair each by hand before deploying: restore any missing Run or",
        "LibraryType reference/ambiguity, then correct the stored payload's names, pairing",
        "and index flags to what the files on disk actually are. Do not blanket-",
        "migrate — the shapes above are not interchangeable, and a run whose",
        "files are already delivered needs a different correction from one whose",
        "files never arrived.",
      ].join("\n")
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

module.exports = {
  validateIngestFilesPayload,
  validateRawFilesForLibraryType,
  validateStoredJob,
};
