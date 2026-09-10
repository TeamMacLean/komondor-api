/**
 * Tests for routes/accessions.js
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Project", () => ({
  findByIdAndUpdate: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Sample", () => ({
  findByIdAndUpdate: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Run", () => ({
  findByIdAndUpdate: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Read", () => ({ find: jest.fn() }));

// Not mocked: lib/utils/groupAccess and lib/utils/fullAccessUsers. Those are the
// authorisation decisions under test here, so they run for real against a mocked
// Group model. `findOne` is the group-liveness lookup POST /accessions/new does
// per record; `GroupsIAmIn` is left in place so a test can assert that route no
// longer reaches for a read capability to authorise its write.
jest.mock("../../models/Group", () => ({
  GroupsIAmIn: jest.fn(),
  findOne: jest.fn(),
}));

let mockUser = null;

/**
 * Stubs the Group.findOne(...).select("_id") POST /accessions/new uses to ask
 * whether a record's group is still live. `null` is a group that has been
 * soft-deleted, or never existed.
 */
const mockGroupLookup = (group) => {
  require("../../models/Group").findOne = jest.fn(() => ({
    select: jest.fn().mockResolvedValue(group),
  }));
};

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    if (!mockUser) {
      return res.status(401).send({ error: "Authentication required" });
    }
    req.user = mockUser;
    next();
  },
  isAdmin: (req, res, next) => next(),
  // Deliberately the real implementation rather than a pass-through. This is
  // the gate on the cross-group export, and stubbing it to `next()` made the
  // gate invisible to this suite: deleting `.all(hasFullRecordsAccess)` from
  // the route changed nothing here. It reads its predicate from
  // FULL_RECORDS_ACCESS_USERS, which every test below sets.
  hasFullRecordsAccess: jest.requireActual("../../routes/middleware")
    .hasFullRecordsAccess,
}));

const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");
const Read = require("../../models/Read");
const Group = require("../../models/Group");
const accessionsRouter = require("../../routes/accessions");

const app = express();
app.use(express.json());
app.use("/", accessionsRouter);

const validId = new mongoose.Types.ObjectId().toString();
const projectId = new mongoose.Types.ObjectId();
const groupId = new mongoose.Types.ObjectId();
const otherGroupId = new mongoose.Types.ObjectId();

const ORIGINAL_FULL_ACCESS = process.env.FULL_RECORDS_ACCESS_USERS;

/** Stubs Run.find().populate().populate() */
const mockRunFind = (runs) => {
  const chain = {
    populate: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(runs).then(resolve, reject),
  };
  Run.find.mockReturnValue(chain);
};

/** Stubs Read.find().populate() */
const mockReadFind = (reads) => {
  const chain = {
    populate: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(reads).then(resolve, reject),
  };
  Read.find.mockReturnValue(chain);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.READS_ROOT_PATH = "/reads";

  // The default caller is an ENA admin acting on a record in a live group they
  // can read — the only combination the route is meant to accept.
  process.env.FULL_RECORDS_ACCESS_USERS = '["enaadmin"]';
  mockUser = { username: "enaadmin", groups: [] };
  Group.GroupsIAmIn.mockResolvedValue([{ _id: groupId }]);
  mockGroupLookup({ _id: groupId });
  [Project, Sample, Run].forEach((Model) => {
    Model.findById.mockResolvedValue({ _id: validId, group: groupId });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_FULL_ACCESS === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL_FULL_ACCESS;
  }
});

