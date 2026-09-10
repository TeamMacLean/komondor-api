const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const { stripLeadingSlash } = require("./config");
const { ArchiveConfigurationError, ArchiveRefusalError } = require("./errors");

const fsp = fs.promises;

const execute = (query) =>
  query && typeof query.exec === "function" ? query.exec() : query;

const asPlain = (value) =>
  value && typeof value.toObject === "function" ? value.toObject() : value;

const queryLean = (query) => {
  const leanQuery =
    query && typeof query.lean === "function" ? query.lean() : query;
  return execute(leanQuery);
};

const objectIdStrings = (docs) => docs.map((doc) => String(doc._id));
const sortDocuments = (docs) =>
  docs
    .map(asPlain)
    .sort((left, right) =>
      String(left && left._id).localeCompare(String(right && right._id)),
    );

const validateProjectRoot = async (
  config,
  project,
  { requireExists = true } = {},
) => {
  const relativeProjectRoot = stripLeadingSlash(project.path).normalize("NFC");
  const segments = relativeProjectRoot.split("/").filter(Boolean);
  if (
    segments.length < 2 ||
    segments.some((segment) => segment === "." || segment === "..") ||
    /[\0\n\r]/.test(relativeProjectRoot)
  ) {
    throw new ArchiveRefusalError(
      `Project path must be at least two safe segments below DATASTORE_ROOT: ${project.path}`,
    );
  }

  const datastoreRoot = path.resolve(config.datastoreRoot);
  const sourceRoot = path.resolve(datastoreRoot, ...segments);
  const lexicalRelative = path.relative(datastoreRoot, sourceRoot);
  if (
    !lexicalRelative ||
    lexicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lexicalRelative)
  ) {
    throw new ArchiveRefusalError(
      "Resolved project path escapes DATASTORE_ROOT",
    );
  }

  let rootReal;
  try {
    const rootStat = await fsp.stat(datastoreRoot);
    if (!rootStat.isDirectory()) throw new Error("not a directory");
    rootReal = await fsp.realpath(datastoreRoot);
  } catch (error) {
    throw new ArchiveConfigurationError(
      `DATASTORE_ROOT is not a readable directory: ${error.message}`,
    );
  }
  if (rootReal !== datastoreRoot) {
    throw new ArchiveRefusalError(
      `DATASTORE_ROOT must be its canonical path (resolved to ${rootReal})`,
    );
  }

  try {
    const stat = await fsp.lstat(sourceRoot);
    if (!stat.isDirectory()) {
      throw new ArchiveRefusalError(
        `Project root is not a directory: ${sourceRoot}`,
      );
    }
    const real = await fsp.realpath(sourceRoot);
    if (real !== sourceRoot) {
      throw new ArchiveRefusalError(
        `Project root contains a symlinked path component: ${sourceRoot} -> ${real}`,
      );
    }
  } catch (error) {
    if (!requireExists && error.code === "ENOENT") {
      return {
        sourceRoot,
        sourceRelativeRoot: relativeProjectRoot,
        exists: false,
      };
    }
    if (error instanceof ArchiveRefusalError) throw error;
    throw new ArchiveRefusalError(
      `Cannot inspect project root ${sourceRoot}: ${error.code || error.message}`,
    );
  }

  return { sourceRoot, sourceRelativeRoot: relativeProjectRoot, exists: true };
};

const collectProjectDatabase = async (models, projectId) => {
  const { Sample, Run, IngestJob, Read, AdditionalFile } = models;
  const samples = await queryLean(Sample.find({ project: projectId }));
  const sampleIds = objectIdStrings(samples);
  const runs = sampleIds.length
    ? await queryLean(Run.find({ sample: { $in: sampleIds } }))
    : [];
  const runIds = objectIdStrings(runs);
  const unfinishedJobs = runIds.length
    ? await queryLean(
        IngestJob.find({
          runId: { $in: runIds },
          status: { $in: ["pending", "claimed"] },
        }),
      )
    : [];

  let readQuery = runIds.length ? Read.find({ run: { $in: runIds } }) : null;
  if (readQuery && typeof readQuery.populate === "function")
    readQuery = readQuery.populate("file");
  const reads = readQuery ? await queryLean(readQuery) : [];

  const additionalFilter = [{ project: projectId }];
  if (sampleIds.length) additionalFilter.push({ sample: { $in: sampleIds } });
  if (runIds.length) additionalFilter.push({ run: { $in: runIds } });
  let additionalQuery = AdditionalFile.find({ $or: additionalFilter });
  if (typeof additionalQuery.populate === "function") {
    additionalQuery = additionalQuery.populate("file");
  }
  const additionalFiles = await queryLean(additionalQuery);

  return {
    samples: sortDocuments(samples),
    runs: sortDocuments(runs),
    unfinishedJobs: sortDocuments(unfinishedJobs),
    reads: sortDocuments(reads),
    additionalFiles: sortDocuments(additionalFiles),
  };
};

