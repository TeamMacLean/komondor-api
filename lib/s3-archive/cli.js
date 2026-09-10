const os = require("os");

const { crc64Nvme } = require("../utils/crc64nvme");
const { resolveStorageState } = require("../storage-state");
const { joinKey, s3Uri } = require("./config");
const {
  ArchiveConfigurationError,
  ArchiveMutationError,
  ArchiveRefusalError,
} = require("./errors");
const {
  compareTreeToManifest,
  createInventory,
  walkTree,
} = require("./inventory");
const {
  parseAndVerifyManifest,
  serializeManifest,
  sha256Bytes,
} = require("./manifest");
const {
  apiAppearsStopped,
  collectHardBlockers,
  collectProjectDatabase,
  overlayDatabase,
  requireKomondorUser,
  validateAws,
  validateProjectRoot,
} = require("./preflight");
const { shellQuote } = require("./shellQuote");
const {
  ensureValidState,
  fencedUpdate,
  loadProject,
  lockProject,
  recordMigrationError,
  transitionPhase,
} = require("./state");
const {
  copyManifestEntries,
  isOwned,
  metadataValue,
  verifyManifestObjects,
} = require("./upload");

const MUTATING_COMMANDS = new Set([
  "lock",
  "copy",
  "resume",
  "abort-before-copy",
  "restart",
  "confirm-absent",
]);

const COMMANDS = new Set([
  "plan",
  "lock",
  "copy",
  "status",
  "resume",
  "abort-before-copy",
  "restart",
  "deletion-command",
  "confirm-absent",
]);

const BOOLEAN_OPTIONS = new Set([
  "execute",
  "json",
  "acknowledge-known-anomalies",
]);

const REPEATABLE_OPTIONS = new Set(["exclude-entry", "exclude-reason"]);
const VALUE_OPTIONS = new Set([
  "project-id",
  "moved-by",
  "resumed-by",
  "confirmed-by",
  "aborted-by",
  "restarted-by",
  "migration-id",
  ...REPEATABLE_OPTIONS,
]);

const optionName = (token) => token.slice(2);

const parseArgs = (argv) => {
  const [command, ...tokens] = argv;
  if (!COMMANDS.has(command)) {
    throw new ArchiveConfigurationError(
      `Unknown command ${command || "(missing)"}. Expected one of: ${[...COMMANDS].join(", ")}`,
    );
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new ArchiveConfigurationError(`Unexpected argument: ${token}`);
    }
    const name = optionName(token);
    if (BOOLEAN_OPTIONS.has(name)) {
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      throw new ArchiveConfigurationError(`Unknown option: ${token}`);
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ArchiveConfigurationError(`${token} requires a value`);
    }
    index += 1;
    if (REPEATABLE_OPTIONS.has(name)) {
      options[name] = options[name] || [];
      options[name].push(value);
    } else if (options[name] !== undefined) {
      throw new ArchiveConfigurationError(`${token} may be supplied only once`);
    } else {
      options[name] = value;
    }
  }
  if (!options["project-id"]) {
    throw new ArchiveConfigurationError("--project-id is required");
  }
  if (!/^[0-9a-f]{24}$/i.test(options["project-id"])) {
    throw new ArchiveConfigurationError(
      "--project-id must be a 24-hex MongoDB ObjectId",
    );
  }
  return { command, options };
};

const requireOption = (options, name) => {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new ArchiveConfigurationError(`--${name} is required`);
  }
  return value.trim();
};

const exclusionsFromOptions = (options, by) => {
  const entries = options["exclude-entry"] || [];
  const reasons = options["exclude-reason"] || [];
  if (entries.length !== reasons.length) {
    throw new ArchiveConfigurationError(
      "Each --exclude-entry must have one --exclude-reason (in the same order)",
    );
  }
  const result = new Map();
  entries.forEach((entry, index) => {
    const normalized = entry.normalize("NFC").replace(/^\/+/, "");
    const segments = normalized.split("/");
    if (
      !normalized ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      ) ||
      /[\0\n\r]/.test(normalized)
    ) {
      throw new ArchiveConfigurationError(`Unsafe --exclude-entry: ${entry}`);
    }
    if (!reasons[index].trim()) {
      throw new ArchiveConfigurationError(
        `Empty reason for excluded entry ${entry}`,
      );
    }
    if (/[\u0000-\u001f\u007f]/.test(reasons[index])) {
      throw new ArchiveConfigurationError(
        `Control characters are not allowed in the exclusion reason for ${entry}`,
      );
    }
    if (result.has(normalized)) {
      throw new ArchiveConfigurationError(
        `Duplicate --exclude-entry: ${entry}`,
      );
    }
    result.set(normalized, { by, reason: reasons[index].trim() });
  });
  return result;
};

const phaseOf = (project) =>
  project.archiveMigration && project.archiveMigration.phase;

const migrationOf = (project) => {
  if (!project.archiveMigration) {
    throw new ArchiveRefusalError("Project has no active archive migration");
  }
  return project.archiveMigration.toObject
    ? project.archiveMigration.toObject()
    : project.archiveMigration;
};

const identitySummary = (context, project, migrationId = null) => ({
  projectId: String(project._id),
  projectName: project.name,
  migrationId,
  osUser: context.identity.osUser,
  awsArn: context.identity.arn,
  awsAccountId: context.identity.accountId,
  bucket: context.config.bucket,
  basePrefix: context.config.basePrefix,
});

const ensurePhase = (project, allowed) => {
  const phase = phaseOf(project);
  if (!allowed.includes(phase)) {
    throw new ArchiveRefusalError(
      `Command is not valid in migration phase ${phase || "(none)"}; expected ${allowed.join(" or ")}`,
    );
  }
  return phase;
};

const ensureState = (project, allowed) => {
  const state = ensureValidState(project).state;
  if (!allowed.includes(state)) {
    throw new ArchiveRefusalError(
      `Command is not valid for storage state ${state}; expected ${allowed.join(" or ")}`,
    );
  }
  return state;
};

const asIso = (value) => (value ? new Date(value).toISOString() : null);

