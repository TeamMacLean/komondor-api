#!/usr/bin/env node
/** Standalone read-only inspector: no API imports, models, workers or writes. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRequire } = require("module");

const HELP = `Usage (from the production komondor-api directory):
  node /path/to/inspect-power-submission.cjs [options]

  --manifest PATH       Expected submission (default: companion entry-21 JSON)
  --env PATH            API dotenv file (default: .env in current directory)
  --hpc-root PATH       Override HPC_TRANSFER_DIRECTORY
  --datastore-root PATH Override DATASTORE_ROOT
  --hash                Recalculate destination MD5s sequentially (can be slow)
  --json                Emit detailed JSON instead of a text report
  --help                Show this help

Reads MongoDB and file metadata only; --hash additionally reads file contents.
Never starts workers, updates records, moves files or sends emails.
Exit 0: checks passed; 1: missing/unfinished/inconsistent items; 2: could not inspect.
The default check uses stored digests, not a fresh proof of file contents.
`;

function parseArgs(args) {
  const options = {
    manifest: path.join(__dirname, "power-entry-21-2026-09-18.json"),
    env: path.resolve(".env"),
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (["--help", "--json", "--hash"].includes(flag))
      options[flag.slice(2)] = true;
    else if (
      ["--manifest", "--env", "--hpc-root", "--datastore-root"].includes(
        flag,
      ) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      options[flag.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  return options;
}
const id = (value) => (value == null ? "" : String(value));
const digest = (value) =>
  typeof value === "string" ? value.toLowerCase() : "";
const within = (root, target) =>
  target === root || target.startsWith(root + path.sep);
const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.split(/[\\/]/).includes("..");

function rawDestinationForRun(runPath, filename) {
  // Project's model writes '/group/project', inherited by Sample/Run.path.
  // File movement uses Run.getRelativePath(): 'group/project/sample/run'.
  // Strip the logical leading slash ONLY for this metadata comparison. File
  // inspection still rejects absolute paths and paths outside DATASTORE_ROOT.
  const relative =
    typeof runPath === "string" ? runPath.replace(/^\/+/, "") : "";
  if (
    !safeRelative(relative) ||
    relative.includes("\\") ||
    !safeRelative(filename) ||
    filename === "." ||
    /[\\/]/.test(filename)
  )
    return null;
  return path.posix.join(relative, "raw", filename);
}

function validateManifest(manifest) {
  const objectId = /^[a-f\d]{24}$/i;
  if (
    manifest.version !== 1 ||
    !objectId.test(manifest.projectId) ||
    !manifest.owner ||
    !path.isAbsolute(manifest.sourcePrefix || "") ||
    !Array.isArray(manifest.runs) ||
    !manifest.runs.length ||
    manifest.runs.length > 1000
  )
    throw new Error("Invalid submission manifest");
  const ids = new Set();
  for (const run of manifest.runs) {
    if (
      !objectId.test(run.id) ||
      ids.has(run.id) ||
      !run.name ||
      !run.sampleName ||
      !Array.isArray(run.reads) ||
      !run.reads.length
    )
      throw new Error("Invalid or duplicate run in manifest");
    ids.add(run.id);
    const names = new Set();
    for (const read of run.reads) {
      const relative =
        typeof read.sourcePath === "string" &&
        read.sourcePath.startsWith(manifest.sourcePrefix + "/")
          ? read.sourcePath.slice(manifest.sourcePrefix.length + 1)
          : "";
      const name = path.basename(relative);
      if (
        !safeRelative(relative) ||
        !/^[a-f\d]{32}$/i.test(read.md5) ||
        names.has(name)
      )
        throw new Error("Invalid or duplicate read in manifest");
      names.add(name);
    }
  }
  return manifest;
}

async function inspectFile(root, relative, hash = false) {
  if (!safeRelative(relative))
    return { state: "invalid_relative_path", storedPath: relative || null };
  const target = path.resolve(root, relative);
  if (!within(path.resolve(root), target)) return { state: "outside_root" };
  const result = { path: target };
  try {
    const rootReal = await fs.promises.realpath(root);
    const realPath = await fs.promises.realpath(target);
    result.realPath = realPath;
    if (!within(rootReal, realPath))
      return { ...result, state: "symlink_outside_root" };
    const stat = await fs.promises.stat(realPath);
    Object.assign(result, {
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      symlink: realPath !== target,
    });
    if (!stat.isFile()) return { ...result, state: "not_regular_file" };
    await fs.promises.access(realPath, fs.constants.R_OK);
    if (hash) {
      // Pin one opened file and check its metadata before/after reading.
      const handle = await fs.promises.open(
        realPath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
      try {
        const before = await handle.stat();
        if (!before.isFile()) return { ...result, state: "not_regular_file" };
        const hasher = crypto.createHash("md5");
        const stream = fs.createReadStream(realPath, {
          fd: handle.fd,
          autoClose: false,
        });
        for await (const chunk of stream) hasher.update(chunk);
        const after = await handle.stat();
        const current = await fs.promises.stat(target);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          after.ino !== current.ino ||
          after.dev !== current.dev
        )
          return { ...result, state: "changed_during_hash" };
        result.calculatedMd5 = hasher.digest("hex");
      } finally {
        await handle.close();
      }
    }
    return { ...result, state: "present" };
  } catch (error) {
    return {
      ...result,
      state: error.code === "ENOENT" ? "missing" : "unreadable",
      errorCode: error.code || error.name,
    };
  }
}

async function inspectRoot(root) {
  const result = { path: path.resolve(root) };
  try {
    result.realPath = await fs.promises.realpath(root);
    const stat = await fs.promises.stat(root);
    result.state = stat.isDirectory() ? "directory" : "not_directory";
    await fs.promises.access(root, fs.constants.R_OK | fs.constants.X_OK);
    try {
      const mounts = (
        await fs.promises.readFile("/proc/self/mountinfo", "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => {
          const [left, right] = line.split(" - ");
          const fields = left.split(" ");
          const details = right.split(" ");
          const decode = (s) =>
            s.replace(/\\([0-7]{3})/g, (_, octal) =>
              String.fromCharCode(parseInt(octal, 8)),
            );
          return {
            mountPoint: decode(fields[4]),
            filesystem: details[0],
            source: decode(details[1]),
          };
        });
      result.mount =
        mounts
          .filter(
            (m) =>
              m.mountPoint === "/" || within(m.mountPoint, result.realPath),
          )
          .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0] || null;
    } catch (_) {
      result.mount = null;
    }
  } catch (error) {
    result.state = "unavailable";
    result.errorCode = error.code;
  }
  return result;
}

async function collect(db, ObjectId, manifest, roots, hash = false) {
  const oid = (s) => new ObjectId(s);
  const find = (name, filter, projection) =>
    db.collection(name).find(filter, { projection }).maxTimeMS(10000).toArray();
  const runIds = manifest.runs.map((r) => oid(r.id));
  const [projects, runs, reads, jobs] = await Promise.all([
    find(
      "projects",
      { _id: oid(manifest.projectId) },
      { name: 1, path: 1, storage: 1 },
    ),
    find(
      "runs",
      { _id: { $in: runIds } },
      {
        name: 1,
        sample: 1,
        owner: 1,
        path: 1,
        status: 1,
        md5VerificationStatus: 1,
        md5VerificationResult: 1,
        md5VerificationCompletedAt: 1,
        createdAt: 1,
      },
    ),
    find(
      "reads",
      { run: { $in: runIds } },
      {
        run: 1,
        file: 1,
        MD5: 1,
        destinationMd5: 1,
        md5Mismatch: 1,
        MD5LastChecked: 1,
      },
    ),
    find(
      "ingestjobs",
      { runId: { $in: runIds }, type: "run-ingest" },
      { runId: 1, status: 1, attempts: 1, leaseExpiresAt: 1, updatedAt: 1 },
    ),
  ]);
  const [samples, files] = await Promise.all([
    find(
      "samples",
      {
        $or: [
          { _id: { $in: runs.map((r) => r.sample).filter(Boolean) } },
          {
            project: oid(manifest.projectId),
            name: { $in: manifest.runs.map((r) => r.sampleName) },
          },
        ],
      },
      { name: 1, project: 1 },
    ),
    find(
      "files",
      { _id: { $in: reads.map((r) => r.file).filter(Boolean) } },
      { originalName: 1, path: 1 },
    ),
  ]);
  const scopedSamples = samples.filter(
    (s) => id(s.project) === manifest.projectId,
  );
  const similarRuns = await find(
    "runs",
    {
      sample: { $in: scopedSamples.map((s) => s._id) },
      name: { $in: manifest.runs.map((r) => r.name) },
    },
    { name: 1, sample: 1 },
  );
  const report = {
    diagnosticVersion: 2,
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    entryId: manifest.entryId,
    submittedAt: manifest.submittedAt,
    projectId: manifest.projectId,
    projectName: projects[0]?.name || null,
    owner: manifest.owner,
    mode: hash ? "fresh_destination_md5" : "stored_md5_and_file_metadata",
    roots: {
      hpc: await inspectRoot(roots.hpc),
      datastore: await inspectRoot(roots.datastore),
    },
    findings: [],
    runs: [],
  };
  if (!projects.length) report.findings.push("Expected project is missing");
  for (const [name, root] of Object.entries(report.roots))
    if (root.state !== "directory")
      report.findings.push(`${name} root is not an accessible directory`);
  for (const expected of manifest.runs) {
    const run = runs.find((r) => id(r._id) === expected.id);
    const row = {
      id: expected.id,
      name: expected.name,
      status: run?.status || "missing",
      md5Status: run?.md5VerificationStatus || "unknown",
      findings: [],
      jobs: jobs
        .filter((j) => id(j.runId) === expected.id)
        .map((j) => ({
          id: id(j._id),
          status: j.status,
          attempts: j.attempts,
          leaseExpiresAt: j.leaseExpiresAt,
          updatedAt: j.updatedAt,
        })),
      reads: [],
    };
    const sample = run && samples.find((s) => id(s._id) === id(run.sample));
    const matchingSamples = scopedSamples.filter(
      (s) => s.name === expected.sampleName,
    );
    const duplicates = similarRuns.filter(
      (r) =>
        r.name === expected.name &&
        matchingSamples.some((s) => id(s._id) === id(r.sample)) &&
        id(r._id) !== expected.id,
    );
    if (duplicates.length)
      row.findings.push(
        `Other matching run IDs: ${duplicates.map((r) => id(r._id)).join(", ")}`,
      );
    if (matchingSamples.length > 1)
      row.findings.push("Duplicate sample names under the expected project");
    if (!run) row.findings.push("Expected run ID is missing");
    else {
      if (
        run.name !== expected.name ||
        run.owner !== manifest.owner ||
        !sample ||
        sample.name !== expected.sampleName ||
        id(sample.project) !== manifest.projectId
      )
        row.findings.push(
          "Run identity/owner/sample/project differs from the submission",
        );
      if (run.status !== "complete")
        row.findings.push(`File processing is ${run.status || "unknown"}`);
      if (run.md5VerificationStatus !== "complete")
        row.findings.push(
          `Checksum verification is ${run.md5VerificationStatus || "unknown"}`,
        );
      const result = run.md5VerificationResult || {};
      if (
        result.disabled ||
        result.skipped > 0 ||
        result.errors > 0 ||
        result.mismatches > 0
      )
        row.findings.push(
          "Checksum result records disabled/skipped/failed verification",
        );
    }
    if (row.jobs.length !== 1 || row.jobs.some((j) => j.status !== "done"))
      row.findings.push("Expected one completed ingest job");
    const actualReads = reads.filter((r) => id(r.run) === expected.id);
    if (actualReads.length !== expected.reads.length)
      row.findings.push(
        `Expected ${expected.reads.length} read records, found ${actualReads.length}`,
      );
    for (const expectedRead of expected.reads) {
      const name = path.basename(expectedRead.sourcePath);
      const matches = actualReads.filter((r) =>
        files.some((f) => id(f._id) === id(r.file) && f.originalName === name),
      );
      const read = matches.length === 1 ? matches[0] : null;
      const file = read && files.find((f) => id(f._id) === id(read.file));
      const source = await inspectFile(
        roots.hpc,
        expectedRead.sourcePath.slice(manifest.sourcePrefix.length + 1),
      );
      const destination = await inspectFile(roots.datastore, file?.path, hash);
      const expectedFilePath = rawDestinationForRun(run?.path, name);
      const item = {
        name,
        readId: read ? id(read._id) : null,
        fileId: file ? id(file._id) : null,
        paths: {
          storedRunPath: run?.path ?? null,
          storedFilePath: file?.path ?? null,
          expectedFilePath,
        },
        expectedMd5: digest(expectedRead.md5),
        storedOriginalMd5: digest(read?.MD5),
        storedDestinationMd5: digest(read?.destinationMd5),
        md5Mismatch: read?.md5Mismatch ?? null,
        lastCheckedAt: read?.MD5LastChecked || null,
        source,
        destination,
        findings: [],
      };
      if (matches.length !== 1)
        item.findings.push(
          `Expected one Read/File match, found ${matches.length}`,
        );
      if (digest(read?.MD5) !== digest(expectedRead.md5))
        item.findings.push("Read MD5 differs from submitted MD5 or is missing");
      if (
        digest(read?.destinationMd5) !== digest(expectedRead.md5) ||
        read?.md5Mismatch === true
      )
        item.findings.push("Stored destination MD5 does not confirm a match");
      if (file && (!expectedFilePath || file.path !== expectedFilePath))
        item.findings.push(
          "File path differs from this run's raw-file destination",
        );
      if (destination.state !== "present")
        item.findings.push(`Destination is ${destination.state}`);
      else {
        if (destination.bytes === 0) item.findings.push("Destination is empty");
        if (hash && destination.calculatedMd5 !== digest(expectedRead.md5))
          item.findings.push("Fresh destination MD5 does not match submission");
        if (
          !hash &&
          read?.MD5LastChecked &&
          Date.parse(destination.modifiedAt) >
            new Date(read.MD5LastChecked).getTime() + 1000
        )
          item.findings.push(
            "Destination modified after stored checksum check; use --hash",
          );
      }
      // Missing staging sources are normal after a move. A retained source is
      // useful evidence, but its presence alone never proves a completed ingest.
      if (!["missing", "present"].includes(source.state))
        item.findings.push(`Upload source is ${source.state}`);
      if (
        source.state === "present" &&
        destination.state === "present" &&
        source.bytes !== destination.bytes
      )
        item.findings.push("Retained source and destination sizes differ");
      row.reads.push(item);
    }
    report.runs.push(row);
  }
  const allReads = report.runs.flatMap((r) => r.reads);
  const flagged = (r) =>
    r.findings.length > 0 || r.reads.some((f) => f.findings.length > 0);
  report.summary = {
    expectedRuns: manifest.runs.length,
    foundRuns: runs.length,
    expectedReads: allReads.length,
    foundReadRecords: reads.length,
    completedJobs: jobs.filter((j) => j.status === "done").length,
    sourceFilesPresent: allReads.filter((r) => r.source.state === "present")
      .length,
    destinationFilesPresent: allReads.filter(
      (r) => r.destination.state === "present",
    ).length,
    storedChecksMatched: allReads.filter(
      (r) =>
        r.storedOriginalMd5 === r.expectedMd5 &&
        r.storedDestinationMd5 === r.expectedMd5 &&
        r.md5Mismatch !== true,
    ).length,
    freshlyHashedMatched: hash
      ? allReads.filter((r) => r.destination.calculatedMd5 === r.expectedMd5)
          .length
      : null,
    runsNeedingAttention: report.runs.filter(flagged).length,
  };
  report.ok = !report.findings.length && !report.summary.runsNeedingAttention;
  return report;
}

function render(report) {
  const lines = [
    `Power entry #${report.entryId} — read-only diagnostic`,
    `Generated: ${report.generatedAt}`,
    `Database: ${report.database}`,
    `Project: ${report.projectName || "(missing)"} (${report.projectId})`,
    `Owner: ${report.owner}`,
    `Mode: ${report.mode}`,
    "",
  ];
  for (const [name, root] of Object.entries(report.roots))
    lines.push(
      `${name}: ${root.path} [${root.state}]`,
      `  mount: ${root.mount ? `${root.mount.mountPoint} (${root.mount.filesystem}, ${root.mount.source})` : "mount details unavailable on this host"}`,
    );
  lines.push(
    "",
    JSON.stringify(report.summary, null, 2),
    ...report.findings.map((f) => `ATTENTION: ${f}`),
  );
  for (const run of report.runs) {
    lines.push(
      "",
      `${run.name} (${run.id}) files=${run.status} md5=${run.md5Status} jobs=${run.jobs.map((j) => j.status).join(",") || "missing"}`,
      ...run.findings.map((f) => `  ATTENTION: ${f}`),
    );
    for (const read of run.reads)
      lines.push(
        `  ${read.name}`,
        `    source: ${read.source.state} ${read.source.path || ""} bytes=${read.source.bytes ?? "?"}`,
        `    destination: ${read.destination.state} ${read.destination.path || ""} bytes=${read.destination.bytes ?? "?"}`,
        `    paths: run=${read.paths.storedRunPath ?? "(missing)"} file=${read.paths.storedFilePath ?? "(missing)"} expected=${read.paths.expectedFilePath ?? "(invalid)"}`,
        `    MD5 expected=${read.expectedMd5} stored=${read.storedDestinationMd5 || "(missing)"}${read.destination.calculatedMd5 ? ` fresh=${read.destination.calculatedMd5}` : ""}`,
        ...read.findings.map((f) => `    ATTENTION: ${f}`),
      );
  }
  lines.push(
    "",
    report.ok
      ? "PASS: expected records, stored checksums and inspected files agree."
      : "ATTENTION: inspect the findings above; this report makes no changes.",
    report.mode === "stored_md5_and_file_metadata"
      ? "File contents were not rehashed. Use --hash for a fresh sequential MD5 check."
      : "Destination contents were rehashed sequentially.",
    "A live worker can change state while this report runs. Re-run if processing is still active.",
  );
  return lines.join("\n");
}

async function main(args = process.argv.slice(2)) {
  let client;
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(HELP);
      return 0;
    }
    const manifest = validateManifest(
      JSON.parse(await fs.promises.readFile(options.manifest, "utf8")),
    );
    // Resolve installed dependencies from the API working directory, so these
    // two diagnostic files may live elsewhere without deploying application code.
    const apiRequire = createRequire(path.join(process.cwd(), "package.json"));
    const dotenv = apiRequire("dotenv");
    let loaded = {};
    try {
      loaded = dotenv.parse(await fs.promises.readFile(options.env));
    } catch (error) {
      if (error.code !== "ENOENT" || args.includes("--env")) throw error;
    }
    const env = { ...loaded, ...process.env };
    // Unlike the app's historical fallback, do not guess a DB if config is absent.
    const uri =
      env.MONGODB_URI ||
      (/^\d+$/.test(env.MONGODB_PORT || "")
        ? `mongodb://localhost:${env.MONGODB_PORT}/komondor`
        : null);
    const hpc = options["hpc-root"] || env.HPC_TRANSFER_DIRECTORY;
    const datastore = options["datastore-root"] || env.DATASTORE_ROOT;
    if (!uri || !hpc || !datastore)
      throw new Error(
        "Require MONGODB_URI (or MONGODB_PORT), HPC_TRANSFER_DIRECTORY and DATASTORE_ROOT in API .env/environment or root overrides",
      );
    const { MongoClient, ObjectId } = apiRequire("mongoose").mongo;
    client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      readPreference: "primary",
      poolSize: 2,
    });
    await client.connect();
    const report = await collect(
      client.db(),
      ObjectId,
      manifest,
      { hpc: path.resolve(hpc), datastore: path.resolve(datastore) },
      !!options.hash,
    );
    console.log(
      options.json ? JSON.stringify(report, null, 2) : render(report),
    );
    return report.ok ? 0 : 1;
  } catch (error) {
    // Driver errors can embed credentials/connection strings. Do not print them.
    const message = /Mongo|BSON/.test(error.name || "")
      ? "MongoDB connection/query failed; verify the API environment and read access."
      : String(error.message).replace(
          /mongodb(?:\+srv)?:\/\/[^\s"']+/gi,
          "[MongoDB URI redacted]",
        );
    console.error(
      `Diagnostic could not finish (${error.code || error.name}): ${message}`,
    );
    return 2;
  } finally {
    if (client) await client.close();
  }
}

if (require.main === module)
  main().then((code) => {
    process.exitCode = code;
  });
module.exports = {
  parseArgs,
  validateManifest,
  rawDestinationForRun,
  inspectFile,
  collect,
  render,
};
