/**
 * Tests for routes/accessions.js
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Project", () => ({
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Sample", () => ({
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Run", () => ({
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));
jest.mock("../../models/Read", () => ({ find: jest.fn() }));

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "testuser", groups: [] };
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
const accessionsRouter = require("../../routes/accessions");

const app = express();
app.use(express.json());
app.use("/", accessionsRouter);

const validId = new mongoose.Types.ObjectId().toString();
const projectId = new mongoose.Types.ObjectId();

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
});

afterEach(() => {
  jest.restoreAllMocks();
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

  test("returns 404 when the entity does not exist", async () => {
    Project.findByIdAndUpdate.mockResolvedValue(null);

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: [] });

    expect(response.status).toBe(404);
  });

  test("returns 500 when the update fails", async () => {
    Project.findByIdAndUpdate.mockRejectedValue(new Error("db down"));

    const response = await request(app)
      .post("/accessions/new")
      .send({ type: "project", typeId: validId, accessions: [] });

    expect(response.status).toBe(500);
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
