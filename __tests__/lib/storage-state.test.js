const {
  HPC_WRITABLE_FILTER,
  NON_HPC_FILTER,
  READ_ONLY_CODE,
  resolveStorageState,
  publicStorageSummary,
  assertProjectAcceptsHpcWrites,
  locationFor,
  relativePathWithinProject,
  notApplicableReconciliation,
  attachProjectStorage,
} = require("../../lib/storage-state");

const dates = {
  s3VerifiedAt: new Date("2026-09-01T10:00:00Z"),
  hpcVerifiedAbsentAt: new Date("2026-09-02T10:00:00Z"),
  archivedAt: new Date("2026-09-02T10:00:00Z"),
};

describe("Project storage lifecycle", () => {
  test("legacy and explicit HPC projects are writable", () => {
    expect(resolveStorageState({ _id: "p1" })).toEqual({
      state: "hpc",
      acceptsHpcWrites: true,
      authoritativeLocation: "hpc",
      integrityError: null,
    });
    expect(resolveStorageState({ storage: { state: "hpc" } })).toMatchObject({
      state: "hpc",
      acceptsHpcWrites: true,
    });
    expect(HPC_WRITABLE_FILTER.$or).toHaveLength(2);
    expect(NON_HPC_FILTER["storage.state"].$ne).toBe("hpc");
  });

  test.each([
    ["migrating", { s3Uri: "s3://archive/data/g/p" }, "hpc"],
    [
      "aws_pending_hpc_deletion",
      { s3Uri: "s3://archive/data/g/p", s3VerifiedAt: dates.s3VerifiedAt },
      "s3",
    ],
    ["aws", { s3Uri: "s3://archive/data/g/p", ...dates }, "s3"],
  ])("resolves %s as read-only", (state, evidence, authoritativeLocation) => {
    expect(
      resolveStorageState({ storage: { state, ...evidence } }),
    ).toMatchObject({
      state,
      acceptsHpcWrites: false,
      authoritativeLocation,
      integrityError: null,
    });
  });

  test.each([
    null,
    { storage: { state: "unknown" } },
    { storage: { state: "hpc", s3Uri: "s3://should-not-exist" } },
    { storage: { state: "aws", s3Uri: "s3://archive/data/g/p" } },
    { storage: { s3VerifiedAt: dates.s3VerifiedAt } },
  ])("fails closed for invalid state %#", (project) => {
    expect(resolveStorageState(project)).toMatchObject({
      state: "invalid",
      acceptsHpcWrites: false,
      authoritativeLocation: null,
    });
  });

  test("throws a terminal machine-readable error on writes", () => {
    const project = {
      _id: "p1",
      storage: { state: "migrating", s3Uri: "s3://archive/data/g/p" },
    };
    expect(() => assertProjectAcceptsHpcWrites(project)).toThrow(
      expect.objectContaining({
        code: READ_ONLY_CODE,
        projectId: "p1",
        storageState: "migrating",
        retryable: false,
      }),
    );
  });

  test("returns a stable public summary and never exposes migration internals", () => {
    const summary = publicStorageSummary({
      _id: "p1",
      storage: {
        state: "migrating",
        s3Uri: "s3://archive/data/g/p",
      },
      archiveMigration: {
        phase: "copying",
        movedBy: "operator",
        sourceRoot: "/secret/hpc/g/p",
        lastError: { message: "network" },
      },
    });

    expect(summary).toMatchObject({
      state: "migrating",
      acceptsHpcWrites: false,
      authoritativeLocation: "hpc",
      migrationHealth: "needs_attention",
    });
    expect(JSON.stringify(summary)).not.toMatch(/operator|sourceRoot|network/);
  });
});

describe("storage locations", () => {
  const originalReadsRoot = process.env.READS_ROOT_PATH;

  beforeEach(() => {
    process.env.READS_ROOT_PATH = "/mounted/reads";
  });

  afterAll(() => {
    if (originalReadsRoot === undefined) delete process.env.READS_ROOT_PATH;
    else process.env.READS_ROOT_PATH = originalReadsRoot;
  });

  test("uses the configured HPC root for a legacy project", () => {
    const project = { path: "/group/project" };
    expect(
      locationFor(project, "/group/project/sample/run", { includeRaw: true }),
    ).toEqual({
      authoritative: "hpc",
      baseUri: "/mounted/reads/group/project/sample/run",
      rawUri: "/mounted/reads/group/project/sample/run/raw",
      additionalUri: "/mounted/reads/group/project/sample/run/additional",
      plannedS3Uri: null,
    });
  });

  test("uses the immutable project S3 prefix without duplicating the project path", () => {
    const project = {
      path: "/group/project",
      storage: {
        state: "aws",
        s3Uri: "s3://archive/base/data/group/project",
        ...dates,
      },
    };
    expect(
      relativePathWithinProject(project, "group/project/sample/run/raw/a.fq"),
    ).toBe("sample/run/raw/a.fq");
    expect(
      locationFor(project, "group/project/sample/run", { includeRaw: true }),
    ).toMatchObject({
      authoritative: "s3",
      baseUri: "s3://archive/base/data/group/project/sample/run",
      rawUri: "s3://archive/base/data/group/project/sample/run/raw",
    });
  });

  test("returns no location for a path outside its project", () => {
    expect(locationFor({ path: "/g/p" }, "/other/p/run")).toMatchObject({
      authoritative: null,
      baseUri: null,
    });
  });
});

test("non-HPC reconciliation is explicit rather than a false mismatch", () => {
  expect(notApplicableReconciliation("aws")).toEqual(
    expect.objectContaining({
      status: "NOT_APPLICABLE",
      reason: READ_ONLY_CODE,
      storageState: "aws",
      missing: [],
      extra: [],
    }),
  );
});

test("attaches a populated legacy project's summary without another query", async () => {
  const sample = {
    _id: "s1",
    project: { _id: "p1", name: "Legacy", path: "/g/p" },
  };
  await attachProjectStorage([sample], { via: "project" });
  expect(sample.projectStorage).toMatchObject({
    state: "hpc",
    acceptsHpcWrites: true,
  });
});
