const path = require("path");

const STORAGE_STATES = Object.freeze([
  "hpc",
  "migrating",
  "aws_pending_hpc_deletion",
  "aws",
]);

const MIGRATION_PHASES = Object.freeze([
  "locked",
  "inventoried",
  "source_sealed",
  "copying",
  "copied",
  "verified",
  "completed",
  "aborted",
]);

// Missing storage.state is deliberately writable for legacy Project records.
// Keep this as a fresh plain object that callers can safely spread into a
// larger MongoDB filter.
const HPC_WRITABLE_FILTER = Object.freeze({
  $or: [{ "storage.state": { $exists: false } }, { "storage.state": "hpc" }],
});

const NON_HPC_FILTER = Object.freeze({
  "storage.state": { $exists: true, $ne: "hpc" },
});

const READ_ONLY_CODE = "PROJECT_STORAGE_READ_ONLY";

const valueOf = (value) =>
  value && typeof value.toObject === "function"
    ? value.toObject({ transform: false, virtuals: false })
    : value;

const present = (value) =>
  value !== undefined && value !== null && value !== "";

const hasStorageEvidence = (storage) =>
  storage &&
  ["s3Uri", "s3VerifiedAt", "hpcVerifiedAbsentAt", "archivedAt"].some((field) =>
    present(storage[field]),
  );

/**
 * Resolves a Project's stored lifecycle without silently accepting corrupt or
 * half-written state. A real legacy Project object with no storage is HPC;
 * null/undefined is not a Project and therefore invalid.
 */
const resolveStorageState = (projectLike) => {
  if (!projectLike || typeof projectLike !== "object") {
    return {
      state: "invalid",
      acceptsHpcWrites: false,
      authoritativeLocation: null,
      integrityError: "Project storage cannot be resolved without a project",
    };
  }

  const project = valueOf(projectLike) || {};
  const storage = valueOf(project.storage) || {};
  const state = storage.state;
  const evidence = hasStorageEvidence(storage);

  let valid = false;
  if (!present(state)) {
    valid = !evidence;
  } else if (state === "hpc") {
    valid = !evidence;
  } else if (state === "migrating") {
    valid = present(storage.s3Uri);
  } else if (state === "aws_pending_hpc_deletion") {
    valid = present(storage.s3Uri) && present(storage.s3VerifiedAt);
  } else if (state === "aws") {
    valid =
      present(storage.s3Uri) &&
      present(storage.s3VerifiedAt) &&
      present(storage.hpcVerifiedAbsentAt) &&
      present(storage.archivedAt);
  }

  if (!valid) {
    const label = present(state) ? JSON.stringify(state) : "missing";
    return {
      state: "invalid",
      acceptsHpcWrites: false,
      authoritativeLocation: null,
      integrityError: `Invalid Project storage lifecycle (state ${label})`,
    };
  }

  const resolvedState = state || "hpc";
  return {
    state: resolvedState,
    acceptsHpcWrites: resolvedState === "hpc",
    authoritativeLocation:
      resolvedState === "hpc" || resolvedState === "migrating" ? "hpc" : "s3",
    integrityError: null,
  };
};

const migrationHealth = (projectLike, state) => {
  if (state !== "migrating") {
    return null;
  }

  const project = valueOf(projectLike) || {};
  const migration = valueOf(project.archiveMigration) || {};
  if (migration.lastError) {
    return "needs_attention";
  }

  const updatedAt = migration.updatedAt && new Date(migration.updatedAt);
  if (
    migration.phase === "copying" &&
    updatedAt instanceof Date &&
    !Number.isNaN(updatedAt.getTime()) &&
    Date.now() - updatedAt.getTime() > 24 * 60 * 60 * 1000
  ) {
    return "needs_attention";
  }

  return "active";
};

/** Public, deliberately small representation used by every HTTP response. */
const publicStorageSummary = (projectLike) => {
  const project = valueOf(projectLike) || {};
  const storage = valueOf(project.storage) || {};
  const resolved = resolveStorageState(projectLike);

  return {
    state: resolved.state,
    acceptsHpcWrites: resolved.acceptsHpcWrites,
    authoritativeLocation: resolved.authoritativeLocation,
    s3Uri: present(storage.s3Uri) ? storage.s3Uri : null,
    s3VerifiedAt: storage.s3VerifiedAt || null,
    hpcVerifiedAbsentAt: storage.hpcVerifiedAbsentAt || null,
    archivedAt: storage.archivedAt || null,
    migrationHealth: migrationHealth(project, resolved.state),
  };
};

