jest.mock("../../../lib/s3-archive/preflight", () => ({
  apiAppearsStopped: jest.fn(),
  collectHardBlockers: jest.fn(),
  collectProjectDatabase: jest.fn(),
  overlayDatabase: jest.fn(),
  requireKomondorUser: jest.fn(),
  validateAws: jest.fn(),
  validateProjectRoot: jest.fn(),
}));

jest.mock("../../../lib/s3-archive/inventory", () => ({
  compareTreeToManifest: jest.fn(),
  createInventory: jest.fn(),
  walkTree: jest.fn(),
}));

jest.mock("../../../lib/s3-archive/state", () => ({
  ensureValidState: jest.fn(),
  fencedUpdate: jest.fn(),
  loadProject: jest.fn(),
  lockProject: jest.fn(),
  recordMigrationError: jest.fn(),
  transitionPhase: jest.fn(),
}));

jest.mock("../../../lib/s3-archive/upload", () => ({
  copyManifestEntries: jest.fn(),
  isOwned: jest.fn(),
  metadataValue: jest.fn(),
  verifyManifestObjects: jest.fn(),
}));

const inventory = require("../../../lib/s3-archive/inventory");
const preflight = require("../../../lib/s3-archive/preflight");
const state = require("../../../lib/s3-archive/state");
const upload = require("../../../lib/s3-archive/upload");
const { crc64Nvme } = require("../../../lib/utils/crc64nvme");
const {
  serializeManifest,
  sha256Bytes,
} = require("../../../lib/s3-archive/manifest");
const { resolveStorageState } = require("../../../lib/storage-state");
const {
  exclusionsFromOptions,
  parseArgs,
  runCli,
} = require("../../../lib/s3-archive/cli");

const PROJECT_ID = "0123456789abcdef01234567";
const MIGRATION_ID = "migration-20260907";
const NOW = Date.parse("2026-09-07T12:00:00.000Z");

const emptyDatabase = () => ({
  samples: [],
  runs: [],
  unfinishedJobs: [],
  reads: [],
  additionalFiles: [],
});

const baseConfig = {
  bucket: "archive-bucket",
  basePrefix: "komondor",
  datastoreRoot: "/srv/komondor/datastore",
  readyUrl: "http://127.0.0.1:3000/ready",
  dataStorageClass: "DEEP_ARCHIVE",
  controlStorageClass: "STANDARD",
  dataPrefixFor: (relative) => `komondor/${relative}`,
  controlPrefixFor: (projectId, migrationId) =>
    `komondor/_control/projects/${projectId}/${migrationId}`,
  controlProjectPrefixFor: (projectId) =>
    `komondor/_control/projects/${projectId}`,
};

const makeAws = () => ({
  hasObjectsAtOrBelow: jest.fn().mockResolvedValue(false),
  listMultipartUploads: jest.fn().mockResolvedValue([]),
});

const makeDependencies = (overrides = {}) => ({
  aws: makeAws(),
  config: baseConfig,
  models: { Project: {}, User: {} },
  newId: () => MIGRATION_ID,
  now: () => NOW,
  stdout: jest.fn(),
  stderr: jest.fn(),
  toolVersion: "test-version",
  ...overrides,
});

const setAtPath = (target, dottedPath, value) => {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
};

const deleteAtPath = (target, dottedPath) => {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") return;
    cursor = cursor[part];
  }
  delete cursor[parts[parts.length - 1]];
};

const applyMongoUpdate = (project, update) => {
  const next = structuredClone(project);
  for (const [field, value] of Object.entries(update.$set || {})) {
    setAtPath(next, field, value);
  }
  for (const field of Object.keys(update.$unset || {})) {
    deleteAtPath(next, field);
  }
  return next;
};

