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
// Group.GroupsIAmIn.
jest.mock("../../models/Group", () => ({ GroupsIAmIn: jest.fn() }));

let mockUser = null;

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    if (!mockUser) {
      return res.status(401).send({ error: "Authentication required" });
    }
    req.user = mockUser;
    next();
  },
  isAdmin: (req, res, next) => next(),
  // The CSV export is gated on this; the real predicate is covered in
  // __tests__/routes/middleware.test.js.
  hasFullRecordsAccess: (req, res, next) => next(),
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

    await request(app).post("/accessions/new").send({
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
    // GroupsIAmIn omits soft-deleted groups for everybody, so the group the
    // record belongs to stops resolving and the write is refused even for an
    // ENA admin who can otherwise read across every group.
    Group.GroupsIAmIn.mockResolvedValue([]);

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("refuses a record whose group is missing", async () => {
    Run.findById.mockResolvedValue({ _id: validId, group: undefined });

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(response.status).toBe(403);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("asks for the read capability, which is what full access grants", async () => {
    Run.findByIdAndUpdate.mockResolvedValue({ _id: validId });

    await request(app)
      .post("/accessions/new")
      .send({ type: "run", typeId: validId, accessions: ["ERR1"] });

    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      expect.objectContaining({ username: "enaadmin" }),
      { mode: "read" },
    );
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