class StorageReadOnlyError extends Error {
  constructor(projectLike) {
    const resolved = resolveStorageState(projectLike);
    const projectId =
      projectLike && projectLike._id ? String(projectLike._id) : "unknown";
    super(`${READ_ONLY_CODE}: project ${projectId} is ${resolved.state}`);
    this.name = "StorageReadOnlyError";
    this.code = READ_ONLY_CODE;
    this.projectId = projectId === "unknown" ? null : projectId;
    this.storageState = resolved.state;
    this.retryable = false;
    this.runStatusError = `This project's storage is read-only (${resolved.state}); the ingest was not performed.`;
  }
}

const logIntegrityError = (projectLike, resolved) => {
  if (!resolved.integrityError) {
    return;
  }
  const id = projectLike && projectLike._id ? projectLike._id : "unknown";
  console.error(
    `[storage-integrity] project ${id}: ${resolved.integrityError}`,
  );
};

const assertProjectAcceptsHpcWrites = (projectLike) => {
  const resolved = resolveStorageState(projectLike);
  if (!resolved.acceptsHpcWrites) {
    logIntegrityError(projectLike, resolved);
    throw new StorageReadOnlyError(projectLike);
  }
  return resolved;
};

const stripLeadingSlash = (value) => String(value || "").replace(/^\/+/, "");
const stripTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const relativePathWithinProject = (projectLike, entityPath) => {
  const project = valueOf(projectLike) || {};
  const root = stripLeadingSlash(
    project.archiveMigration?.sourceRelativeRoot || project.path,
  );
  const entity = stripLeadingSlash(entityPath);

  if (!root || !entity) {
    return null;
  }
  if (entity === root) {
    return "";
  }
  return entity.startsWith(`${root}/`) ? entity.slice(root.length + 1) : null;
};

const appendUri = (base, relative = "") => {
  const cleanBase = stripTrailingSlash(base);
  const cleanRelative = stripLeadingSlash(relative);
  return cleanRelative ? `${cleanBase}/${cleanRelative}` : cleanBase;
};

/**
 * Returns a display-ready location for one Project/Sample/Run detail response.
 * entityPath is the existing datastore-relative .path on that entity.
 */
const locationFor = (projectLike, entityPath, { includeRaw = false } = {}) => {
  const project = valueOf(projectLike) || {};
  const resolved = resolveStorageState(projectLike);
  const datastoreRelative = stripLeadingSlash(entityPath);
  const withinProject = relativePathWithinProject(project, entityPath);

  if (
    resolved.state === "invalid" ||
    !datastoreRelative ||
    withinProject === null
  ) {
    return {
      authoritative: null,
      baseUri: null,
      ...(includeRaw ? { rawUri: null } : {}),
      additionalUri: null,
      plannedS3Uri: null,
    };
  }

  const hpcRoot = process.env.READS_ROOT_PATH || "/tsl/data/reads";
  const hpcUri = path.posix.join(hpcRoot, datastoreRelative);
  const s3Uri = present(project.storage?.s3Uri)
    ? appendUri(project.storage.s3Uri, withinProject)
    : null;
  const baseUri = resolved.authoritativeLocation === "s3" ? s3Uri : hpcUri;

  return {
    authoritative: resolved.authoritativeLocation,
    baseUri,
    ...(includeRaw
      ? { rawUri: baseUri ? appendUri(baseUri, "raw") : null }
      : {}),
    additionalUri: baseUri ? appendUri(baseUri, "additional") : null,
    plannedS3Uri: resolved.state === "migrating" ? s3Uri : null,
  };
};

