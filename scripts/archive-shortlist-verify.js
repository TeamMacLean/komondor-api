#!/usr/bin/env node
/**
 * Read-only check of an archive shortlist against MongoDB and the HPC datastore.
 *
 * Usage:
 *   node scripts/archive-shortlist-verify.js --csv <shortlist.csv> \
 *     [--decision ARCHIVE_PI_APPROVED] [--json <out.json>]
 *   node scripts/archive-shortlist-verify.js --group two_blades [--json <out.json>]
 *
 * --csv    For every row (optionally filtered by --decision) resolve the
 *          Komondor Project by its datastore path, walk its directory and
 *          overlay the database records using the same helpers as archive
 *          planning, but without hashing file contents or checking AWS
 *          configuration. Reports database records with no file on disk and
 *          files on disk with no database record.
 * --group  The reverse check for one group: Projects whose directory is
 *          missing or holds no regular file, and directories under the group
 *          with no Project at all.
 *
 * No MongoDB updates, S3 calls or datastore writes. Optional --json writes a
 * NEW report outside DATASTORE_ROOT. A successful run is not archive approval.
 * Exit 0 with findings printed; exit 2 if it could not run.
 */

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");

// Operator tooling must not build indexes on the production database merely
// by loading the models; the API process owns index creation at its startup.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const AdditionalFile = require("../models/AdditionalFile");
// Registered for its schema only: Read.file and AdditionalFile.file populate
// it, and nothing else in a standalone script loads it.
require("../models/File");
const Group = require("../models/Group");
const IngestJob = require("../models/IngestJob");
const Project = require("../models/Project");
const Read = require("../models/Read");
const Run = require("../models/Run");
const Sample = require("../models/Sample");
const { walkTree } = require("../lib/s3-archive/inventory");
const {
  collectProjectDatabase,
  collectHardBlockers,
  overlayDatabase,
  validateProjectRoot,
} = require("../lib/s3-archive/preflight");
const { resolveStorageState } = require("../lib/storage-state");
const { resolveMongoUri } = require("../lib/utils/validateEnv");

const fsp = fs.promises;
const models = { AdditionalFile, IngestJob, Read, Run, Sample };