describe("POST /accessions/new", () => {
  test.each([
    ["project", () => Project],
    ["sample", () => Sample],
    ["run", () => Run],
  ])("updates accessions for a %s", async (type, getModel) => {
    getModel().findByIdAndUpdate.mockResolvedValue({ _id: validId });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type, typeId: validId, accessions: ["ERP1"] });

    expect(response.status).toBe(200);
    expect(getModel().findByIdAndUpdate).toHaveBeenCalledWith(
      validId,
      { accessions: ["ERP1"] },
      { new: true },
    );
  });

  test("stores a release date for projects", async () => {
    Project.findByIdAndUpdate.mockResolvedValue({ _id: validId });

    await request(app)
      .post("/accessions/new")
      .send({
        type: "project",
        typeId: validId,
        accessions: ["ERP1"],
        releaseDate: "01-01-2030",
      });

    expect(Project.findByIdAndUpdate).toHaveBeenCalledWith(
      validId,
      { accessions: ["ERP1"], releaseDate: "01-01-2030" },
      { new: true },
    );
  });

  test("ignores a release date for non-projects", async () => {
    Sample.findByIdAndUpdate.mockResolvedValue({ _id: validId });

    await request(app).post("/accessions/new").send({
      type: "sample",
      typeId: validId,
      accessions: [],
      releaseDate: "01-01-2030",
    });

    expect(Sample.findByIdAndUpdate).toHaveBeenCalledWith(
      validId,
      { accessions: [] },
      { new: true },
    );
  });

  test("rejects an unknown type", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "banana", typeId: validId });

    expect(response.status).toBe(400);
  });

  test("rejects a missing type", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ typeId: validId });

    expect(response.status).toBe(400);
  });

  test("rejects a missing typeId", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Missing typeId");
  });

  test("rejects a malformed typeId before querying", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: "not-an-id" });

    expect(response.status).toBe(400);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects a non-array accessions value", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: "ERP1" });

    expect(response.status).toBe(400);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects an accessions array holding a non-string", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: [{ $ne: null }] });

    expect(response.status).toBe(400);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects a non-string releaseDate", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({
        type: "project",
        typeId: validId,
        accessions: [],
        releaseDate: { $ne: null },
      });

    expect(response.status).toBe(400);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects an object typeId before querying", async () => {
    // ObjectId.isValid rejects this too, but the string guard is what stops
    // mongoose reading `{ $ne: null }` as a query condition and matching an
    // arbitrary record rather than failing to cast.
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: { $ne: null }, accessions: [] });

    expect(response.status).toBe(400);
    expect(Project.findById).not.toHaveBeenCalled();
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects a type inherited from Object.prototype", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "constructor", typeId: validId, accessions: [] });

    expect(response.status).toBe(400);
  });

  test("returns 404 when the entity does not exist", async () => {
    Project.findById.mockResolvedValue(null);

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: [] });

    expect(response.status).toBe(404);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("returns 500 when the update fails", async () => {
    Project.findByIdAndUpdate.mockRejectedValue(new Error("db down"));

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: [] });

    expect(response.status).toBe(500);
  });
});