const notApplicableReconciliation = (state) => {
  let message =
    "HPC reconciliation is not applicable: this project's storage lifecycle is invalid.";
  if (state === "migrating") {
    message =
      "HPC reconciliation is not applicable while this project is being moved to AWS S3.";
  } else if (state === "aws_pending_hpc_deletion" || state === "aws") {
    message =
      "HPC reconciliation is not applicable: this project's authoritative storage is S3.";
  }

  return {
    status: "NOT_APPLICABLE",
    reason: READ_ONLY_CODE,
    storageState: state,
    message,
    missing: [],
    extra: [],
    unresolved: [],
  };
};

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const isPopulatedProject = (value) =>
  Boolean(
    value &&
    typeof value === "object" &&
    value._id &&
    (value.storage !== undefined ||
      value.path !== undefined ||
      value.name !== undefined ||
      value.constructor?.modelName === "Project"),
  );

const setDerivedField = (doc, field, value) => {
  if (!doc || typeof doc !== "object") return;
  if (typeof doc.set === "function") {
    doc.set(field, value, { strict: false });
  } else {
    doc[field] = value;
  }
};

/**
 * Adds projectStorage without changing existing relationship-field shapes.
 * The helper performs at most one Sample query and one Project query.
 */
const attachProjectStorage = async (docs, { via } = {}) => {
  const list = Array.isArray(docs) ? docs : docs ? [docs] : [];
  if (list.length === 0) return docs;

  const projectByEntity = new Map();
  const projectIds = new Set();

  if (via === "project") {
    list.forEach((doc) => {
      const relation = doc.project;
      if (isPopulatedProject(relation)) {
        projectByEntity.set(String(doc._id), relation);
      } else {
        const id = idOf(relation);
        if (id) projectIds.add(id);
      }
    });
  } else if (via === "sample") {
    const sampleIds = new Set();
    list.forEach((doc) => {
      const sample = doc.sample;
      if (sample && typeof sample === "object" && sample.project) {
        const relation = sample.project;
        if (isPopulatedProject(relation)) {
          projectByEntity.set(String(doc._id), relation);
        } else {
          const id = idOf(relation);
          if (id) projectIds.add(id);
        }
      } else {
        const id = idOf(sample);
        if (id) sampleIds.add(id);
      }
    });

    if (sampleIds.size > 0) {
      const Sample = require("../models/Sample");
      const samples = await Sample.find({
        _id: { $in: [...sampleIds] },
      }).select("_id project");
      const projectIdBySample = new Map();
      (samples || []).forEach((sample) => {
        const projectId = idOf(sample.project);
        if (projectId) {
          projectIdBySample.set(String(sample._id), projectId);
          projectIds.add(projectId);
        }
      });
      list.forEach((doc) => {
        const projectId = projectIdBySample.get(idOf(doc.sample));
        if (projectId) projectByEntity.set(String(doc._id), projectId);
      });
    }
  } else {
    throw new TypeError(
      'attachProjectStorage requires via "project" or "sample"',
    );
  }

  const Project = require("../models/Project");
  const projects = projectIds.size
    ? await Project.find({ _id: { $in: [...projectIds] } }).select(
        "storage +archiveMigration",
      )
    : [];
  const projectsById = new Map(
    (projects || []).map((project) => [String(project._id), project]),
  );

  list.forEach((doc) => {
    let project = projectByEntity.get(String(doc._id));
    if (typeof project === "string") project = projectsById.get(project);
    if (!project && via === "project") {
      project = projectsById.get(idOf(doc.project));
    } else if (!project && via === "sample") {
      const sample = doc.sample;
      const projectId =
        sample && typeof sample === "object" ? idOf(sample.project) : null;
      if (projectId) project = projectsById.get(projectId);
    }

    // An orphaned child is corrupt and must fail closed, not look writable.
    setDerivedField(
      doc,
      "projectStorage",
      publicStorageSummary(project || null),
    );
  });

  return docs;
};

module.exports = {
  STORAGE_STATES,
  MIGRATION_PHASES,
  HPC_WRITABLE_FILTER,
  NON_HPC_FILTER,
  READ_ONLY_CODE,
  StorageReadOnlyError,
  resolveStorageState,
  publicStorageSummary,
  assertProjectAcceptsHpcWrites,
  relativePathWithinProject,
  appendUri,
  locationFor,
  notApplicableReconciliation,
  attachProjectStorage,
  setDerivedField,
};