const collectHardBlockers = (database) => {
  const blockers = [];
  for (const run of database.runs) {
    if (["pending", "processing"].includes(run.status)) {
      blockers.push(`Run ${run._id} has status ${run.status}`);
    }
    if (run.md5VerificationStatus === "in_progress") {
      blockers.push(`Run ${run._id} has MD5 verification in progress`);
    }
  }
  for (const job of database.unfinishedJobs) {
    blockers.push(`Ingest job ${job._id} is ${job.status}`);
  }
  return blockers;
};

const normalizedStoredPath = (value) =>
  stripLeadingSlash(String(value || ""))
    .split(path.sep)
    .join("/")
    .normalize("NFC");

const projectRelativeStoredPath = (storedPath, sourceRelativeRoot) => {
  const normalized = normalizedStoredPath(storedPath);
  const root = normalizedStoredPath(sourceRelativeRoot);
  if (normalized === root) return "";
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : null;
};

const overlayDatabase = (inventory, database, sourceRelativeRoot) => {
  const entryByPath = new Map(
    inventory.entries.map((entry) => [entry.relPath.normalize("NFC"), entry]),
  );
  const expectedPaths = new Set();
  const anomalies = [];
  const missing = [];
  const runsById = new Map(database.runs.map((run) => [String(run._id), run]));
  const samplesById = new Map(
    database.samples.map((sample) => [String(sample._id), sample]),
  );

  const expectedPathFor = (kind, record, file) => {
    if (!file || !file.originalName) return null;
    let parentPath;
    if (kind === "read") {
      const run = runsById.get(String(record.run));
      parentPath = run && run.path;
      if (!parentPath) return null;
      return projectRelativeStoredPath(
        `${normalizedStoredPath(parentPath)}/raw/${file.originalName}`,
        sourceRelativeRoot,
      );
    } else if (record.run) {
      const run = runsById.get(String(record.run));
      parentPath = run && run.path;
    } else if (record.sample) {
      const sample = samplesById.get(String(record.sample));
      parentPath = sample && sample.path;
    } else if (record.project) {
      parentPath = sourceRelativeRoot;
    }
    if (!parentPath) return null;
    return projectRelativeStoredPath(
      `${normalizedStoredPath(parentPath)}/additional/${file.originalName}`,
      sourceRelativeRoot,
    );
  };

  const attach = (kind, record) => {
    const file = asPlain(record.file);
    const storedRelPath = projectRelativeStoredPath(
      file && file.path,
      sourceRelativeRoot,
    );
    if (!file || storedRelPath === null) {
      anomalies.push({
        serious: true,
        kind: "db-path-outside-project",
        recordKind: kind,
        id: String(record._id),
        path: file && file.path,
      });
    }
    const relPath = expectedPathFor(kind, record, file);
    if (!relPath) {
      anomalies.push({
        serious: true,
        kind: "db-expected-path-unresolved",
        recordKind: kind,
        id: String(record._id),
      });
      return;
    }
    expectedPaths.add(relPath);
    const entry = entryByPath.get(relPath);
    const run = kind === "read" ? runsById.get(String(record.run)) : null;
    const db = {
      kind,
      id: String(record._id),
      fileId: String(file._id),
      MD5: record.MD5 || null,
      destinationMd5: record.destinationMd5 || null,
      md5Mismatch: record.md5Mismatch === undefined ? null : record.md5Mismatch,
      runStatus: run ? run.status : null,
    };
    if (!entry) {
      const item = { kind, id: String(record._id), expectedRelPath: relPath };
      missing.push(item);
      anomalies.push({ serious: true, kind: "db-file-missing", ...item });
    } else if (entry.type !== "file") {
      anomalies.push({
        serious: true,
        kind: "db-path-not-regular-file",
        recordKind: kind,
        id: String(record._id),
        expectedRelPath: relPath,
        actualType: entry.type,
      });
    } else if (entry.db) {
      anomalies.push({
        serious: true,
        kind: "duplicate-db-path",
        expectedRelPath: relPath,
        ids: [entry.db.id, String(record._id)],
      });
    } else {
      entry.db = db;
    }

    if (
      kind === "read" &&
      (record.md5Mismatch === true || !record.destinationMd5)
    ) {
      anomalies.push({
        serious: true,
        kind:
          record.md5Mismatch === true
            ? "read-md5-mismatch"
            : "read-destination-md5-missing",
        id: String(record._id),
        expectedRelPath: relPath,
      });
    }
  };

  database.reads.forEach((read) => attach("read", read));
  database.additionalFiles.forEach((additional) =>
    attach("additionalFile", additional),
  );

  for (const run of database.runs) {
    if (run.status === "error") {
      anomalies.push({ serious: true, kind: "run-error", id: String(run._id) });
    }
    if (run.md5VerificationStatus === "failed") {
      anomalies.push({
        serious: true,
        kind: "run-md5-verification-failed",
        id: String(run._id),
      });
    }
  }

  for (const entry of inventory.entries) {
    if (
      entry.type === "file" &&
      !expectedPaths.has(entry.relPath.normalize("NFC"))
    ) {
      anomalies.push({
        serious: false,
        kind: "disk-file-untracked",
        relPath: entry.relPath,
      });
    }
    if (entry.type === "symlink") {
      anomalies.push({
        serious: false,
        kind: "symlink-skipped",
        relPath: entry.relPath,
        linkTarget: entry.linkTarget,
      });
    } else if (entry.type === "special") {
      anomalies.push({
        serious: false,
        kind: "special-entry-skipped",
        relPath: entry.relPath,
      });
    } else if (entry.type === "file" && entry.nlink > 1) {
      anomalies.push({
        serious: false,
        kind: "hard-link-copied-per-path",
        relPath: entry.relPath,
        hardLinkGroup: entry.hardLinkGroup,
      });
    } else if (entry.type === "dir" && entry.empty) {
      anomalies.push({
        serious: false,
        kind: "empty-directory-skipped",
        relPath: entry.relPath,
      });
    }
  }

  const itemKey = (item) =>
    [
      item.kind,
      item.expectedRelPath || item.relPath || item.path || "",
      item.id || "",
    ].join("\0");
  anomalies.sort((left, right) => itemKey(left).localeCompare(itemKey(right)));
  missing.sort((left, right) => itemKey(left).localeCompare(itemKey(right)));
  return { anomalies, dbExpectedMissing: missing };
};