// Display roots that may prefix hpc_path in a shortlist. The Project.path
// field is the part after the root: "/<group safeName>/<project safeName>".
const DISPLAY_ROOTS = [process.env.READS_ROOT_PATH, process.env.DATASTORE_ROOT,
  "/tsl/data/reads", "/ifs/apricot/TSL/PrimaryData/DATABASES/reads"].filter(
  Boolean,
);

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!["--csv", "--group", "--decision", "--json"].includes(token))
      throw new Error(`Unexpected argument: ${token}`);
    if (Object.hasOwn(options, token.slice(2)))
      throw new Error(`Repeated argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    options[token.slice(2)] = value;
    index += 1;
  }
  if (Boolean(options.csv) === Boolean(options.group)) {
    throw new Error("Provide exactly one of --csv <file> or --group <group safeName>");
  }
  if (options.decision && !options.csv) throw new Error("--decision requires --csv");
  return options;
};

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF. */
const parseCsv = (text) => {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((cell) => cell !== ""));
  if (!header) return [];
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV header");
  if (body.some((cells) => cells.length !== header.length))
    throw new Error("CSV row length does not match header");
  return body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])),
  );
};

const projectPathFromDisplay = (hpcPath) => {
  const clean = String(hpcPath || "")
    .trim()
    .replace(/\/+$/, "");
  if (!clean) throw new Error("A non-empty hpc_path is required for every row");
  for (const root of DISPLAY_ROOTS) {
    const prefix = root.replace(/\/+$/, "");
    if (clean.startsWith(`${prefix}/`)) return clean.slice(prefix.length);
  }
  return clean.startsWith("/") ? clean : `/${clean}`;
};

const summariseOverlay = (inventory, overlay) => {
  const files = inventory.entries.filter((entry) => entry.type === "file");
  const kinds = {};
  for (const anomaly of overlay.anomalies) {
    kinds[anomaly.kind] = (kinds[anomaly.kind] || 0) + 1;
  }
  return {
    diskRegularFiles: files.length,
    diskBytes: files.reduce((sum, entry) => sum + entry.size, 0),
    diskSymlinks: inventory.entries.filter((e) => e.type === "symlink").length,
    dbRecordsMissingOnDisk: overlay.dbExpectedMissing.length,
    diskFilesNotInDb: kinds["disk-file-untracked"] || 0,
    seriousAnomalies: overlay.anomalies.filter((a) => a.serious).length,
    anomalyKinds: kinds,
  };
};

const verdictFor = (result) => {
  if (result.status !== "ok") return result.status;
  if (result.hardBlockers?.length) return "ACTIVE_WORK";
  const s = result.summary;
  if (
    s.diskRegularFiles === 0 &&
    result.dbReads + result.dbAdditionalFiles > 0
  ) {
    return "DB_SAYS_FILES_DISK_EMPTY";
  }
  if (s.diskRegularFiles === 0) return "EMPTY";
  if (s.dbRecordsMissingOnDisk > 0) return "DB_RECORDS_MISSING_ON_DISK";
  if (s.seriousAnomalies > 0) return "ANOMALIES_REQUIRE_REVIEW";
  if (result.dbReads + result.dbAdditionalFiles === 0)
    return "DISK_FILES_NO_DB_RECORDS";
  if (s.diskFilesNotInDb > 0) return "OK_WITH_UNTRACKED_FILES";
  return "OK";
};

const checkProject = async (project, datastoreRoot) => {
  const result = {
    projectId: String(project._id),
    name: project.name,
    owner: project.owner || null,
    secondaryOwner: project.secondaryOwner || null,
    path: project.path,
    storageState: resolveStorageState(project).state,
    status: "ok",
  };
  let environment;
  try {
    environment = await validateProjectRoot({ datastoreRoot }, project, {
      requireExists: false,
    });
  } catch (error) {
    result.status = "PATH_REFUSED";
    result.detail = error.message;
    return result;
  }
  result.sourceRoot = environment.sourceRoot;
  const database = await collectProjectDatabase(models, project._id);
  result.dbSamples = database.samples.length;
  result.dbRuns = database.runs.length;
  result.dbReads = database.reads.length;
  result.dbAdditionalFiles = database.additionalFiles.length;
  result.unfinishedIngestJobs = database.unfinishedJobs.length;
  result.hardBlockers = collectHardBlockers(database);
  if (!environment.exists) {
    result.status =
      result.dbReads + result.dbAdditionalFiles > 0
        ? "DB_SAYS_FILES_NO_DIRECTORY"
        : "NO_DIRECTORY";
    return result;
  }
  try {
    const inventory = await walkTree(environment.sourceRoot);
    const overlay = overlayDatabase(
      inventory,
      database,
      environment.sourceRelativeRoot,
    );
    result.summary = summariseOverlay(inventory, overlay);
    result.dbRecordsMissingOnDisk = overlay.dbExpectedMissing;
    result.diskFilesNotInDb = overlay.anomalies
      .filter((a) => a.kind === "disk-file-untracked")
      .map((a) => a.relPath);
    result.seriousAnomalies = overlay.anomalies.filter((a) => a.serious);
    result.inventoryChecksumsVerified = false;
  } catch (error) {
    result.status = "WALK_FAILED";
    result.detail = error.message;
  }
  return result;
};

const runCsvMode = async (options, datastoreRoot) => {
  const rows = parseCsv(await fsp.readFile(options.csv, "utf8"));
  if (!rows.length || rows.some((row) => !row.hpc_path?.trim()))
    throw new Error("Shortlist CSV must contain rows with non-empty hpc_path values");
  const wanted = options.decision
    ? new Set(options.decision.split(",").map((value) => value.trim()))
    : null;
  const results = [];
  for (const row of rows) {
    if (wanted && !wanted.has(row.decision)) continue;
    const projectPath = projectPathFromDisplay(row.hpc_path);
    const matches = await Project.find({ path: projectPath }).select(
      "name path owner secondaryOwner storage +archiveMigration",
    );
    if (matches.length !== 1) {
      results.push({
        shortlist: {
          entryId: row.entry_id || null,
          group: row.group,
          project: row.project,
          decision: row.decision,
        },
        path: projectPath,
        status: matches.length ? "AMBIGUOUS_DB_PROJECT" : "NO_DB_PROJECT",
        matchingProjectIds: matches.map((project) => String(project._id)),
      });
      continue;
    }
    const checked = await checkProject(matches[0], datastoreRoot);
    results.push({
      shortlist: {
        entryId: row.entry_id || null,
        group: row.group,
        project: row.project,
        decision: row.decision,
      },
      ...checked,
    });
  }
  return results;
};

const runGroupMode = async (options, datastoreRoot) => {
  const group = await Group.findOne({ safeName: options.group }).select(
    "name safeName",
  );
  if (!group) throw new Error(`No group with safeName ${options.group}`);
  if (!group.safeName || group.safeName === "." || group.safeName === ".." ||
      /[\\/\0\r\n]/.test(group.safeName)) throw new Error("Unsafe group directory");
  // Use master's canonical-root and symlink checks even for groups with no projects.
  const groupCheck = await validateProjectRoot({ datastoreRoot },
    { path: `/${group.safeName}/__shortlist_probe__` }, { requireExists: false });
  const groupDirectory = path.dirname(groupCheck.sourceRoot);
  try {
    if (!(await fsp.lstat(groupDirectory)).isDirectory() ||
        await fsp.realpath(groupDirectory) !== groupDirectory)
      throw new Error("Group directory is not a canonical, non-symlink directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const projects = await Project.find({ group: group._id }).select(
    "name path owner secondaryOwner storage +archiveMigration",
  );
  const results = [];
  for (const project of projects) {
    results.push(await checkProject(project, datastoreRoot));
  }

  const knownRoots = new Set(results.map((r) => r.sourceRoot).filter(Boolean));
  const directoriesWithoutProject = [];
  let entries = [];
  try {
    entries = await fsp.readdir(groupDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // lstat semantics: symlinked dirs skipped
    const absolute = path.join(groupDirectory, entry.name);
    if (!knownRoots.has(absolute)) directoriesWithoutProject.push(absolute);
  }
  return {
    group: group.safeName,
    projects: results,
    directoriesWithoutProject,
  };
};

const pad = (value, width) => String(value ?? "").padEnd(width);

const printCsvReport = (results) => {
  const header = `${pad("verdict", 28)} ${pad("decision", 26)} ${pad("disk files", 11)} ${pad("db reads", 9)} ${pad("db addl", 8)} ${pad("missing", 8)} ${pad("untracked", 10)} project`;
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const r of results) {
    const s = r.summary || {};
    console.log(
      `${pad(verdictFor(r), 28)} ${pad(r.shortlist.decision, 26)} ${pad(s.diskRegularFiles ?? "", 11)} ${pad(r.dbReads ?? "", 9)} ${pad(r.dbAdditionalFiles ?? "", 8)} ${pad(s.dbRecordsMissingOnDisk ?? "", 8)} ${pad(s.diskFilesNotInDb ?? "", 10)} ${r.shortlist.group}/${r.shortlist.project}${r.detail ? `  (${r.detail})` : ""}`,
    );
  }
};

const printGroupReport = (report) => {
  const header = `${pad("verdict", 28)} ${pad("storage", 10)} ${pad("disk files", 11)} ${pad("db reads", 9)} ${pad("db addl", 8)} ${pad("missing", 8)} ${pad("untracked", 10)} project`;
  console.log(
    `Group ${report.group}: ${report.projects.length} projects in the database`,
  );
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const r of report.projects) {
    const s = r.summary || {};
    console.log(
      `${pad(verdictFor(r), 28)} ${pad(r.storageState, 10)} ${pad(s.diskRegularFiles ?? "", 11)} ${pad(r.dbReads ?? "", 9)} ${pad(r.dbAdditionalFiles ?? "", 8)} ${pad(s.dbRecordsMissingOnDisk ?? "", 8)} ${pad(s.diskFilesNotInDb ?? "", 10)} ${r.path}${r.detail ? `  (${r.detail})` : ""}`,
    );
  }
  console.log(
    `\nDirectories under ${report.group} with no Project record: ${report.directoriesWithoutProject.length}`,
  );
  report.directoriesWithoutProject.forEach((d) => console.log(`  ${d}`));
};

const main = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const datastoreRoot = process.env.DATASTORE_ROOT;
  if (!datastoreRoot || !path.isAbsolute(datastoreRoot)) {
    console.error("DATASTORE_ROOT must be set to an absolute path");
    return 2;
  }
  // Reports must not modify source data, or replace a previous evidence file.
  if (options.json) {
    try {
      const parent = await fsp.realpath(path.dirname(path.resolve(options.json)));
      options.json = path.join(parent, path.basename(options.json));
      const root = await fsp.realpath(datastoreRoot);
      const relative = path.relative(root, options.json);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)))
        throw new Error("--json must be outside DATASTORE_ROOT");
      try {
        await fsp.lstat(options.json);
        throw new Error("--json must name a new report file");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  }
  try {
    await mongoose.connect(resolveMongoUri(process.env), {
      autoIndex: false,
      autoCreate: false,
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10_000,
    });
  } catch (error) {
    console.error(`Could not connect to MongoDB: ${error.message}`);
    return 2;
  }
  try {
    let output;
    if (options.csv) {
      const results = await runCsvMode(options, datastoreRoot);
      printCsvReport(results);
      output = { mode: "csv", generatedAt: new Date().toISOString(), results };
    } else {
      const report = await runGroupMode(options, datastoreRoot);
      printGroupReport(report);
      output = {
        mode: "group",
        generatedAt: new Date().toISOString(),
        ...report,
      };
    }
    if (options.json) {
      await fsp.writeFile(options.json, `${JSON.stringify(output, null, 2)}\n`, {
        flag: "wx", mode: 0o600,
      });
      console.log(`\nFull detail written to ${options.json}`);
    }
    return 0;
  } catch (error) {
    console.error(error.stack || error.message);
    return 2;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, parseArgs, parseCsv, projectPathFromDisplay, verdictFor,
  checkProject, runCsvMode, runGroupMode };
