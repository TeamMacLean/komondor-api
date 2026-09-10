const {
  HPC_WRITABLE_FILTER,
  resolveStorageState,
} = require("../storage-state");
const { ArchiveMutationError, ArchiveRefusalError } = require("./errors");

const withMigration = (query) =>
  query && typeof query.select === "function"
    ? query.select("+archiveMigration")
    : query;

const execute = (query) =>
  query && typeof query.exec === "function" ? query.exec() : query;

const loadProject = async (Project, projectId) => {
  const project = await execute(withMigration(Project.findById(projectId)));
  if (!project)
    throw new ArchiveRefusalError(`Project not found: ${projectId}`);
  return project;
};

const ensureValidState = (project) => {
  const resolved = resolveStorageState(project);
  if (resolved.state === "invalid") {
    throw new ArchiveRefusalError(resolved.integrityError);
  }
  return resolved;
};

const fencedUpdate = async (Project, filter, update, message) => {
  const query = Project.findOneAndUpdate(filter, update, { new: true });
  const updated = await execute(withMigration(query));
  if (!updated) {
    throw new ArchiveMutationError(
      message || "Migration state changed concurrently; no update was made",
    );
  }
  return updated;
};

const lockProject = (Project, projectId, values) =>
  fencedUpdate(
    Project,
    { _id: projectId, ...HPC_WRITABLE_FILTER },
    {
      $set: {
        storage: { state: "migrating", s3Uri: values.s3Uri },
        archiveMigration: values.archiveMigration,
      },
    },
    "Project is no longer writable on HPC; lock fence failed",
  );

const transitionPhase = (
  Project,
  { projectId, migrationId, expectedPhase, set = {}, unset = {} },
) => {
  const update = {
    $set: {
      ...set,
      "archiveMigration.updatedAt": new Date(),
    },
  };
  if (Object.keys(unset).length) update.$unset = unset;
  return fencedUpdate(
    Project,
    {
      _id: projectId,
      "storage.state": "migrating",
      "archiveMigration.id": migrationId,
      "archiveMigration.phase": expectedPhase,
    },
    update,
    `Migration phase is no longer ${expectedPhase}; stopped safely`,
  );
};

const recordMigrationError = async (
  Project,
  { projectId, migrationId, phase, error },
) => {
  const now = new Date();
  const message = String(error && error.message ? error.message : error).slice(
    0,
    4000,
  );
  await execute(
    Project.updateOne(
      {
        _id: projectId,
        "storage.state": "migrating",
        "archiveMigration.id": migrationId,
      },
      {
        $set: {
          "archiveMigration.lastError": { at: now, phase, message },
          "archiveMigration.failedAt": now,
          "archiveMigration.updatedAt": now,
        },
      },
    ),
  ).catch(() => {});
};

module.exports = {
  ensureValidState,
  fencedUpdate,
  loadProject,
  lockProject,
  recordMigrationError,
  transitionPhase,
};