describe("POST /accessions/new authorisation", () => {
  test("refuses an ordinary group member writing accessions on their own group", async () => {
    // The route used to be `.all(isAuthenticated)` and nothing else, so any
    // logged-in user could rewrite the ENA identifiers on any record. An
    // accession is issued by ENA and written back by the submission round-trip,
    // not edited by the owning group — komondor-web only renders the control
    // for an ENA admin.
    mockUser = { username: "alice", groups: [groupId.toString()] };

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/does not have permission/);
    expect(Run.findById).not.toHaveBeenCalled();
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("refuses a cross-group accession write", async () => {
    // alice is a member of one group; the run belongs to another.
    mockUser = { username: "alice", groups: [groupId.toString()] };
    Group.GroupsIAmIn.mockResolvedValue([{ _id: groupId }]);
    Run.findById.mockResolvedValue({ _id: validId, group: otherGroupId });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("refuses an unauthenticated caller", async () => {
    mockUser = null;

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(401);
    expect(Run.findById).not.toHaveBeenCalled();
  });

  test("allows an admin, who has full records access", async () => {
    mockUser = { username: "someadmin", isAdmin: true, groups: [] };
    Run.findByIdAndUpdate.mockResolvedValue({ _id: validId });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(200);
  });

  test("refuses a write into a soft-deleted group", async () => {
    // routes/groups.js retires a group by setting `deleted`, and the liveness
    // query excludes those — so a retired group stops authorising writes into
    // records nobody can see any more, even for an ENA admin.
    mockGroupLookup(null);

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(Group.findOne).toHaveBeenCalledWith({
      _id: groupId,
      deleted: { $ne: true },
    });
  });

  test("refuses a record whose group is missing", async () => {
    // Nothing to authorise against, so nothing is written — and no query is
    // sent for an undefined id.
    Run.findById.mockResolvedValue({ _id: validId, group: undefined });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("does not authorise the write with a read capability", async () => {
    // UPDATED: this used to assert the opposite — that the route asked
    // GroupsIAmIn in "read" mode. That was the one place the read/write split
    // in lib/utils/groupAccess.js did not hold: a read capability guarding
    // findByIdAndUpdate, on a route that also sets `releaseDate` and so drives
    // ENA release. Who may write is settled by requireAccessionWrite; what is
    // left per record is whether the group is live, and that is asked of the
    // Group collection directly.
    Run.findByIdAndUpdate.mockResolvedValue({ _id: validId });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(200);
    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
    expect(Group.findOne).toHaveBeenCalledWith({
      _id: groupId,
      deleted: { $ne: true },
    });
  });
});

describe("GET /accessions/csv", () => {
  const buildRun = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    owner: "alice",
    safeName: "run_1",
    accessions: ["ERR1"],
    createdAt: "2025-01-01",
    group: { safeName: "group_a" },
    sample: {
      _id: new mongoose.Types.ObjectId(),
      safeName: "sample_1",
      accessions: ["ERS1"],
      project: projectId,
    },
    ...overrides,
  });

  const buildProject = (overrides = {}) => ({
    _id: projectId,
    safeName: "project_1",
    releaseDate: "01-01-2030",
    accessions: ["ERP1"],
    ...overrides,
  });

  test("emits a heading row and one row per run", async () => {
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([buildProject()]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.status).toBe(200);
    const lines = response.body.csv.trim().split("\n");
    expect(lines[0]).toMatch(/^group,owner,/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("group_a");
    expect(lines[1]).toContain("project_1");
  });

  test("refuses a caller without cross-group read access", async () => {
    // The export ignores group membership by design — it returns every run in
    // the database — so it is gated on the same predicate as cross-group reads.
    // It was once reachable by any authenticated user: a member of a single
    // group, or of none, could export the lot. Nothing watched that gate until
    // this test, because the middleware was stubbed to a pass-through here.
    mockUser = { username: "alice", groups: [groupId.toString()] };
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([buildProject()]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/permission/i);
    // Refused before the whole-database query, not after it.
    expect(Run.find).not.toHaveBeenCalled();
  });

  test("allows an ENA admin named in FULL_RECORDS_ACCESS_USERS", async () => {
    // isAdmin is too narrow for this route: the people who use the export are
    // ENA admins whose tokens carry no isAdmin claim.
    mockUser = { username: "enaadmin", groups: [] };
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([buildProject()]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.status).toBe(200);
  });

  test("quotes a field containing a comma so columns stay aligned", async () => {
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([
      buildProject({ safeName: "project, with comma" }),
    ]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain('"project, with comma"');
  });

  test("escapes embedded double quotes", async () => {
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([buildProject({ safeName: 'a"b' })]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain('"a""b"');
  });

  test("neutralises a value a spreadsheet would execute", async () => {
    // /accessions/csv is the endpoint that produces a downloadable CSV, and it
    // is built from user-controlled names. Without the apostrophe prefix this
    // cell runs on the machine of whoever opens the export.
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([
      buildProject({ safeName: `=cmd|'/C calc'!A0` }),
    ]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain(`"'=cmd|'/C calc'!A0"`);
  });

  test("leaves a plain negative number alone", async () => {
    // The literal rule would text-quote every negative number. A leading sign
    // in front of a numeric literal cannot execute anything.
    mockRunFind([buildRun()]);
    Project.find.mockResolvedValue([buildProject({ safeName: "-80" })]);
    mockReadFind([]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain("-80");
    expect(response.body.csv).not.toContain("'-80");
  });

  test("joins read paths with semicolons", async () => {
    const run = buildRun();
    mockRunFind([run]);
    Project.find.mockResolvedValue([buildProject()]);
    mockReadFind([
      { run: run._id, file: { path: "a/r1.fq" } },
      { run: run._id, file: { path: "a/r2.fq" } },
    ]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain("/reads/a/r1.fq;/reads/a/r2.fq");
  });

  test("emits S3 read URIs for an archived project without duplicating its prefix", async () => {
    const run = buildRun();
    const now = new Date();
    mockRunFind([run]);
    Project.find.mockResolvedValue([
      buildProject({
        path: "/group_a/project_1",
        storage: {
          state: "aws",
          s3Uri: "s3://archive/data/group_a/project_1",
          s3VerifiedAt: now,
          hpcVerifiedAbsentAt: now,
          archivedAt: now,
        },
      }),
    ]);
    mockReadFind([
      {
        run: run._id,
        file: { path: "group_a/project_1/sample_1/run_1/raw/r1.fq" },
      },
    ]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain(
      "s3://archive/data/group_a/project_1/sample_1/run_1/raw/r1.fq",
    );
    expect(response.body.csv).not.toContain("project_1/group_a/project_1");
  });

  test("marks a historically inconsistent archived File.path unresolved", async () => {
    const run = buildRun();
    const now = new Date();
    mockRunFind([run]);
    Project.find.mockResolvedValue([
      buildProject({
        path: "/group_a/project_1",
        storage: {
          state: "aws",
          s3Uri: "s3://archive/data/group_a/project_1",
          s3VerifiedAt: now,
          hpcVerifiedAbsentAt: now,
          archivedAt: now,
        },
      }),
    ]);
    mockReadFind([{ run: run._id, file: { path: "another/project/r1.fq" } }]);

    const response = await request(app).get("/accessions/csv");

    expect(response.body.csv).toContain("unresolved:another/project/r1.fq");
  });

  describe("skips unusable rows rather than failing the export", () => {
    test("skips a run whose sample is missing", async () => {
      mockRunFind([buildRun({ sample: null }), buildRun()]);
      Project.find.mockResolvedValue([buildProject()]);
      mockReadFind([]);

      const response = await request(app).get("/accessions/csv");

      expect(response.status).toBe(200);
      expect(response.body.csv.trim().split("\n")).toHaveLength(2);
    });

    test("skips a run whose group is missing", async () => {
      mockRunFind([buildRun({ group: null })]);
      Project.find.mockResolvedValue([buildProject()]);
      mockReadFind([]);

      const response = await request(app).get("/accessions/csv");

      expect(response.status).toBe(200);
      expect(response.body.csv.trim().split("\n")).toHaveLength(1);
    });

    test("skips a run whose project is missing", async () => {
      mockRunFind([buildRun()]);
      Project.find.mockResolvedValue([]);
      mockReadFind([]);

      const response = await request(app).get("/accessions/csv");

      expect(response.status).toBe(200);
      expect(response.body.csv.trim().split("\n")).toHaveLength(1);
    });

    test("ignores a read whose file is missing", async () => {
      const run = buildRun();
      mockRunFind([run]);
      Project.find.mockResolvedValue([buildProject()]);
      mockReadFind([{ run: run._id, file: null }]);

      const response = await request(app).get("/accessions/csv");

      expect(response.status).toBe(200);
    });
  });

  test("answers 500 with a readable message when the query fails", async () => {
    Run.find.mockImplementation(() => {
      throw new Error("db down");
    });

    const response = await request(app).get("/accessions/csv");

    expect(response.status).toBe(500);
    // Previously the body was `{ error: <Error> }`, which serialises to {}.
    expect(response.body.detail).toBe("db down");
  });
});