const apiAppearsStopped = (url, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return reject(
        new ArchiveConfigurationError(
          `Invalid KOMONDOR_READY_URL: ${error.message}`,
        ),
      );
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.get(parsed, (response) => {
      response.resume();
      reject(
        new ArchiveRefusalError(
          `Komondor API is still answering at ${url} (HTTP ${response.statusCode}); stop it before lock`,
        ),
      );
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new ArchiveRefusalError(
          `Timed out checking ${url}; cannot prove the API is stopped`,
        ),
      );
    });
    request.on("error", (error) => {
      if (["ECONNREFUSED", "ENOENT"].includes(error.code)) return resolve(true);
      reject(
        error instanceof ArchiveRefusalError
          ? error
          : new ArchiveRefusalError(
              `Cannot prove the API is stopped at ${url}: ${error.code || error.message}`,
            ),
      );
    });
  });

const validateAws = async (aws, config) => {
  const version = await aws.version();
  const match = /aws-cli\/(\d+)\./.exec(version);
  if (!match || Number(match[1]) < 2) {
    throw new ArchiveConfigurationError(
      `AWS CLI v2 is required; installed output was: ${version || "(empty)"}`,
    );
  }
  const [cpHelp, headHelp, putHelp] = await Promise.all([
    aws.run(["s3", "cp", "help"], { json: false }),
    aws.run(["s3api", "head-object", "help"], { json: false }),
    aws.run(["s3api", "put-object", "help"], { json: false }),
  ]);
  if (!cpHelp.includes("--checksum-algorithm")) {
    throw new ArchiveConfigurationError(
      "AWS CLI s3 cp lacks --checksum-algorithm",
    );
  }
  if (!headHelp.includes("--checksum-mode")) {
    throw new ArchiveConfigurationError(
      "AWS CLI head-object lacks --checksum-mode",
    );
  }
  if (!putHelp.includes("--if-none-match")) {
    throw new ArchiveConfigurationError(
      "AWS CLI put-object lacks --if-none-match",
    );
  }

  const identity = await aws.getCallerIdentity();
  if (String(identity.Account) !== config.expectedAccountId) {
    throw new ArchiveConfigurationError(
      `AWS account ${identity.Account} does not match AWS_ARCHIVE_EXPECTED_ACCOUNT_ID ${config.expectedAccountId}`,
    );
  }
  await aws.headBucket();
  await aws.listRootProbe();
  return {
    version,
    arn: identity.Arn,
    accountId: String(identity.Account),
    osUser: os.userInfo().username,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
  };
};

const requireKomondorUser = async (User, username) => {
  if (!username)
    throw new ArchiveRefusalError("An operator username is required");
  const user = await execute(User.findOne({ username }));
  if (!user) {
    throw new ArchiveRefusalError(`Komondor user does not exist: ${username}`);
  }
  return user;
};

module.exports = {
  apiAppearsStopped,
  collectHardBlockers,
  collectProjectDatabase,
  overlayDatabase,
  projectRelativeStoredPath,
  requireKomondorUser,
  validateAws,
  validateProjectRoot,
};