const buildSummary = (entries, anomalies) => {
  const files = entries.filter(
    (entry) => entry.type === "file" && entry.disposition === "copy",
  );
  const hardLinkGroups = new Set(
    entries
      .filter((entry) => entry.hardLinkGroup)
      .map((entry) => entry.hardLinkGroup),
  );
  return {
    regularFiles: files.length,
    totalBytes: files.reduce((sum, entry) => sum + entry.size, 0),
    symlinks: entries.filter((entry) => entry.type === "symlink").length,
    hardLinkGroups: hardLinkGroups.size,
    special: entries.filter((entry) => entry.type === "special").length,
    emptyDirs: entries.filter((entry) => entry.type === "dir" && entry.empty)
      .length,
    excluded: entries.filter((entry) => entry.disposition === "excluded")
      .length,
    dbExpectedMissing: anomalies.filter(
      (item) => item.kind === "db-file-missing",
    ).length,
    diskUntracked: anomalies.filter(
      (item) => item.kind === "disk-file-untracked",
    ).length,
    checksumAnomalies: anomalies.filter((item) => /md5/.test(item.kind)).length,
  };
};

const completeManifestEntries = (entries, dataKeyPrefix) =>
  entries.map((entry) => ({
    relPath: entry.relPath,
    type: entry.type,
    disposition: entry.disposition,
    s3Key:
      entry.disposition === "copy"
        ? joinKey(dataKeyPrefix, entry.relPath)
        : null,
    size: entry.size,
    mode: entry.mode,
    uid: entry.uid,
    gid: entry.gid,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.ctimeMs,
    dev: entry.dev,
    ino: entry.ino,
    nlink: entry.nlink,
    sha256: entry.sha256 || null,
    crc64nvme: entry.crc64nvme || null,
    linkTarget: entry.linkTarget === undefined ? null : entry.linkTarget,
    hardLinkGroup: entry.hardLinkGroup || null,
    db: entry.db || null,
    excludedBy: entry.excludedBy || null,
    excludedReason: entry.excludedReason || null,
    ...(entry.empty !== undefined ? { empty: entry.empty } : {}),
    ...(entry.readError ? { readError: entry.readError } : {}),
  }));

const buildSourceManifest = ({
  context,
  project,
  migration,
  inventory,
  overlay,
  createdBy,
}) => {
  const dataKeyPrefix = context.config.dataPrefixFor(
    migration.sourceRelativeRoot,
  );
  const entries = completeManifestEntries(inventory.entries, dataKeyPrefix);
  return {
    manifestVersion: 1,
    kind: "source",
    toolVersion: context.toolVersion,
    projectId: String(project._id),
    projectName: project.name,
    migrationId: String(migration.id),
    restartedFrom: migration.restartedFrom || [],
    sourceRoot: migration.sourceRoot,
    sourceRelativeRoot: migration.sourceRelativeRoot,
    dataPrefix: s3Uri(context.config.bucket, dataKeyPrefix),
    dataKeyPrefix,
    createdBy,
    // Lock time is stable across retries. Using "now" here would make an
    // orphaned-but-successful conditional PUT impossible to adopt safely.
    createdAt: new Date(migration.startedAt).toISOString(),
    anomalyAcknowledgement: migration.anomalyAcknowledgement || null,
    summary: buildSummary(entries, overlay.anomalies),
    entries,
    dbExpectedMissing: overlay.dbExpectedMissing,
    anomalies: overlay.anomalies,
    hpcSnapshot: inventory.hpcSnapshot,
  };
};

const sourceControlKey = (context, projectId, migrationId) =>
  joinKey(
    context.config.controlPrefixFor(projectId, migrationId),
    "source-manifest.v1.json",
  );

const verificationControlKey = (context, projectId, migrationId) =>
  joinKey(
    context.config.controlPrefixFor(projectId, migrationId),
    "verification-report.v1.json",
  );

const markManifestDigest = (manifest, digest) => {
  Object.defineProperty(manifest, "sourceManifestSha256", {
    configurable: true,
    enumerable: false,
    value: digest,
  });
  return manifest;
};

const requireControlHead = async (context, key, bytes) => {
  const head = await context.aws.headObject(key);
  if (!head)
    throw new ArchiveMutationError(
      `Control object was not found after PUT: ${key}`,
    );
  const expectedCrc = crc64Nvme(bytes);
  if (
    Number(head.ContentLength) !== bytes.length ||
    head.ChecksumCRC64NVME !== expectedCrc ||
    head.ChecksumType !== "FULL_OBJECT"
  ) {
    throw new ArchiveMutationError(
      `Control object failed size/CRC verification: ${key}`,
    );
  }
  return head;
};

const sealControlObject = async (context, key, bytes, metadata) => {
  const existing = await context.aws.headObject(key);
  if (existing) {
    const remote = await context.aws.getObjectBuffer(key);
    if (!remote.equals(bytes)) {
      throw new ArchiveRefusalError(
        `Control object already exists with different content: ${key}. ` +
          "Run status: it lists this orphaned control object and the reviewed command to move it aside.",
      );
    }
  } else {
    await context.aws.putControlObject(key, bytes, metadata);
  }
  return requireControlHead(context, key, bytes);
};

const loadSourceManifest = async (context, project) => {
  const migration = migrationOf(project);
  const expected = migration.manifests && migration.manifests.sourceSha256;
  if (!expected)
    throw new ArchiveRefusalError("No sealed source manifest is recorded");
  const key = sourceControlKey(context, project._id, migration.id);
  const bytes = await context.aws.getObjectBuffer(key);
  const { manifest } = parseAndVerifyManifest(bytes, expected);
  if (
    manifest.kind !== "source" ||
    String(manifest.projectId) !== String(project._id) ||
    String(manifest.migrationId) !== String(migration.id) ||
    manifest.sourceRoot !== migration.sourceRoot ||
    manifest.sourceRelativeRoot !== migration.sourceRelativeRoot ||
    manifest.dataPrefix !== project.storage.s3Uri ||
    manifest.dataKeyPrefix !==
      context.config.dataPrefixFor(migration.sourceRelativeRoot)
  ) {
    throw new ArchiveRefusalError(
      "Source manifest identity does not match the active migration",
    );
  }
  return { manifest: markManifestDigest(manifest, expected), bytes, key };
};