describe("archive CLI argument parsing", () => {
  test("parses operator flags and keeps repeated exclusions paired in order", () => {
    expect(
      parseArgs([
        "copy",
        "--project-id",
        PROJECT_ID,
        "--moved-by",
        "alice",
        "--execute",
        "--acknowledge-known-anomalies",
        "--exclude-entry",
        "one.fastq",
        "--exclude-reason",
        "unreadable",
        "--exclude-entry",
        "two.fastq",
        "--exclude-reason",
        "damaged",
      ]),
    ).toEqual({
      command: "copy",
      options: {
        "project-id": PROJECT_ID,
        "moved-by": "alice",
        execute: true,
        "acknowledge-known-anomalies": true,
        "exclude-entry": ["one.fastq", "two.fastq"],
        "exclude-reason": ["unreadable", "damaged"],
      },
    });
  });

  test.each([
    [[], /Unknown command/],
    [["launch", "--project-id", PROJECT_ID], /Unknown command/],
    [["plan"], /--project-id is required/],
    [["plan", "--project-id", "not-an-object-id"], /24-hex/],
    [["plan", "--project-id", PROJECT_ID, "--surprise"], /Unknown option/],
    [["plan", "--project-id", PROJECT_ID, "stray"], /Unexpected argument/],
    [["plan", "--project-id"], /requires a value/],
  ])("refuses malformed argv %#", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  test("refuses a duplicate single-value option", () => {
    expect(() =>
      parseArgs([
        "plan",
        "--project-id",
        PROJECT_ID,
        "--project-id",
        PROJECT_ID,
      ]),
    ).toThrow(/only once/);
  });
});

describe("archive exclusion validation", () => {
  test("normalises exact paths and trims their audit reasons", () => {
    const exclusions = exclusionsFromOptions(
      {
        "exclude-entry": ["/sample/reads.fastq", "cafe\u0301/failed.bin"],
        "exclude-reason": ["  permission failure  ", "I/O failure"],
      },
      "alice",
    );

    expect([...exclusions]).toEqual([
      ["sample/reads.fastq", { by: "alice", reason: "permission failure" }],
      ["caf\u00e9/failed.bin", { by: "alice", reason: "I/O failure" }],
    ]);
  });

  test("requires one non-empty reason for every entry", () => {
    expect(() =>
      exclusionsFromOptions(
        { "exclude-entry": ["one", "two"], "exclude-reason": ["reason"] },
        "alice",
      ),
    ).toThrow(/must have one --exclude-reason/);
    expect(() =>
      exclusionsFromOptions(
        { "exclude-entry": ["one"], "exclude-reason": ["   "] },
        "alice",
      ),
    ).toThrow(/Empty reason/);
    expect(() =>
      exclusionsFromOptions(
        { "exclude-entry": ["one"], "exclude-reason": ["bad\nreason"] },
        "alice",
      ),
    ).toThrow(/Control characters/);
  });

  test.each(["../outside", "sample/../outside", "sample//reads", "./reads"])(
    "refuses unsafe exclusion path %p",
    (entry) => {
      expect(() =>
        exclusionsFromOptions(
          { "exclude-entry": [entry], "exclude-reason": ["reason"] },
          "alice",
        ),
      ).toThrow(/Unsafe --exclude-entry/);
    },
  );

  test("refuses duplicate paths after normalisation", () => {
    expect(() =>
      exclusionsFromOptions(
        {
          "exclude-entry": ["sample/reads.fastq", "/sample/reads.fastq"],
          "exclude-reason": ["first", "second"],
        },
        "alice",
      ),
    ).toThrow(/Duplicate --exclude-entry/);
  });
});

describe("archive CLI operator flow", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    preflight.validateAws.mockResolvedValue({
      osUser: "hpc-operator",
      arn: "arn:aws:iam::123456789012:user/archive",
      accountId: "123456789012",
    });
    preflight.validateProjectRoot.mockResolvedValue({
      sourceRoot: "/srv/komondor/datastore/group/project",
      sourceRelativeRoot: "group/project",
      exists: true,
    });
    preflight.collectProjectDatabase.mockResolvedValue(emptyDatabase());
    preflight.collectHardBlockers.mockReturnValue([]);
    preflight.overlayDatabase.mockReturnValue({
      anomalies: [],
      dbExpectedMissing: [],
    });
    preflight.requireKomondorUser.mockResolvedValue({ username: "alice" });
    preflight.apiAppearsStopped.mockResolvedValue(undefined);
    inventory.walkTree.mockResolvedValue({
      entries: [],
      dirCount: 1,
      entryCount: 0,
    });
    state.ensureValidState.mockImplementation((project) =>
      resolveStorageState(project),
    );
  });

  test("dry-run lock completes every safety check without changing the project", async () => {
    const project = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
    };
    state.loadProject.mockResolvedValue(project);
    const dependencies = makeDependencies();

    const code = await runCli(
      ["lock", "--project-id", PROJECT_ID, "--moved-by", "alice"],
      dependencies,
    );

    expect(code).toBe(0);
    expect(preflight.validateAws).toHaveBeenCalledWith(
      dependencies.aws,
      baseConfig,
    );
    expect(preflight.requireKomondorUser).toHaveBeenCalledWith(
      dependencies.models.User,
      "alice",
    );
    expect(preflight.apiAppearsStopped).toHaveBeenCalledWith(
      baseConfig.readyUrl,
    );
    expect(preflight.validateProjectRoot).toHaveBeenCalledWith(
      baseConfig,
      project,
      { requireExists: true },
    );
    expect(dependencies.aws.hasObjectsAtOrBelow.mock.calls).toEqual([
      ["komondor/group/project"],
      [`komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}`],
    ]);
    expect(state.lockProject).not.toHaveBeenCalled();

    const result = JSON.parse(dependencies.stdout.mock.calls[0][0]);
    expect(result).toMatchObject({
      command: "lock",
      execute: false,
      sourceRoot: "/srv/komondor/datastore/group/project",
      destination: "s3://archive-bucket/komondor/group/project",
      would: "lock project storage",
    });
    expect(result.identity).toMatchObject({
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
      osUser: "hpc-operator",
      awsAccountId: "123456789012",
    });
    expect(dependencies.stderr).not.toHaveBeenCalled();
  });

  test("executes a locked migration through source sealing, copy, verification and the final fence", async () => {
    const sourceRoot = "/srv/komondor/datastore/group/project";
    const initialProject = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/group/project",
      },
      archiveMigration: {
        id: MIGRATION_ID,
        phase: "locked",
        movedBy: "alice",
        osUser: "hpc-operator",
        awsIdentityArn: "arn:aws:iam::123456789012:user/archive",
        awsAccountId: "123456789012",
        startedAt: new Date(NOW - 60_000),
        updatedAt: new Date(NOW - 60_000),
        sourceRoot,
        sourceRelativeRoot: "group/project",
        resumeCount: 0,
        restartedFrom: [],
        manifests: {},
      },
    };
    const fileEntry = {
      relPath: "sample/reads.fastq",
      type: "file",
      disposition: "copy",
      size: 4,
      mode: 0o100644,
      uid: 1000,
      gid: 1000,
      mtimeMs: NOW - 120_000,
      ctimeMs: NOW - 120_000,
      dev: 1,
      ino: 2,
      nlink: 1,
      sha256: "sha256-of-entry",
      crc64nvme: "crc64-of-entry",
    };
    inventory.createInventory.mockResolvedValue({
      entries: [fileEntry],
      hpcSnapshot: { dirCount: 2, entryCount: 1 },
    });
    inventory.compareTreeToManifest.mockResolvedValue({
      matches: true,
      differences: [],
      snapshot: { dirCount: 2, entryCount: 1 },
    });
    upload.copyManifestEntries.mockResolvedValue([
      { relPath: fileEntry.relPath, action: "uploaded" },
    ]);
    upload.verifyManifestObjects.mockResolvedValue({
      verified: true,
      entries: [
        {
          relPath: fileEntry.relPath,
          s3Key: "komondor/group/project/sample/reads.fastq",
          verified: true,
        },
      ],
      keySet: { matches: true, missingKeys: [], extraKeys: [] },
    });

    const controls = new Map();
    const aws = {
      ...makeAws(),
      headObject: jest.fn(async (key) => {
        const bytes = controls.get(key);
        return bytes
          ? {
              ContentLength: bytes.length,
              ChecksumCRC64NVME: crc64Nvme(bytes),
              ChecksumType: "FULL_OBJECT",
            }
          : null;
      }),
      putControlObject: jest.fn(async (key, bytes) => {
        controls.set(key, Buffer.from(bytes));
        return {};
      }),
      getObjectBuffer: jest.fn(async (key) => Buffer.from(controls.get(key))),
    };
    const Project = { updateOne: jest.fn().mockResolvedValue({}) };
    const dependencies = makeDependencies({
      aws,
      models: { Project, User: {} },
    });
    state.loadProject.mockResolvedValue(initialProject);

    let currentProject = structuredClone(initialProject);
    state.transitionPhase.mockImplementation(async (_Project, transition) => {
      expect(currentProject.archiveMigration.phase).toBe(
        transition.expectedPhase,
      );
      currentProject = applyMongoUpdate(currentProject, {
        $set: transition.set,
        $unset: transition.unset,
      });
      return currentProject;
    });
    state.fencedUpdate.mockImplementation(async (_Project, _filter, update) => {
      currentProject = applyMongoUpdate(currentProject, update);
      return currentProject;
    });

    const code = await runCli(
      ["copy", "--project-id", PROJECT_ID, "--moved-by", "alice", "--execute"],
      dependencies,
    );

    expect(code).toBe(0);
    expect(
      state.transitionPhase.mock.calls.map((call) => call[1].expectedPhase),
    ).toEqual(["locked", "inventoried", "source_sealed", "copying"]);
    expect(upload.copyManifestEntries).toHaveBeenCalledTimes(1);
    expect(upload.verifyManifestObjects).toHaveBeenCalledTimes(1);
    expect(inventory.compareTreeToManifest).toHaveBeenCalledWith(
      sourceRoot,
      expect.arrayContaining([
        expect.objectContaining({
          relPath: fileEntry.relPath,
          disposition: "copy",
          s3Key: "komondor/group/project/sample/reads.fastq",
        }),
      ]),
    );

    const sourceKey = `komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}/source-manifest.v1.json`;
    const verificationKey = `komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}/verification-report.v1.json`;
    expect([...controls.keys()]).toEqual([sourceKey, verificationKey]);
    expect(JSON.parse(controls.get(sourceKey).toString("utf8"))).toMatchObject({
      kind: "source",
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
      dataPrefix: "s3://archive-bucket/komondor/group/project",
    });
    expect(
      JSON.parse(controls.get(verificationKey).toString("utf8")),
    ).toMatchObject({
      kind: "verification",
      verified: true,
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
    });
    expect(aws.putControlObject.mock.invocationCallOrder[0]).toBeLessThan(
      upload.copyManifestEntries.mock.invocationCallOrder[0],
    );

    const sourceDigest = sha256Bytes(controls.get(sourceKey));
    expect(state.fencedUpdate).toHaveBeenCalledWith(
      Project,
      expect.objectContaining({
        _id: PROJECT_ID,
        "storage.state": "migrating",
        "archiveMigration.id": MIGRATION_ID,
        "archiveMigration.phase": "copied",
        "archiveMigration.manifests.sourceSha256": sourceDigest,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          "storage.state": "aws_pending_hpc_deletion",
          "archiveMigration.phase": "verified",
          "archiveMigration.manifests.verificationS3Uri": `s3://archive-bucket/${verificationKey}`,
        }),
      }),
      "Verification succeeded but the final database fence failed",
    );
    expect(JSON.parse(dependencies.stdout.mock.calls.at(-1)[0])).toMatchObject({
      command: "copy",
      state: "aws_pending_hpc_deletion",
      phase: "verified",
    });
    expect(state.recordMigrationError).not.toHaveBeenCalled();
    expect(dependencies.stderr).not.toHaveBeenCalled();
  });

  test("executed pre-copy abort sends one exact compare-and-set update", async () => {
    const project = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/group/project",
      },
      archiveMigration: {
        id: MIGRATION_ID,
        phase: "locked",
        sourceRoot: "/srv/komondor/datastore/group/project",
        sourceRelativeRoot: "group/project",
        manifests: {},
      },
    };
    state.loadProject.mockResolvedValue(project);
    state.fencedUpdate.mockResolvedValue({
      ...project,
      storage: { state: "hpc" },
      archiveMigration: { ...project.archiveMigration, phase: "aborted" },
    });
    const dependencies = makeDependencies();

    const code = await runCli(
      [
        "abort-before-copy",
        "--project-id",
        PROJECT_ID,
        "--migration-id",
        MIGRATION_ID,
        "--aborted-by",
        "alice",
        "--execute",
      ],
      dependencies,
    );

    expect(code).toBe(0);
    expect(state.fencedUpdate).toHaveBeenCalledTimes(1);
    expect(state.fencedUpdate).toHaveBeenCalledWith(
      dependencies.models.Project,
      {
        _id: PROJECT_ID,
        "storage.state": "migrating",
        "archiveMigration.id": MIGRATION_ID,
        "archiveMigration.phase": { $in: ["locked", "inventoried"] },
        "archiveMigration.manifests.sourceSha256": { $exists: false },
      },
      {
        $set: {
          storage: { state: "hpc" },
          "archiveMigration.phase": "aborted",
          "archiveMigration.abortedBy": "alice",
          "archiveMigration.abortedAt": new Date(NOW),
          "archiveMigration.updatedAt": new Date(NOW),
        },
      },
      "Abort fence failed",
    );
    expect(dependencies.aws.hasObjectsAtOrBelow.mock.calls).toEqual([
      ["komondor/group/project"],
      [`komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}`],
    ]);
    expect(dependencies.aws.listMultipartUploads).toHaveBeenCalledWith(
      "komondor/group/project/",
    );
    expect(JSON.parse(dependencies.stdout.mock.calls[0][0])).toMatchObject({
      command: "abort-before-copy",
      state: "hpc",
      phase: "aborted",
      migrationId: MIGRATION_ID,
    });
  });

  test("status shows the way out of an orphaned source manifest in phase inventoried", async () => {
    const controlPrefix = `komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}`;
    const orphanKey = `${controlPrefix}/source-manifest.v1.json`;
    const baseProject = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/group/project",
      },
      archiveMigration: {
        id: MIGRATION_ID,
        phase: "inventoried",
        movedBy: "alice",
        startedAt: NOW,
        updatedAt: NOW,
        sourceRoot: "/srv/komondor/datastore/group/project",
        sourceRelativeRoot: "group/project",
      },
    };
    const aws = {
      ...makeAws(),
      headObject: jest.fn(async (key) =>
        key === orphanKey ? { ContentLength: 10 } : null,
      ),
      listObjectsAtOrBelow: jest.fn(async (prefix) =>
        prefix === controlPrefix ? [{ Key: orphanKey, Size: 10 }] : [],
      ),
    };

    // The PUT succeeded and the fence failed, but the source is unchanged:
    // a re-run of copy adopts the object, so no cleanup is offered.
    state.loadProject.mockResolvedValue(baseProject);
    let dependencies = makeDependencies({ aws });
    expect(
      await runCli(
        ["status", "--project-id", PROJECT_ID, "--json"],
        dependencies,
      ),
    ).toBe(0);
    let result = JSON.parse(dependencies.stdout.mock.calls[0][0]);
    expect(result.sourceManifest).toEqual({
      exists: true,
      digestMatches: false,
    });
    expect(result.controlObjects).toEqual([{ key: orphanKey, size: 10 }]);
    expect(result.cleanupCommands).toEqual([]);

    // The source changed before the re-run, so copy refused to adopt the
    // orphan and recorded the error. Nothing else can proceed until the
    // control object is moved aside; status must print that command.
    state.loadProject.mockResolvedValue({
      ...baseProject,
      archiveMigration: {
        ...baseProject.archiveMigration,
        lastError: {
          at: NOW,
          phase: "inventoried",
          message: "Control object already exists with different content",
        },
      },
    });
    dependencies = makeDependencies({ aws });
    expect(
      await runCli(
        ["status", "--project-id", PROJECT_ID, "--json"],
        dependencies,
      ),
    ).toBe(0);
    result = JSON.parse(dependencies.stdout.mock.calls[0][0]);
    expect(result.cleanupCommands).toEqual([
      `aws s3 mv 's3://archive-bucket/${orphanKey}' 's3://archive-bucket/komondor/_control/projects/${PROJECT_ID}/abandoned/${MIGRATION_ID}/source-manifest.v1.json'`,
    ]);
    expect(result.cleanupWarning).toMatch(/abandoned\//);
    expect(dependencies.stderr).not.toHaveBeenCalled();
  });

  test("refuses post-lock archive-root drift before touching the destination", async () => {
    const project = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://old-archive-bucket/old-prefix/data/group/project",
      },
      archiveMigration: {
        id: MIGRATION_ID,
        phase: "locked",
        movedBy: "alice",
        sourceRoot: "/srv/komondor/datastore/group/project",
        sourceRelativeRoot: "group/project",
        manifests: {},
      },
    };
    state.loadProject.mockResolvedValue(project);
    const dependencies = makeDependencies();

    const code = await runCli(
      ["copy", "--project-id", PROJECT_ID, "--moved-by", "alice"],
      dependencies,
    );

    expect(code).toBe(1);
    expect(dependencies.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/AWS_ARCHIVE_S3_ROOT no longer matches/),
    );
    expect(preflight.collectProjectDatabase).not.toHaveBeenCalled();
    expect(inventory.createInventory).not.toHaveBeenCalled();
    expect(upload.copyManifestEntries).not.toHaveBeenCalled();
    expect(dependencies.aws.hasObjectsAtOrBelow).not.toHaveBeenCalled();
    expect(dependencies.aws.listMultipartUploads).not.toHaveBeenCalled();
  });

  test("resume refuses a downloaded source manifest whose digest has changed", async () => {
    const sourceRoot = "/srv/komondor/datastore/group/project";
    const sourceBytes = serializeManifest({
      manifestVersion: 1,
      kind: "source",
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
      sourceRoot,
      sourceRelativeRoot: "group/project",
      dataPrefix: "s3://archive-bucket/komondor/group/project",
      dataKeyPrefix: "komondor/group/project",
      entries: [],
    });
    const project = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/group/project",
      },
      archiveMigration: {
        id: MIGRATION_ID,
        phase: "source_sealed",
        movedBy: "alice",
        sourceRoot,
        sourceRelativeRoot: "group/project",
        lastError: { message: "previous upload failure" },
        manifests: { sourceSha256: "0".repeat(64) },
      },
    };
    state.loadProject.mockResolvedValue(project);
    const aws = {
      ...makeAws(),
      getObjectBuffer: jest.fn().mockResolvedValue(sourceBytes),
    };
    const dependencies = makeDependencies({ aws });

    const code = await runCli(
      [
        "resume",
        "--project-id",
        PROJECT_ID,
        "--migration-id",
        MIGRATION_ID,
        "--resumed-by",
        "alice",
        "--execute",
      ],
      dependencies,
    );

    expect(code).toBe(1);
    expect(aws.getObjectBuffer).toHaveBeenCalledWith(
      `komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}/source-manifest.v1.json`,
    );
    expect(dependencies.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/Control manifest SHA-256 mismatch/),
    );
    expect(state.fencedUpdate).not.toHaveBeenCalled();
    expect(upload.copyManifestEntries).not.toHaveBeenCalled();
  });

  test("turns an ordinary AWS preflight failure into a configuration exit", async () => {
    const dependencies = makeDependencies();
    preflight.validateAws.mockRejectedValue(new Error("credentials expired"));

    const code = await runCli(
      ["status", "--project-id", PROJECT_ID],
      dependencies,
    );

    expect(code).toBe(2);
    expect(state.loadProject).not.toHaveBeenCalled();
    expect(dependencies.stderr).toHaveBeenCalledWith(
      "AWS archive preflight failed: credentials expired\n",
    );
  });
});

