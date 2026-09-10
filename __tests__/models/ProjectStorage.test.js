const Project = require("../../models/Project");

describe("Project storage serialization", () => {
  test("storage has no default and migration audit data is hidden by default", () => {
    expect(Project.schema.path("storage.state").defaultValue).toBeUndefined();
    expect(Project.schema.path("archiveMigration").options.select).toBe(false);
  });

  test("a legacy Project serializes as writable HPC storage", () => {
    const project = Project.hydrate({
      _id: "64f1c0000000000000000000",
      name: "Legacy",
      path: "/group/legacy",
    });

    expect(project.toJSON().storage).toEqual({
      state: "hpc",
      acceptsHpcWrites: true,
      authoritativeLocation: "hpc",
      s3Uri: null,
      s3VerifiedAt: null,
      hpcVerifiedAbsentAt: null,
      archivedAt: null,
      migrationHealth: null,
    });
  });

  test("archiveMigration is stripped even when it was explicitly selected", () => {
    const now = new Date("2026-09-07T12:00:00Z");
    const project = Project.hydrate({
      _id: "64f1c0000000000000000000",
      name: "Archived",
      path: "/group/archived",
      storage: {
        state: "aws",
        s3Uri: "s3://archive/data/group/archived",
        s3VerifiedAt: now,
        hpcVerifiedAbsentAt: now,
        archivedAt: now,
      },
      archiveMigration: {
        id: "64f1c0000000000000000001",
        phase: "completed",
        movedBy: "operator",
        sourceRoot: "/private/datastore/group/archived",
        sourceRelativeRoot: "group/archived",
        startedAt: now,
        updatedAt: now,
      },
    });

    const json = project.toJSON();
    expect(json.storage).toMatchObject({
      state: "aws",
      acceptsHpcWrites: false,
      authoritativeLocation: "s3",
    });
    expect(json).not.toHaveProperty("archiveMigration");
    expect(JSON.stringify(json)).not.toMatch(/operator|private\/datastore/);
  });
});