const loadVerificationReport = async (context, project) => {
  const migration = migrationOf(project);
  const expected =
    migration.manifests && migration.manifests.verificationSha256;
  if (!expected)
    throw new ArchiveRefusalError("No verified S3 report is recorded");
  const key = verificationControlKey(context, project._id, migration.id);
  const bytes = await context.aws.getObjectBuffer(key);
  const { manifest } = parseAndVerifyManifest(bytes, expected);
  if (
    manifest.kind !== "verification" ||
    String(manifest.projectId) !== String(project._id) ||
    String(manifest.migrationId) !== String(migration.id) ||
    manifest.verified !== true
  ) {
    throw new ArchiveRefusalError(
      "Verification report is not a passing report for this migration",
    );
  }
  return { report: manifest, bytes, key };
};

const projectEnvironment = async (
  context,
  project,
  { requireExists = true } = {},
) => {
  const computed = await validateProjectRoot(context.config, project, {
    requireExists,
  });
  if (
    project.archiveMigration &&
    !(
      resolveStorageState(project).state === "hpc" &&
      phaseOf(project) === "aborted"
    )
  ) {
    const migration = migrationOf(project);
    if (
      migration.sourceRoot !== computed.sourceRoot ||
      migration.sourceRelativeRoot !== computed.sourceRelativeRoot
    ) {
      throw new ArchiveRefusalError(
        "Current project path no longer matches the root snapshotted at lock time",
      );
    }
    const expectedDataUri = s3Uri(
      context.config.bucket,
      context.config.dataPrefixFor(migration.sourceRelativeRoot),
    );
    if (!project.storage || project.storage.s3Uri !== expectedDataUri) {
      throw new ArchiveRefusalError(
        `AWS_ARCHIVE_S3_ROOT no longer matches the destination snapshotted at lock (${project.storage && project.storage.s3Uri}); restore the original archive configuration`,
      );
    }
    const manifests = migration.manifests || {};
    if (manifests.sourceS3Uri) {
      const expectedSourceUri = s3Uri(
        context.config.bucket,
        sourceControlKey(context, project._id, migration.id),
      );
      if (manifests.sourceS3Uri !== expectedSourceUri) {
        throw new ArchiveRefusalError(
          "Configured archive control prefix does not match the sealed source manifest URI",
        );
      }
    }
    if (manifests.verificationS3Uri) {
      const expectedVerificationUri = s3Uri(
        context.config.bucket,
        verificationControlKey(context, project._id, migration.id),
      );
      if (manifests.verificationS3Uri !== expectedVerificationUri) {
        throw new ArchiveRefusalError(
          "Configured archive control prefix does not match the verification report URI",
        );
      }
    }
  }
  return computed;
};

const databasePreflight = async (context, project) => {
  const database = await collectProjectDatabase(context.models, project._id);
  const blockers = collectHardBlockers(database);
  if (blockers.length) {
    throw new ArchiveRefusalError("Project has unfinished HPC work", {
      blockers,
    });
  }
  return database;
};