describe("database migration fence", () => {
  test("raises the mutation exit code when compare-and-set matches no project", async () => {
    const { fencedUpdate } = jest.requireActual(
      "../../../lib/s3-archive/state",
    );
    const exec = jest.fn().mockResolvedValue(null);
    const select = jest.fn().mockReturnValue({ exec });
    const Project = {
      findOneAndUpdate: jest.fn().mockReturnValue({ select }),
    };
    const filter = { _id: PROJECT_ID, "storage.state": "migrating" };
    const update = { $set: { "archiveMigration.phase": "copying" } };

    await expect(
      fencedUpdate(Project, filter, update, "Copy fence failed"),
    ).rejects.toMatchObject({
      name: "ArchiveMutationError",
      message: "Copy fence failed",
      exitCode: 3,
    });
    expect(Project.findOneAndUpdate).toHaveBeenCalledWith(filter, update, {
      new: true,
    });
    expect(select).toHaveBeenCalledWith("+archiveMigration");
  });
});

// Decision record §7.1. A copy that dies part-way through a file must record
// the failure, leave the project short of verification and offer the operator
// no deletion command; resume must then carry the same sealed migration
// through to the verified state that does authorise deletion.
describe("archive CLI interrupted copy and resume", () => {
  const sourceRoot = "/srv/komondor/datastore/group/project";
  const dataKeyPrefix = "komondor/group/project";
  const controlPrefix = `komondor/_control/projects/${PROJECT_ID}/${MIGRATION_ID}`;
  const sourceKey = `${controlPrefix}/source-manifest.v1.json`;
  const verificationKey = `${controlPrefix}/verification-report.v1.json`;
  const copyEntry = (relPath, size) => ({
    relPath,
    type: "file",
    disposition: "copy",
    s3Key: `${dataKeyPrefix}/${relPath}`,
    size,
    sha256: `sha256-of-${relPath}`,
    crc64nvme: `crc64-of-${relPath}`,
  });
  const entryA = copyEntry("a/reads.fastq", 1024);
  const entryB = copyEntry("b/reads.fastq", 2048);
  const sourceBytes = serializeManifest({
    manifestVersion: 1,
    kind: "source",
    projectId: PROJECT_ID,
    migrationId: MIGRATION_ID,
    sourceRoot,
    sourceRelativeRoot: "group/project",
    dataPrefix: "s3://archive-bucket/komondor/group/project",
    dataKeyPrefix,
    dataStorageClass: "DEEP_ARCHIVE",
    entries: [entryA, entryB],
  });
  const sourceDigest = sha256Bytes(sourceBytes);
  const expiredToken = () =>
    new Error(
      `AWS upload failed for ${entryB.s3Key} (exit 1): An error occurred (ExpiredToken) when calling the UploadPart operation: The provided token has expired.`,
    );

  let controls;
  let currentProject;
  let Project;
  let aws;

  const projectAt = (phase, migration = {}) => ({
    _id: PROJECT_ID,
    name: "Project One",
    path: "group/project",
    storage: {
      state: "migrating",
      s3Uri: "s3://archive-bucket/komondor/group/project",
    },
    archiveMigration: {
      id: MIGRATION_ID,
      phase,
      movedBy: "alice",
      sourceRoot,
      sourceRelativeRoot: "group/project",
      resumeCount: 0,
      restartedFrom: [],
      manifests: {
        sourceSha256: sourceDigest,
        sourceS3Uri: `s3://archive-bucket/${sourceKey}`,
        fileCount: 2,
        totalBytes: entryA.size + entryB.size,
      },
      ...migration,
    },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    preflight.validateAws.mockResolvedValue({
      osUser: "hpc-operator",
      arn: "arn:aws:iam::123456789012:user/archive",
      accountId: "123456789012",
    });
    preflight.validateProjectRoot.mockResolvedValue({
      sourceRoot,
      sourceRelativeRoot: "group/project",
      exists: true,
    });
    preflight.collectProjectDatabase.mockResolvedValue(emptyDatabase());
    preflight.collectHardBlockers.mockReturnValue([]);
    preflight.requireKomondorUser.mockResolvedValue({ username: "alice" });
    inventory.compareTreeToManifest.mockResolvedValue({
      matches: true,
      differences: [],
      snapshot: { dirCount: 3, entryCount: 2 },
    });
    state.ensureValidState.mockImplementation((project) =>
      resolveStorageState(project),
    );
    state.loadProject.mockImplementation(async () => currentProject);
    state.transitionPhase.mockImplementation(async (_Project, transition) => {
      expect(currentProject.archiveMigration.phase).toBe(
        transition.expectedPhase,
      );
      currentProject = applyMongoUpdate(currentProject, {
        $set: transition.set,
        $unset: transition.unset,
      });
      return currentProject;
    });
    state.fencedUpdate.mockImplementation(async (_Project, _filter, update) => {
      currentProject = applyMongoUpdate(currentProject, update);
      return currentProject;
    });
    state.recordMigrationError.mockImplementation(
      async (_Project, { phase, error }) => {
        currentProject = applyMongoUpdate(currentProject, {
          $set: {
            "archiveMigration.lastError": { phase, message: error.message },
            "archiveMigration.failedAt": new Date(NOW),
          },
        });
      },
    );

    controls = new Map([[sourceKey, sourceBytes]]);
    Project = { updateOne: jest.fn().mockResolvedValue({}) };
    aws = {
      ...makeAws(),
      headObject: jest.fn(async (key) => {
        const bytes = controls.get(key);
        return bytes
          ? {
              ContentLength: bytes.length,
              ChecksumCRC64NVME: crc64Nvme(bytes),
              ChecksumType: "FULL_OBJECT",
            }
          : null;
      }),
      getObjectBuffer: jest.fn(async (key) => {
        if (!controls.has(key)) throw new Error(`No such object: ${key}`);
        return Buffer.from(controls.get(key));
      }),
      putControlObject: jest.fn(async (key, bytes) => {
        controls.set(key, Buffer.from(bytes));
        return {};
      }),
    };
  });

  const dependencies = () =>
    makeDependencies({ aws, models: { Project, User: {} } });

  test("a copy that dies mid-file records the error and authorises no deletion", async () => {
    currentProject = projectAt("source_sealed");
    upload.copyManifestEntries.mockRejectedValue(expiredToken());

    const copying = dependencies();
    expect(
      await runCli(
        [
          "copy",
          "--project-id",
          PROJECT_ID,
          "--moved-by",
          "alice",
          "--execute",
        ],
        copying,
      ),
    ).toBe(3);
    expect(copying.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/ExpiredToken/),
    );

    expect(state.recordMigrationError).toHaveBeenCalledTimes(1);
    expect(state.recordMigrationError).toHaveBeenCalledWith(
      Project,
      expect.objectContaining({
        projectId: PROJECT_ID,
        migrationId: MIGRATION_ID,
        phase: "copying",
      }),
    );
    // Nothing verified the copy, so no verification report was sealed and the
    // project never left the migrating state.
    expect(upload.verifyManifestObjects).not.toHaveBeenCalled();
    expect([...controls.keys()]).toEqual([sourceKey]);
    expect(state.fencedUpdate).not.toHaveBeenCalled();
    expect(resolveStorageState(currentProject).state).toBe("migrating");
    expect(currentProject.archiveMigration).toMatchObject({
      phase: "copying",
      lastError: { phase: "copying" },
    });
    expect(currentProject.storage.s3VerifiedAt).toBeUndefined();

    // A plain re-run must not quietly copy again around the recorded error.
    const rerun = dependencies();
    expect(
      await runCli(
        [
          "copy",
          "--project-id",
          PROJECT_ID,
          "--moved-by",
          "alice",
          "--execute",
        ],
        rerun,
      ),
    ).toBe(1);
    expect(rerun.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/recorded error; use resume/),
    );
    expect(upload.copyManifestEntries).toHaveBeenCalledTimes(1);

    // And the operator cannot obtain a deletion command for the HPC copy.
    const deletion = dependencies();
    expect(
      await runCli(["deletion-command", "--project-id", PROJECT_ID], deletion),
    ).toBe(1);
    expect(deletion.stderr).toHaveBeenCalledWith(
      expect.stringMatching(
        /not valid for storage state migrating; expected aws_pending_hpc_deletion/,
      ),
    );
    expect(deletion.stdout).not.toHaveBeenCalled();
  });

  test("resume clears the error, keeps the sealed manifest and reaches verified", async () => {
    currentProject = projectAt("copying", {
      lastError: { phase: "copying", message: "ExpiredToken" },
      failedAt: new Date(NOW - 60_000),
    });
    upload.copyManifestEntries.mockResolvedValue([
      { relPath: entryA.relPath, action: "verified-existing" },
      { relPath: entryB.relPath, action: "uploaded" },
    ]);
    upload.verifyManifestObjects.mockResolvedValue({
      verified: true,
      entries: [entryA, entryB].map((entry) => ({
        relPath: entry.relPath,
        s3Key: entry.s3Key,
        verified: true,
        contentLength: entry.size,
      })),
      keySet: { matches: true, missingKeys: [], extraKeys: [] },
      storageClass: {
        expected: "DEEP_ARCHIVE",
        matches: true,
        unexpected: [],
      },
    });

    const resuming = dependencies();
    expect(
      await runCli(
        [
          "resume",
          "--project-id",
          PROJECT_ID,
          "--migration-id",
          MIGRATION_ID,
          "--resumed-by",
          "alice",
          "--execute",
        ],
        resuming,
      ),
    ).toBe(0);
    expect(resuming.stderr).not.toHaveBeenCalled();

    // The resume fence clears the recorded failure against the sealed digest.
    expect(state.fencedUpdate.mock.calls[0][1]).toEqual({
      _id: PROJECT_ID,
      "storage.state": "migrating",
      "archiveMigration.id": MIGRATION_ID,
      "archiveMigration.phase": "copying",
      "archiveMigration.manifests.sourceSha256": sourceDigest,
    });
    expect(state.fencedUpdate.mock.calls[0][2]).toMatchObject({
      $inc: { "archiveMigration.resumeCount": 1 },
      $unset: {
        "archiveMigration.lastError": "",
        "archiveMigration.failedAt": "",
      },
    });

    // The copy continues from the manifest sealed before the failure.
    expect(inventory.createInventory).not.toHaveBeenCalled();
    expect(aws.putControlObject).not.toHaveBeenCalledWith(
      sourceKey,
      expect.anything(),
      expect.anything(),
    );
    expect(upload.copyManifestEntries).toHaveBeenCalledWith(
      aws,
      sourceRoot,
      expect.objectContaining({ dataKeyPrefix, entries: [entryA, entryB] }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    const report = JSON.parse(controls.get(verificationKey).toString("utf8"));
    expect(report).toMatchObject({
      kind: "verification",
      verified: true,
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
      sourceManifestSha256: sourceDigest,
    });
    expect(report.entries.map((entry) => entry.relPath)).toEqual([
      entryA.relPath,
      entryB.relPath,
    ]);
    expect(currentProject.archiveMigration.lastError).toBeUndefined();
    expect(currentProject.archiveMigration.failedAt).toBeUndefined();
    expect(resolveStorageState(currentProject).state).toBe(
      "aws_pending_hpc_deletion",
    );
    expect(currentProject.archiveMigration.phase).toBe("verified");
    expect(JSON.parse(resuming.stdout.mock.calls.at(-1)[0])).toMatchObject({
      command: "copy",
      state: "aws_pending_hpc_deletion",
      phase: "verified",
    });

    // Only now does the archive authorise removing the HPC copy.
    const deletion = dependencies();
    expect(
      await runCli(["deletion-command", "--project-id", PROJECT_ID], deletion),
    ).toBe(0);
    expect(deletion.stdout).toHaveBeenCalledWith(`rm -rf -- '${sourceRoot}'\n`);
  });

  test("a safe storage class mismatch warns before copy completion and deletion", async () => {
    // Standard remains durable enough; report this safe mismatch prominently.
    currentProject = projectAt("copied");
    upload.verifyManifestObjects.mockResolvedValue({
      verified: true,
      entries: [entryA, entryB].map((entry) => ({
        relPath: entry.relPath,
        s3Key: entry.s3Key,
        verified: true,
        storageClass:
          entry.relPath === entryB.relPath ? "STANDARD" : "DEEP_ARCHIVE",
      })),
      keySet: { matches: true, missingKeys: [], extraKeys: [] },
      storageClass: {
        expected: "DEEP_ARCHIVE",
        matches: false,
        unexpected: [
          {
            relPath: entryB.relPath,
            s3Key: entryB.s3Key,
            storageClass: "STANDARD",
          },
        ],
      },
    });

    const verifying = dependencies();
    expect(
      await runCli(
        [
          "copy",
          "--project-id",
          PROJECT_ID,
          "--moved-by",
          "alice",
          "--execute",
        ],
        verifying,
      ),
    ).toBe(0);
    expect(verifying.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/WARNING:.*storage classes/),
    );

    const report = JSON.parse(controls.get(verificationKey).toString("utf8"));
    expect(report.verified).toBe(true);
    expect(report.storageClass).toMatchObject({
      expected: "DEEP_ARCHIVE",
      matches: false,
      unexpected: [{ relPath: entryB.relPath, storageClass: "STANDARD" }],
    });
    expect(resolveStorageState(currentProject).state).toBe(
      "aws_pending_hpc_deletion",
    );

    const deletion = dependencies();
    expect(
      await runCli(["deletion-command", "--project-id", PROJECT_ID], deletion),
    ).toBe(0);
    expect(deletion.stdout).toHaveBeenCalledWith(`rm -rf -- '${sourceRoot}'\n`);
    expect(deletion.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/WARNING:.*storage classes/),
    );
  });
  test.each(["objects", "local"])(
    "refuses sealing verification when %s fail",
    async (failure) => {
      currentProject = projectAt("copied");
      upload.verifyManifestObjects.mockResolvedValue({
        verified: failure !== "objects",
        entries: [],
        keySet: { matches: true },
      });
      inventory.compareTreeToManifest.mockResolvedValue({
        matches: failure !== "local",
        differences: ["drift"],
      });
      const context = dependencies();
      expect(
        await runCli(
          [
            "copy",
            "--project-id",
            PROJECT_ID,
            "--moved-by",
            "alice",
            "--execute",
          ],
          context,
        ),
      ).toBe(3);
      expect(currentProject.storage.state).toBe("migrating");
      expect(currentProject.archiveMigration.phase).toBe("copied");
      expect(controls.has(verificationKey)).toBe(false);
      expect(
        [...controls.values()].some(
          (bytes) => JSON.parse(bytes).verified === false,
        ),
      ).toBe(true);
      expect(state.fencedUpdate).not.toHaveBeenCalled();
    },
  );

  test.each(["objects", "local"])(
    "withholds deletion after verified %s drift",
    async (failure) => {
      currentProject = projectAt("copied");
      upload.verifyManifestObjects.mockResolvedValue({
        verified: true,
        entries: [],
        keySet: { matches: true },
      });
      expect(
        await runCli(
          [
            "copy",
            "--project-id",
            PROJECT_ID,
            "--moved-by",
            "alice",
            "--execute",
          ],
          dependencies(),
        ),
      ).toBe(0);
      expect(currentProject.storage.state).toBe("aws_pending_hpc_deletion");
      if (failure === "objects")
        upload.verifyManifestObjects.mockResolvedValue({ verified: false });
      else
        inventory.compareTreeToManifest.mockResolvedValue({
          matches: false,
          differences: ["added file"],
        });
      const context = dependencies();
      expect(
        await runCli(["deletion-command", "--project-id", PROJECT_ID], context),
      ).toBe(1);
      expect(context.stdout).not.toHaveBeenCalled();
      expect(context.stderr).toHaveBeenCalledWith(
        expect.stringMatching(
          failure === "objects"
            ? /S3 objects no longer match/
            : /HPC tree drifted/,
        ),
      );
    },
  );
});
