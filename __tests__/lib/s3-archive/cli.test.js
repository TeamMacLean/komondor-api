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
  dataPrefixFor: (relative) => `komondor/data/${relative}`,
  controlPrefixFor: (projectId, migrationId) =>
    `komondor/control/projects/${projectId}/${migrationId}`,
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
      ["komondor/data/group/project"],
      [`komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}`],
    ]);
    expect(state.lockProject).not.toHaveBeenCalled();

    const result = JSON.parse(dependencies.stdout.mock.calls[0][0]);
    expect(result).toMatchObject({
      command: "lock",
      execute: false,
      sourceRoot: "/srv/komondor/datastore/group/project",
      destination: "s3://archive-bucket/komondor/data/group/project",
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
        s3Uri: "s3://archive-bucket/komondor/data/group/project",
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
          s3Key: "komondor/data/group/project/sample/reads.fastq",
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
          s3Key: "komondor/data/group/project/sample/reads.fastq",
        }),
      ]),
    );

    const sourceKey = `komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}/source-manifest.v1.json`;
    const verificationKey = `komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}/verification-report.v1.json`;
    expect([...controls.keys()]).toEqual([sourceKey, verificationKey]);
    expect(JSON.parse(controls.get(sourceKey).toString("utf8"))).toMatchObject({
      kind: "source",
      projectId: PROJECT_ID,
      migrationId: MIGRATION_ID,
      dataPrefix: "s3://archive-bucket/komondor/data/group/project",
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
        s3Uri: "s3://archive-bucket/komondor/data/group/project",
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
      ["komondor/data/group/project"],
      [`komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}`],
    ]);
    expect(dependencies.aws.listMultipartUploads).toHaveBeenCalledWith(
      "komondor/data/group/project/",
    );
    expect(JSON.parse(dependencies.stdout.mock.calls[0][0])).toMatchObject({
      command: "abort-before-copy",
      state: "hpc",
      phase: "aborted",
      migrationId: MIGRATION_ID,
    });
  });

  test("status shows the way out of an orphaned source manifest in phase inventoried", async () => {
    const controlPrefix = `komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}`;
    const orphanKey = `${controlPrefix}/source-manifest.v1.json`;
    const baseProject = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/data/group/project",
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
      `aws s3 mv 's3://archive-bucket/${orphanKey}' 's3://archive-bucket/komondor/control/projects/${PROJECT_ID}/abandoned/${MIGRATION_ID}/source-manifest.v1.json'`,
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
      dataPrefix: "s3://archive-bucket/komondor/data/group/project",
      dataKeyPrefix: "komondor/data/group/project",
      entries: [],
    });
    const project = {
      _id: PROJECT_ID,
      name: "Project One",
      path: "group/project",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive-bucket/komondor/data/group/project",
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
      `komondor/control/projects/${PROJECT_ID}/${MIGRATION_ID}/source-manifest.v1.json`,
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