const printObject = (context, value, { json = false } = {}) => {
  if (json) {
    context.stdout(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  context.stdout(`${JSON.stringify(value, null, 2)}\n`);
};

const plan = async (context, options, project) => {
  ensureState(project, ["hpc"]);
  const environment = await projectEnvironment(context, project);
  const database = await databasePreflight(context, project);
  // Planning is structural and therefore quick even for a multi-terabyte
  // project. The execute path performs the one full checksum inventory that
  // becomes the sealed source manifest.
  const inventory = await walkTree(environment.sourceRoot);
  const overlay = overlayDatabase(
    inventory,
    database,
    environment.sourceRelativeRoot,
  );
  const result = {
    command: "plan",
    identity: identitySummary(context, project),
    sourceRoot: environment.sourceRoot,
    destination: s3Uri(
      context.config.bucket,
      context.config.dataPrefixFor(environment.sourceRelativeRoot),
    ),
    hpcSnapshot: inventory.hpcSnapshot,
    summary: buildSummary(inventory.entries, overlay.anomalies),
    checksumInventory: "deferred to copy --execute",
    anomalies: overlay.anomalies,
    seriousAnomalies: overlay.anomalies.filter((item) => item.serious),
    mutates: false,
  };
  printObject(context, result, { json: options.json });
  return result.seriousAnomalies.length ? 1 : 0;
};

const lock = async (context, options, project) => {
  ensureState(project, ["hpc"]);
  const movedBy = requireOption(options, "moved-by");
  await requireKomondorUser(context.models.User, movedBy);
  await apiAppearsStopped(context.config.readyUrl);
  const environment = await projectEnvironment(context, project);
  const database = await databasePreflight(context, project);
  const inventory = await walkTree(environment.sourceRoot);
  const overlay = overlayDatabase(
    inventory,
    database,
    environment.sourceRelativeRoot,
  );
  const serious = overlay.anomalies.filter((item) => item.serious);
  if (serious.length && !options["acknowledge-known-anomalies"]) {
    throw new ArchiveRefusalError(
      "Serious known anomalies require --acknowledge-known-anomalies",
      { anomalies: serious },
    );
  }

  const migrationId = context.newId();
  const dataKeyPrefix = context.config.dataPrefixFor(
    environment.sourceRelativeRoot,
  );
  const controlPrefix = context.config.controlPrefixFor(
    project._id,
    migrationId,
  );
  const [dataExists, controlExists, uploads] = await Promise.all([
    context.aws.hasObjectsAtOrBelow(dataKeyPrefix),
    context.aws.hasObjectsAtOrBelow(controlPrefix),
    context.aws.listMultipartUploads(`${dataKeyPrefix}/`),
  ]);
  if (dataExists || controlExists || uploads.length) {
    throw new ArchiveRefusalError("Destination is not empty", {
      dataExists,
      controlExists,
      multipartUploads: uploads,
    });
  }

  const now = new Date(context.now());
  const result = {
    command: "lock",
    identity: identitySummary(context, project, migrationId),
    sourceRoot: environment.sourceRoot,
    destination: s3Uri(context.config.bucket, dataKeyPrefix),
    anomalies: overlay.anomalies,
    execute: Boolean(options.execute),
  };
  if (!options.execute) {
    printObject(context, { ...result, would: "lock project storage" });
    return 0;
  }

  const archiveMigration = {
    id: migrationId,
    phase: "locked",
    movedBy,
    osUser: context.identity.osUser,
    awsIdentityArn: context.identity.arn,
    awsAccountId: context.identity.accountId,
    startedAt: now,
    updatedAt: now,
    sourceRoot: environment.sourceRoot,
    sourceRelativeRoot: environment.sourceRelativeRoot,
    resumeCount: 0,
    restartedFrom: [],
    ...(serious.length
      ? { anomalyAcknowledgement: { by: movedBy, at: now } }
      : {}),
  };
  const updated = await lockProject(context.models.Project, project._id, {
    s3Uri: s3Uri(context.config.bucket, dataKeyPrefix),
    archiveMigration,
  });
  await databasePreflight(context, updated);
  printObject(context, { ...result, state: "migrating", phase: "locked" });
  return 0;
};

const prepareAndSealSource = async (context, options, project, movedBy) => {
  let current = project;
  const migrationId = String(migrationOf(current).id);
  const startingPhase = ensurePhase(current, ["locked", "inventoried"]);
  const migration = migrationOf(current);
  const database = await databasePreflight(context, current);
  const exclusions = exclusionsFromOptions(options, movedBy);
  const inventory = await createInventory(migration.sourceRoot, { exclusions });
  const overlay = overlayDatabase(
    inventory,
    database,
    migration.sourceRelativeRoot,
  );
  const serious = overlay.anomalies.filter((item) => item.serious);
  if (serious.length && !migration.anomalyAcknowledgement) {
    throw new ArchiveRefusalError(
      "Serious anomalies were not acknowledged when the project was locked",
      { anomalies: serious },
    );
  }
  const manifest = buildSourceManifest({
    context,
    project: current,
    migration,
    inventory,
    overlay,
    createdBy: {
      komondorUser: migration.movedBy,
      osUser: migration.osUser,
      awsArn: migration.awsIdentityArn,
    },
  });
  const bytes = serializeManifest(manifest);
  const digest = sha256Bytes(bytes);
  markManifestDigest(manifest, digest);
  if (startingPhase === "locked") {
    current = await transitionPhase(context.models.Project, {
      projectId: current._id,
      migrationId,
      expectedPhase: "locked",
      set: { "archiveMigration.phase": "inventoried" },
    });
  }
  const key = sourceControlKey(context, current._id, migrationId);
  await sealControlObject(context, key, bytes, {
    "komondor-project-id": String(current._id),
    "komondor-migration-id": migrationId,
    "komondor-manifest-sha256": digest,
  });

  const now = new Date(context.now());
  const set = {
    "archiveMigration.phase": "source_sealed",
    "archiveMigration.manifests.version": 1,
    "archiveMigration.manifests.sourceS3Uri": s3Uri(context.config.bucket, key),
    "archiveMigration.manifests.sourceSha256": digest,
    "archiveMigration.manifests.sourceSealedAt": now,
    "archiveMigration.manifests.fileCount": manifest.summary.regularFiles,
    "archiveMigration.manifests.totalBytes": manifest.summary.totalBytes,
    "archiveMigration.manifests.skippedEntries":
      manifest.summary.symlinks +
      manifest.summary.special +
      manifest.summary.excluded,
  };
  if (migration.anomalyAcknowledgement) {
    set["archiveMigration.anomalyAcknowledgement.manifestSha256"] = digest;
  }
  current = await transitionPhase(context.models.Project, {
    projectId: current._id,
    migrationId,
    expectedPhase: "inventoried",
    set,
    unset: {
      "archiveMigration.lastError": "",
      "archiveMigration.failedAt": "",
    },
  });
  return { project: current, manifest };
};

const sealVerification = async (
  context,
  project,
  sourceManifest,
  objectVerification,
  local,
) => {
  const migration = migrationOf(project);
  const now = new Date(context.now());
  const report = {
    manifestVersion: 1,
    kind: "verification",
    toolVersion: context.toolVersion,
    projectId: String(project._id),
    projectName: project.name,
    migrationId: String(migration.id),
    sourceRoot: migration.sourceRoot,
    sourceRelativeRoot: migration.sourceRelativeRoot,
    dataPrefix: sourceManifest.dataPrefix,
    createdBy: {
      komondorUser: migration.movedBy,
      osUser: context.identity.osUser,
      awsArn: context.identity.arn,
    },
    createdAt: now.toISOString(),
    verified: objectVerification.verified && local.matches,
    entries: objectVerification.entries,
    localTree: local,
    keySet: objectVerification.keySet,
    sourceManifestSha256: sourceManifest.sourceManifestSha256,
    exclusions: sourceManifest.entries
      .filter((entry) => entry.disposition === "excluded")
      .map((entry) => ({
        relPath: entry.relPath,
        excludedBy: entry.excludedBy,
        excludedReason: entry.excludedReason,
      })),
  };
  const bytes = serializeManifest(report);
  if (!report.verified) {
    const failedKey = joinKey(
      context.config.controlPrefixFor(project._id, migration.id),
      `verification-report.v1.failed-${now.toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await sealControlObject(context, failedKey, bytes, {
      "komondor-project-id": String(project._id),
      "komondor-migration-id": String(migration.id),
    });
    throw new ArchiveRefusalError("S3 or local verification failed", {
      objectVerification,
      local,
      failedReport: s3Uri(context.config.bucket, failedKey),
    });
  }

  const key = verificationControlKey(context, project._id, migration.id);
  let finalBytes = bytes;
  if (await context.aws.headObject(key)) {
    const existing = await context.aws.getObjectBuffer(key);
    const parsed = JSON.parse(existing.toString("utf8"));
    if (
      parsed.verified !== true ||
      parsed.sourceManifestSha256 !== sourceManifest.sourceManifestSha256
    ) {
      throw new ArchiveRefusalError(
        "Existing verification report does not match this source manifest",
      );
    }
    finalBytes = existing;
  } else {
    await sealControlObject(context, key, bytes, {
      "komondor-project-id": String(project._id),
      "komondor-migration-id": String(migration.id),
    });
  }
  await requireControlHead(context, key, finalBytes);
  return {
    report: JSON.parse(finalBytes.toString("utf8")),
    bytes: finalBytes,
    key,
    now,
  };
};

const executeCopy = async (context, options, initialProject, movedBy) => {
  let project = initialProject;
  const migrationId = String(migrationOf(project).id);
  let phase = phaseOf(project);
  try {
    if (["locked", "inventoried"].includes(phase)) {
      const prepared = await prepareAndSealSource(
        context,
        options,
        project,
        movedBy,
      );
      project = prepared.project;
    } else if ((options["exclude-entry"] || []).length) {
      throw new ArchiveRefusalError(
        "Exclusions cannot change after the source manifest is sealed",
      );
    }

    let loaded = await loadSourceManifest(context, project);
    phase = phaseOf(project);
    if (phase === "source_sealed") {
      project = await transitionPhase(context.models.Project, {
        projectId: project._id,
        migrationId,
        expectedPhase: "source_sealed",
        set: { "archiveMigration.phase": "copying" },
      });
      phase = "copying";
    }

    if (phase === "copying") {
      await copyManifestEntries(
        context.aws,
        migrationOf(project).sourceRoot,
        loaded.manifest,
        {
          onProgress: async ({ completed, total, entry }) => {
            context.stdout(
              `Copied/verified ${completed}/${total}: ${JSON.stringify(entry.relPath)}\n`,
            );
            await context.models.Project.updateOne(
              {
                _id: project._id,
                "storage.state": "migrating",
                "archiveMigration.id": migrationId,
                "archiveMigration.phase": "copying",
              },
              {
                $set: { "archiveMigration.updatedAt": new Date(context.now()) },
              },
            );
          },
        },
      );
      project = await transitionPhase(context.models.Project, {
        projectId: project._id,
        migrationId,
        expectedPhase: "copying",
        set: { "archiveMigration.phase": "copied" },
      });
      phase = "copied";
    }

    if (phase === "copied") {
      loaded = await loadSourceManifest(context, project);
      const objectVerification = await verifyManifestObjects(
        context.aws,
        loaded.manifest,
      );
      const local = await compareTreeToManifest(
        migrationOf(project).sourceRoot,
        loaded.manifest.entries,
      );
      const sealed = await sealVerification(
        context,
        project,
        loaded.manifest,
        objectVerification,
        local,
      );
      const digest = sha256Bytes(sealed.bytes);
      project = await fencedUpdate(
        context.models.Project,
        {
          _id: project._id,
          "storage.state": "migrating",
          "archiveMigration.id": migrationId,
          "archiveMigration.phase": "copied",
          "archiveMigration.manifests.sourceSha256":
            loaded.manifest.sourceManifestSha256,
        },
        {
          $set: {
            "storage.state": "aws_pending_hpc_deletion",
            "storage.s3VerifiedAt": sealed.now,
            "archiveMigration.phase": "verified",
            "archiveMigration.manifests.verificationS3Uri": s3Uri(
              context.config.bucket,
              sealed.key,
            ),
            "archiveMigration.manifests.verificationSha256": digest,
            "archiveMigration.manifests.verificationSealedAt": sealed.now,
            "archiveMigration.updatedAt": sealed.now,
          },
          $unset: {
            "archiveMigration.lastError": "",
            "archiveMigration.failedAt": "",
          },
        },
        "Verification succeeded but the final database fence failed",
      );
    }
    printObject(context, {
      command: "copy",
      identity: identitySummary(context, project, migrationId),
      state: resolveStorageState(project).state,
      phase: phaseOf(project),
      next: "Run deletion-command, review it, delete manually, then run confirm-absent",
    });
    return 0;
  } catch (error) {
    const latest = await loadProject(context.models.Project, project._id).catch(
      () => project,
    );
    project = latest;
    await recordMigrationError(context.models.Project, {
      projectId: project._id,
      migrationId,
      phase: phaseOf(project),
      error,
    });
    if (error.exitCode === 1 && phaseOf(project) === "locked") {
      throw error;
    }
    throw new ArchiveMutationError(error.message, error.details || {});
  }
};

const copy = async (context, options, project) => {
  ensureState(project, ["migrating", "aws_pending_hpc_deletion"]);
  if (resolveStorageState(project).state === "aws_pending_hpc_deletion") {
    printObject(context, {
      command: "copy",
      state: "aws_pending_hpc_deletion",
      phase: phaseOf(project),
      nothingToDo: true,
    });
    return 0;
  }
  ensurePhase(project, [
    "locked",
    "inventoried",
    "source_sealed",
    "copying",
    "copied",
    "verified",
  ]);
  const movedBy = requireOption(options, "moved-by");
  await requireKomondorUser(context.models.User, movedBy);
  if (String(migrationOf(project).movedBy) !== movedBy) {
    throw new ArchiveRefusalError(
      `--moved-by must match the operator recorded at lock (${migrationOf(project).movedBy})`,
    );
  }
  await projectEnvironment(context, project);
  await databasePreflight(context, project);
  if (
    migrationOf(project).lastError &&
    !["locked", "inventoried"].includes(phaseOf(project))
  ) {
    throw new ArchiveRefusalError("Migration has a recorded error; use resume");
  }
  exclusionsFromOptions(options, movedBy);
  if (!options.execute) {
    let preview = null;
    if (["locked", "inventoried"].includes(phaseOf(project))) {
      const migration = migrationOf(project);
      const inventory = await walkTree(migration.sourceRoot);
      const database = await collectProjectDatabase(
        context.models,
        project._id,
      );
      const overlay = overlayDatabase(
        inventory,
        database,
        migration.sourceRelativeRoot,
      );
      preview = {
        hpcSnapshot: inventory.hpcSnapshot,
        summary: buildSummary(inventory.entries, overlay.anomalies),
        anomalies: overlay.anomalies,
        checksumInventory: "deferred to copy --execute",
      };
    } else {
      const loaded = await loadSourceManifest(context, project);
      preview = { sealedManifestSha256: loaded.manifest.sourceManifestSha256 };
    }
    printObject(context, {
      command: "copy",
      identity: identitySummary(context, project, migrationOf(project).id),
      phase: phaseOf(project),
      would: "seal, copy and verify this migration",
      preview,
    });
    return 0;
  }
  return executeCopy(context, options, project, movedBy);
};

const classifyObjects = async (context, project, sourceManifest, objects) => {
  const migration = migrationOf(project);
  const expectedByKey = new Map(
    (sourceManifest ? sourceManifest.entries : [])
      .filter((entry) => entry.disposition === "copy")
      .map((entry) => [entry.s3Key, entry]),
  );
  const owned = [];
  const prior = [];
  const foreign = [];
  for (const object of objects) {
    const entry = expectedByKey.get(object.Key);
    const head = await context.aws.headObject(object.Key);
    const id = metadataValue(head, "komondor-migration-id");
    const projectId = metadataValue(head, "komondor-project-id");
    const item = {
      key: object.Key,
      size: object.Size,
      migrationId: id,
      ...(sourceManifest ? {} : { identityMetadataOnly: true }),
    };
    if (
      (!sourceManifest &&
        projectId === String(project._id) &&
        id === String(migration.id)) ||
      (entry && isOwned(head, sourceManifest, entry))
    ) {
      owned.push(item);
    } else if (
      projectId === String(project._id) &&
      (migration.restartedFrom || []).map(String).includes(id) &&
      (!sourceManifest ||
        (entry && isOwned(head, sourceManifest, entry, { allowPrior: true })))
    ) {
      prior.push(item);
    } else foreign.push(item);
  }
  return { owned, prior, foreign };
};

const status = async (context, options, project) => {
  const state = ensureValidState(project).state;
  await projectEnvironment(context, project, {
    requireExists: state === "hpc" || state === "migrating",
  });
  const migration = project.archiveMigration ? migrationOf(project) : null;
  let sourceManifest = null;
  let sourceManifestCheck = { exists: false, digestMatches: false };
  if (migration && migration.manifests && migration.manifests.sourceSha256) {
    try {
      const loaded = await loadSourceManifest(context, project);
      sourceManifest = loaded.manifest;
      sourceManifestCheck = { exists: true, digestMatches: true };
    } catch (error) {
      sourceManifestCheck = {
        exists: !/not found|NoSuchKey/i.test(error.message),
        digestMatches: false,
        error: error.message,
      };
    }
  } else if (migration) {
    const key = sourceControlKey(context, project._id, migration.id);
    sourceManifestCheck.exists = Boolean(await context.aws.headObject(key));
  }

  let objects = [];
  let multipartUploads = [];
  let controlObjects = [];
  let ownership = { owned: [], prior: [], foreign: [] };
  if (migration) {
    const prefix = context.config.dataPrefixFor(migration.sourceRelativeRoot);
    const controlPrefix = context.config.controlPrefixFor(
      project._id,
      migration.id,
    );
    [objects, multipartUploads, controlObjects] = await Promise.all([
      context.aws.listObjectsAtOrBelow(prefix),
      context.aws.listMultipartUploads(`${prefix}/`),
      context.aws.listObjectsAtOrBelow(controlPrefix),
    ]);
    ownership = await classifyObjects(
      context,
      project,
      sourceManifest,
      objects,
    );
  }

  let hpcExists = null;
  if (migration && ["aws_pending_hpc_deletion", "aws"].includes(state)) {
    try {
      await context.fs.lstat(migration.sourceRoot);
      hpcExists = true;
    } catch (error) {
      if (error.code === "ENOENT") hpcExists = false;
      else hpcExists = `unknown: ${error.code || error.message}`;
    }
  }
  // "inventoried" is included for the orphan case: the source manifest was PUT
  // but the database fence that followed it failed, and a later inventory no
  // longer matches the sealed bytes. Until that control object is moved aside,
  // copy cannot adopt it and abort-before-copy refuses a non-empty control
  // prefix, so status must be the command that shows the way out.
  const cleanupAllowed = Boolean(
    state === "migrating" &&
    migration &&
    (migration.lastError || sourceManifestCheck.error) &&
    ["inventoried", "source_sealed", "copying", "copied"].includes(
      migration.phase,
    ),
  );
  const abandonedPrefix = migration
    ? joinKey(
        context.config.basePrefix,
        "control",
        "projects",
        String(project._id),
        "abandoned",
        String(migration.id),
      )
    : null;
  const controlPrefixOf = migration
    ? context.config.controlPrefixFor(project._id, migration.id)
    : null;
  const cleanupCommands = cleanupAllowed
    ? [
        ...ownership.owned.map(
          (item) =>
            `aws s3api delete-object --bucket ${shellQuote(context.config.bucket)} --key ${shellQuote(item.key)}`,
        ),
        ...multipartUploads.map(
          (upload) =>
            `aws s3api abort-multipart-upload --bucket ${shellQuote(context.config.bucket)} --key ${shellQuote(upload.Key)} --upload-id ${shellQuote(upload.UploadId)}`,
        ),
        ...controlObjects.map((object) => {
          const relative = object.Key.startsWith(`${controlPrefixOf}/`)
            ? object.Key.slice(controlPrefixOf.length + 1)
            : object.Key.split("/").pop();
          return `aws s3 mv ${shellQuote(s3Uri(context.config.bucket, object.Key))} ${shellQuote(
            s3Uri(context.config.bucket, joinKey(abandonedPrefix, relative)),
          )}`;
        }),
      ]
    : [];
  const result = {
    command: "status",
    identity: identitySummary(context, project, migration && migration.id),
    state,
    phase: migration && migration.phase,
    migration: migration
      ? {
          id: migration.id,
          movedBy: migration.movedBy,
          startedAt: asIso(migration.startedAt),
          updatedAt: asIso(migration.updatedAt),
          lastError: migration.lastError || null,
          resumeCount: migration.resumeCount || 0,
          restartedFrom: migration.restartedFrom || [],
          manifests: migration.manifests || {},
        }
      : null,
    sourceManifest: sourceManifestCheck,
    objects: {
      total: objects.length,
      owned: ownership.owned,
      prior: ownership.prior,
      foreign: ownership.foreign,
    },
    multipartUploads,
    controlObjects: controlObjects.map((object) => ({
      key: object.Key,
      size: object.Size,
    })),
    hpcExists,
    cleanupWarning: cleanupAllowed
      ? "REVIEW BEFORE RUNNING WITH A ROLE THAT HAS DELETE. These commands are for abandoning this failed migration, not for HPC cleanup. Multipart uploads cannot be attributed from the listing alone; review each one. Control objects are moved under the abandoned/ prefix, after which copy, abort-before-copy or restart can proceed as the runbook describes."
      : null,
    cleanupCommands,
  };
  printObject(context, result, { json: options.json });
  return sourceManifestCheck.error || ownership.foreign.length ? 1 : 0;
};

const resume = async (context, options, project) => {
  ensureState(project, ["migrating"]);
  const migrationId = requireOption(options, "migration-id");
  const resumedBy = requireOption(options, "resumed-by");
  await requireKomondorUser(context.models.User, resumedBy);
  const migration = migrationOf(project);
  if (String(migration.id) !== migrationId) {
    throw new ArchiveRefusalError(
      "--migration-id does not match the active migration",
    );
  }
  ensurePhase(project, ["source_sealed", "copying", "copied"]);
  await projectEnvironment(context, project);
  await loadSourceManifest(context, project);
  if (!options.execute) {
    printObject(context, {
      command: "resume",
      identity: identitySummary(context, project, migrationId),
      would: `clear the error and resume phase ${migration.phase}`,
    });
    return 0;
  }
  const now = new Date(context.now());
  const updated = await fencedUpdate(
    context.models.Project,
    {
      _id: project._id,
      "storage.state": "migrating",
      "archiveMigration.id": migrationId,
      "archiveMigration.phase": migration.phase,
      "archiveMigration.manifests.sourceSha256":
        migration.manifests.sourceSha256,
    },
    {
      $set: {
        "archiveMigration.lastResumedBy": resumedBy,
        "archiveMigration.lastResumedAt": now,
        "archiveMigration.updatedAt": now,
      },
      $inc: { "archiveMigration.resumeCount": 1 },
      $unset: {
        "archiveMigration.lastError": "",
        "archiveMigration.failedAt": "",
      },
    },
    "Resume fence failed",
  );
  return executeCopy(context, {}, updated, resumedBy);
};

const requireEmptyDestination = async (context, project, migrationId) => {
  const migration = migrationOf(project);
  const dataPrefix = `${context.config.dataPrefixFor(migration.sourceRelativeRoot)}/`;
  const controlPrefix = `${context.config.controlPrefixFor(project._id, migrationId)}/`;
  const [dataExists, controlExists, uploads] = await Promise.all([
    context.aws.hasObjectsAtOrBelow(dataPrefix.replace(/\/+$/, "")),
    context.aws.hasObjectsAtOrBelow(controlPrefix.replace(/\/+$/, "")),
    context.aws.listMultipartUploads(dataPrefix),
  ]);
  if (dataExists || controlExists || uploads.length) {
    throw new ArchiveRefusalError(
      "Migration destination/control prefix is not empty",
      {
        dataExists,
        controlExists,
        multipartUploads: uploads,
      },
    );
  }
};

const abortBeforeCopy = async (context, options, project) => {
  ensureState(project, ["migrating"]);
  const migrationId = requireOption(options, "migration-id");
  const abortedBy = requireOption(options, "aborted-by");
  await requireKomondorUser(context.models.User, abortedBy);
  const migration = migrationOf(project);
  if (String(migration.id) !== migrationId)
    throw new ArchiveRefusalError("Migration id does not match");
  ensurePhase(project, ["locked", "inventoried"]);
  await projectEnvironment(context, project);
  if (migration.manifests && migration.manifests.sourceSha256) {
    throw new ArchiveRefusalError(
      "A source manifest is sealed; automatic abort is forbidden",
    );
  }
  await requireEmptyDestination(context, project, migrationId);
  if (!options.execute) {
    printObject(context, {
      command: "abort-before-copy",
      would: "return project to hpc",
      migrationId,
    });
    return 0;
  }
  const now = new Date(context.now());
  await fencedUpdate(
    context.models.Project,
    {
      _id: project._id,
      "storage.state": "migrating",
      "archiveMigration.id": migrationId,
      "archiveMigration.phase": { $in: ["locked", "inventoried"] },
      "archiveMigration.manifests.sourceSha256": { $exists: false },
    },
    {
      $set: {
        storage: { state: "hpc" },
        "archiveMigration.phase": "aborted",
        "archiveMigration.abortedBy": abortedBy,
        "archiveMigration.abortedAt": now,
        "archiveMigration.updatedAt": now,
      },
    },
    "Abort fence failed",
  );
  printObject(context, {
    command: "abort-before-copy",
    state: "hpc",
    phase: "aborted",
    migrationId,
  });
  return 0;
};

const restart = async (context, options, project) => {
  ensureState(project, ["migrating"]);
  const oldId = requireOption(options, "migration-id");
  const restartedBy = requireOption(options, "restarted-by");
  await requireKomondorUser(context.models.User, restartedBy);
  const old = migrationOf(project);
  if (String(old.id) !== oldId)
    throw new ArchiveRefusalError("Migration id does not match");
  if (!["source_sealed", "copying", "copied"].includes(old.phase)) {
    throw new ArchiveRefusalError(
      "restart is only for a sealed, irrecoverable migration",
    );
  }
  await projectEnvironment(context, project);
  await requireEmptyDestination(context, project, oldId);
  const newId = context.newId();
  const result = {
    command: "restart",
    oldMigrationId: oldId,
    newMigrationId: newId,
  };
  if (!options.execute) {
    printObject(context, {
      ...result,
      would: "start a fresh locked migration",
    });
    return 0;
  }
  const now = new Date(context.now());
  const restartedFrom = [...(old.restartedFrom || []).map(String), oldId];
  const replacement = {
    id: newId,
    phase: "locked",
    movedBy: restartedBy,
    osUser: context.identity.osUser,
    awsIdentityArn: context.identity.arn,
    awsAccountId: context.identity.accountId,
    startedAt: now,
    updatedAt: now,
    sourceRoot: old.sourceRoot,
    sourceRelativeRoot: old.sourceRelativeRoot,
    resumeCount: 0,
    restartedFrom,
    ...(old.anomalyAcknowledgement
      ? { anomalyAcknowledgement: { by: restartedBy, at: now } }
      : {}),
  };
  await fencedUpdate(
    context.models.Project,
    {
      _id: project._id,
      "storage.state": "migrating",
      "archiveMigration.id": oldId,
    },
    { $set: { archiveMigration: replacement } },
    "Restart fence failed",
  );
  printObject(context, { ...result, phase: "locked" });
  return 0;
};

const deletionCommand = async (context, _options, project) => {
  ensureState(project, ["aws_pending_hpc_deletion"]);
  ensurePhase(project, ["verified"]);
  const migration = migrationOf(project);
  await projectEnvironment(context, project);
  await loadVerificationReport(context, project);
  const { manifest } = await loadSourceManifest(context, project);
  const objects = await verifyManifestObjects(context.aws, manifest);
  if (!objects.verified) {
    throw new ArchiveRefusalError(
      "S3 objects no longer match the verified manifest",
      { objects },
    );
  }
  const local = await compareTreeToManifest(
    migration.sourceRoot,
    manifest.entries,
  );
  if (!local.matches) {
    throw new ArchiveRefusalError(
      "HPC tree drifted after verification; preserve the drift and restore the sealed tree before deletion",
      { differences: local.differences },
    );
  }
  context.stdout(
    `# Project ${project._id} ${JSON.stringify(project.name)} — migration ${migration.id} — verified in S3 ${asIso(project.storage.s3VerifiedAt)}\n`,
  );
  context.stdout(
    `# ${migration.manifests.fileCount || 0} files, ${migration.manifests.totalBytes || 0} bytes. This removes the HPC copy. S3 is authoritative.\n`,
  );
  const exclusions = manifest.entries.filter(
    (entry) => entry.disposition === "excluded",
  );
  if (exclusions.length) {
    context.stdout(
      `# WARNING: ${exclusions.length} regular file(s) were explicitly EXCLUDED and are not in S3. Deleting the tree also deletes those files.\n`,
    );
    exclusions.forEach((entry) => {
      context.stdout(
        `# EXCLUDED ${JSON.stringify(entry.relPath)}: ${JSON.stringify(entry.excludedReason)}\n`,
      );
    });
  }
  context.stdout(`rm -rf -- ${shellQuote(migration.sourceRoot)}\n`);
  return 0;
};

const confirmAbsent = async (context, options, project) => {
  ensureState(project, ["aws_pending_hpc_deletion"]);
  ensurePhase(project, ["verified"]);
  const confirmedBy = requireOption(options, "confirmed-by");
  await requireKomondorUser(context.models.User, confirmedBy);
  const migration = migrationOf(project);
  await projectEnvironment(context, project, { requireExists: false });
  try {
    await context.fs.lstat(migration.sourceRoot);
    throw new ArchiveRefusalError(
      `HPC project path still exists (even an empty directory is not absent): ${migration.sourceRoot}`,
    );
  } catch (error) {
    if (error instanceof ArchiveRefusalError) throw error;
    if (error.code !== "ENOENT") {
      throw new ArchiveRefusalError(
        `Cannot prove the HPC path is absent: ${error.code || error.message}`,
      );
    }
  }
  await loadVerificationReport(context, project);
  if (!options.execute) {
    printObject(context, {
      command: "confirm-absent",
      would: "finalize project as aws",
      migrationId: migration.id,
    });
    return 0;
  }
  const now = new Date(context.now());
  await fencedUpdate(
    context.models.Project,
    {
      _id: project._id,
      "storage.state": "aws_pending_hpc_deletion",
      "archiveMigration.id": migration.id,
      "archiveMigration.manifests.verificationSha256":
        migration.manifests.verificationSha256,
    },
    {
      $set: {
        "storage.state": "aws",
        "storage.hpcVerifiedAbsentAt": now,
        "storage.archivedAt": now,
        "archiveMigration.phase": "completed",
        "archiveMigration.confirmedAbsentBy": confirmedBy,
        "archiveMigration.updatedAt": now,
      },
    },
    "Final confirmation fence failed",
  );
  printObject(context, {
    command: "confirm-absent",
    state: "aws",
    phase: "completed",
    migrationId: migration.id,
  });
  return 0;
};

const dispatch = async (context, command, options, project) => {
  if (command === "plan") return plan(context, options, project);
  if (command === "lock") return lock(context, options, project);
  if (command === "copy") return copy(context, options, project);
  if (command === "status") return status(context, options, project);
  if (command === "resume") return resume(context, options, project);
  if (command === "abort-before-copy")
    return abortBeforeCopy(context, options, project);
  if (command === "restart") return restart(context, options, project);
  if (command === "deletion-command")
    return deletionCommand(context, options, project);
  if (command === "confirm-absent")
    return confirmAbsent(context, options, project);
  throw new ArchiveConfigurationError(`Unsupported command: ${command}`);
};

const createContext = (dependencies) => ({
  ...dependencies,
  fs: dependencies.fs || require("fs").promises,
  now: dependencies.now || (() => Date.now()),
  stdout: dependencies.stdout || ((value) => process.stdout.write(value)),
  stderr: dependencies.stderr || ((value) => process.stderr.write(value)),
  newId:
    dependencies.newId ||
    (() => new dependencies.mongoose.Types.ObjectId().toString()),
  toolVersion: dependencies.toolVersion || "unknown",
});

const runCli = async (argv, dependencies) => {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    (dependencies.stderr || ((value) => process.stderr.write(value)))(
      `${error.message}\n`,
    );
    return error.exitCode || 2;
  }
  const context = createContext(dependencies);
  try {
    try {
      context.identity = await validateAws(context.aws, context.config);
    } catch (error) {
      if (error.exitCode) throw error;
      throw new ArchiveConfigurationError(
        `AWS archive preflight failed: ${error.message}`,
      );
    }
    const project = await loadProject(
      context.models.Project,
      parsed.options["project-id"],
    );
    if (MUTATING_COMMANDS.has(parsed.command)) ensureValidState(project);
    return await dispatch(context, parsed.command, parsed.options, project);
  } catch (error) {
    const code =
      error.exitCode || (error instanceof ArchiveConfigurationError ? 2 : 1);
    context.stderr(`${error.message}\n`);
    if (error.details && Object.keys(error.details).length) {
      context.stderr(`${JSON.stringify(error.details, null, 2)}\n`);
    }
    return code;
  }
};

module.exports = {
  buildSourceManifest,
  buildSummary,
  completeManifestEntries,
  exclusionsFromOptions,
  loadSourceManifest,
  loadVerificationReport,
  parseArgs,
  runCli,
  sourceControlKey,
  verificationControlKey,
};
