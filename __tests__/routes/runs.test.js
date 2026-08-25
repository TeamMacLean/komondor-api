const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const runsRouter = require("../../routes/runs");
const Run = require("../../models/Run");
const Sample = require("../../models/Sample");
const Group = require("../../models/Group");
const ingestQueue = require("../../lib/ingest-queue");
const { enqueueRunIngest, IngestJob } = ingestQueue;

// Mock the middleware
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: jest.fn((req, res, next) => {
    req.user = { username: "testuser", isAdmin: false, groups: ["group-123"] };
    next();
  }),
}));

// Mock the Run model
jest.mock("../../models/Run");

// Mock the Sample model — the run routes now resolve a run's group from its
// parent sample rather than trusting the submitted one.
jest.mock("../../models/Sample");

// Mock the Read model (used inline in status endpoint)
jest.mock("../../models/Read");

// Mock Group model for permission checks. lib/utils/groupAccess.js asks it a
// different question per capability, so the mock has to answer per mode.
jest.mock("../../models/Group", () => ({
  GroupsIAmIn: jest.fn(),
}));

// Mock the durable ingest queue. The route must not pull the real one in: it
// requires the models and would talk to a database that is not here.
jest.mock("../../lib/ingest-queue", () => ({
  enqueueRunIngest: jest.fn(),
  idempotencyKeyFor: jest.fn((runId) => `run-ingest:${String(runId)}`),
  IngestJob: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../../routes/_utils", () => ({
  handleError: jest.fn((res, error, status, message) => {
    res
      .status(status)
      .json({
        error: message || error.message,
        detail: error instanceof Error ? error.message : undefined,
      });
  }),
  getActualFiles: jest.fn().mockResolvedValue([]),
  generateRequestId: jest.fn().mockReturnValue("test-request-id"),
  compareFilesToDirectory: jest.fn().mockResolvedValue({
    actualFiles: [],
    status: {
      status: "OK",
      message: "All files present",
      missing: [],
      extra: [],
      unresolved: [],
    },
  }),
}));

const app = express();
app.use(express.json());
app.use("/", runsRouter);

/**
 * Answers GroupsIAmIn per capability, so a test can give a user broad read
 * access without also giving it write access — the asymmetry the whole
 * groupAccess split exists to express.
 */
const setGroups = ({ read = [], write = [] }) => {
  Group.GroupsIAmIn.mockImplementation(async (user, options = {}) =>
    options.mode === "write" ? write : read,
  );
};

/** A Sample.findById(...).select("group") that resolves to `sample`. */
const mockSampleLookup = (sample) => {
  Sample.findById = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(sample),
  });
};

describe("Runs API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // No ingest jobs unless a test says otherwise.
    IngestJob.find.mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });
  });

  describe("GET /runs/names/:sampleId", () => {
    const mockSampleId = new mongoose.Types.ObjectId().toString();
    const mockGroupId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });
      mockSampleLookup({ _id: mockSampleId, group: mockGroupId });
    });

    test("should return unique run names for a sample", async () => {
      const mockRuns = [
        { _id: "1", name: "Run A" },
        { _id: "2", name: "Run B" },
        { _id: "3", name: "Run A" }, // Duplicate
        { _id: "4", name: "Run C" },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockRuns),
        }),
      });

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("runNames");
      expect(response.body.runNames).toEqual(["Run A", "Run B", "Run C"]);
      expect(response.body.runNames).toHaveLength(3); // Should remove duplicates

      expect(Run.find).toHaveBeenCalledWith({ sample: mockSampleId });
    });

    test("should filter out null and empty names", async () => {
      const mockRuns = [
        { _id: "1", name: "Run A" },
        { _id: "2", name: null },
        { _id: "3", name: "" },
        { _id: "4", name: "   " }, // Whitespace only
        { _id: "5", name: "Run B" },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockRuns),
        }),
      });

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.runNames).toEqual(["Run A", "Run B"]);
      expect(response.body.runNames).toHaveLength(2);
    });

    test("should return empty array when no runs exist for sample", async () => {
      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.runNames).toEqual([]);
    });

    test("should return empty array when all runs have null names", async () => {
      const mockRuns = [
        { _id: "1", name: null },
        { _id: "2", name: "" },
        { _id: "3", name: undefined },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockRuns),
        }),
      });

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.runNames).toEqual([]);
    });

    test("should handle database errors gracefully", async () => {
      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error("Database error")),
        }),
      });

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(500);
    });

    test("should refuse an invalid sample ID before touching the database", async () => {
      Run.find = jest.fn();

      const response = await request(app).get("/runs/names/invalid-id");

      // Previously this reached the database and surfaced a CastError as a 500.
      // A value that is not an id is a client error, and refusing it at the
      // boundary is what keeps a query operator out of Run.find in the first
      // place.
      expect(response.status).toBe(400);
      expect(Sample.findById).not.toHaveBeenCalled();
      expect(Run.find).not.toHaveBeenCalled();
    });

    test("should return 404 when the sample does not exist", async () => {
      mockSampleLookup(null);
      Run.find = jest.fn();

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(404);
      expect(Run.find).not.toHaveBeenCalled();
    });

    test("should not leak run names from another group's sample", async () => {
      const otherGroupId = new mongoose.Types.ObjectId();
      mockSampleLookup({ _id: mockSampleId, group: otherGroupId });
      Run.find = jest.fn();

      const response = await request(app).get(`/runs/names/${mockSampleId}`);

      expect(response.status).toBe(403);
      expect(Run.find).not.toHaveBeenCalled();
    });

    test("should ensure names are scoped to specific sample only", async () => {
      const sampleId1 = new mongoose.Types.ObjectId().toString();
      const sampleId2 = new mongoose.Types.ObjectId().toString();

      // Mock runs for sample 1
      const runsForSample1 = [
        { _id: "1", name: "Run A" },
        { _id: "2", name: "Run B" },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(runsForSample1),
        }),
      });

      const response = await request(app).get(`/runs/names/${sampleId1}`);

      expect(response.status).toBe(200);
      expect(Run.find).toHaveBeenCalledWith({ sample: sampleId1 });
      expect(response.body.runNames).toEqual(["Run A", "Run B"]);

      // Verify it was called with the correct sample ID, not a different one
      expect(Run.find).not.toHaveBeenCalledWith({ sample: sampleId2 });
    });
  });

  describe("GET /runs", () => {
    test("should return all runs visible to user", async () => {
      const mockRuns = [
        { _id: "1", name: "Run 1" },
        { _id: "2", name: "Run 2" },
      ];

      Run.iCanSee = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockRuns),
          }),
        }),
      });

      const response = await request(app).get("/runs");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("runs");
      expect(response.body.runs).toEqual(mockRuns);
    });
  });

  describe("GET /run", () => {
    test("should refuse an operator supplied in place of the run ID", async () => {
      Run.findById = jest.fn();

      const response = await request(app).get("/run?id[$ne]=null");

      expect(response.status).toBe(400);
      expect(Run.findById).not.toHaveBeenCalled();
    });
  });

  describe("POST /runs/new", () => {
    const mockSampleId = new mongoose.Types.ObjectId();
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockRunId = new mongoose.Types.ObjectId();
    const mockJobId = new mongoose.Types.ObjectId();

    const requestBody = (overrides = {}) => ({
      sample: mockSampleId.toString(),
      name: "New Run",
      sequencingProvider: "Test Provider",
      sequencingTechnology: "Illumina",
      librarySource: "GENOMIC",
      libraryType: "WGS",
      librarySelection: "RANDOM",
      libraryStrategy: "WGS",
      owner: "testuser",
      group: mockGroupId.toString(),
      rawFiles: [{ name: "test_R1.fq.gz" }],
      rawFilesUploadInfo: { method: "local-filesystem" },
      ...overrides,
    });

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });
      mockSampleLookup({ _id: mockSampleId, group: mockGroupId });
      enqueueRunIngest.mockResolvedValue({ _id: mockJobId });
    });

    describe("idempotency", () => {
      test("should return existing run when duplicate is detected (idempotent)", async () => {
        const existingRun = {
          _id: mockRunId,
          sample: mockSampleId,
          name: "Duplicate Run",
          status: "complete",
          md5VerificationStatus: "complete",
          group: mockGroupId,
          rawFiles: [],
          additionalFiles: [],
        };

        // Mock findOne to return existing run
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(existingRun),
        });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ name: "Duplicate Run" }));

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("idempotent", true);
        expect(response.body).toHaveProperty("message");
        expect(response.body.run._id.toString()).toEqual(
          existingRun._id.toString(),
        );
        expect(Run.findOne).toHaveBeenCalledWith({
          sample: mockSampleId.toString(),
          name: "Duplicate Run",
        });
      });

      test("should re-queue the ingest for an already-existing run", async () => {
        // A client retrying after a lost 201 is the case that matters: without
        // this the run exists but nothing ever moves its files.
        const existingRun = {
          _id: mockRunId,
          name: "Duplicate Run",
          group: mockGroupId,
          rawFiles: [],
          additionalFiles: [],
        };

        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(existingRun),
        });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ name: "Duplicate Run" }));

        expect(response.status).toBe(200);
        expect(enqueueRunIngest).toHaveBeenCalledWith(
          expect.objectContaining({ runId: mockRunId }),
        );
        expect(response.body.jobId).toEqual(mockJobId.toString());
      });

      test("should refuse to return an existing run from a group the user cannot read", async () => {
        // The sample authorises the write, but the run that came back carries
        // its own group field and its whole populated file list.
        const otherGroupId = new mongoose.Types.ObjectId();
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: mockRunId,
            name: "Duplicate Run",
            group: otherGroupId,
            rawFiles: [{ _id: "secret" }],
          }),
        });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ name: "Duplicate Run" }));

        expect(response.status).toBe(403);
        expect(response.body).not.toHaveProperty("run");
      });

      test("should refuse to re-queue an ingest into a group the user may only read", async () => {
        // The FULL_RECORDS_ACCESS_USERS shape: every group readable, only
        // their own writable. The sample is in their own group so the
        // create-side check passes, but the run whose name collides belongs
        // elsewhere — and this branch does not merely return that run, it
        // enqueues the caller's own file list against it.
        const otherGroupId = new mongoose.Types.ObjectId();
        setGroups({
          read: [{ _id: mockGroupId }, { _id: otherGroupId }],
          write: [{ _id: mockGroupId }],
        });

        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: mockRunId,
            name: "Duplicate Run",
            group: otherGroupId,
            rawFiles: [],
            additionalFiles: [],
          }),
        });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ name: "Duplicate Run" }));

        expect(response.status).toBe(403);
        expect(response.body).not.toHaveProperty("run");
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });

      test("should create new run when no duplicate exists", async () => {
        // Mock findOne to return null (no existing run)
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });

        Run.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({
            _id: mockRunId,
            name: "New Run",
          }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(201);
        expect(response.body).not.toHaveProperty("idempotent");
        expect(Run.findOne).toHaveBeenCalledWith({
          sample: mockSampleId.toString(),
          name: "New Run",
        });
      });
    });

    describe("operator injection", () => {
      test("should refuse an operator in place of the sample id", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ sample: { $ne: null } }));

        // Mongoose 5 preserves {"$ne": null} through casting, so reaching
        // Run.findOne at all would return an arbitrary run from any group,
        // populated with its file list, before anything was authorised.
        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("should refuse an operator in place of the run name", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ name: { $ne: null } }));

        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("should refuse an operator in place of the group id", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ group: { $ne: null } }));

        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("should refuse a 12-character string that mongoose would accept as an id", async () => {
        // ObjectId.isValid() accepts any 12-character string as raw bytes, so
        // the guard is a hex-only pattern rather than mongoose's own check.
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ sample: "sample_names" }));

        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
      });
    });

    describe("parent sample authorization", () => {
      test("should refuse a sample belonging to another group", async () => {
        // The body names a group the user may write to, but the sample it
        // points at belongs elsewhere. The old code authorised the submitted
        // group and never checked the two belonged together.
        const otherGroupId = new mongoose.Types.ObjectId();
        mockSampleLookup({ _id: mockSampleId, group: otherGroupId });
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(403);
        expect(Run.findOne).not.toHaveBeenCalled();
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });

      test("should refuse a group that does not own the submitted sample", async () => {
        // Both groups are writable by this user, so the request is merely
        // inconsistent rather than an escalation attempt.
        const otherGroupId = new mongoose.Types.ObjectId();
        setGroups({
          read: [{ _id: mockGroupId }, { _id: otherGroupId }],
          write: [{ _id: mockGroupId }, { _id: otherGroupId }],
        });
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ group: otherGroupId.toString() }));

        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("should refuse a sample that does not exist", async () => {
        mockSampleLookup(null);
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(400);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("should accept ids submitted in upper case", async () => {
        // Hex is case-insensitive to MongoDB, so an id that only differs in
        // case is the same id and must not read as a group mismatch.
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });

        Run.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({ _id: mockRunId }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              sample: mockSampleId.toString().toUpperCase(),
              group: mockGroupId.toString().toUpperCase(),
            }),
          );

        expect(response.status).toBe(201);
      });

      test("should store the sample's group rather than the submitted one", async () => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });

        Run.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({ _id: mockRunId }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(201);
        expect(Run).toHaveBeenCalledWith(
          expect.objectContaining({
            sample: mockSampleId.toString(),
            group: mockGroupId,
          }),
        );
      });
    });

    describe("owner is the session, not the body", () => {
      beforeEach(() => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));
      });

      test("stores the authenticated caller, ignoring the body's claim", async () => {
        // `owner` used to be copied straight out of req.body, and the run
        // routes grant read access on `run.owner === req.user.username` — so
        // naming somebody else there handed them a run in a group they may
        // never have been in.
        await request(app)
          .post("/runs/new")
          .send(requestBody({ owner: "somebody-else" }));

        expect(Run).toHaveBeenCalledWith(
          expect.objectContaining({ owner: "testuser" }),
        );
      });
    });

    describe("the { sample, name } unique index", () => {
      test("serves the winner of a create race as an idempotent 200", async () => {
        // Two retries of a lost 201 can both miss the findOne. The unique
        // index means the loser gets an E11000 instead of quietly writing a
        // duplicate, and that must not surface as a 500 — the run the caller
        // asked for demonstrably exists.
        const raced = { _id: mockRunId, name: "New Run", group: mockGroupId };
        const populate = jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(raced);
        Run.findOne = jest.fn().mockReturnValue({ populate });

        const duplicate = new Error("E11000 duplicate key error");
        duplicate.code = 11000;
        Run.mockImplementation(() => ({
          save: jest.fn().mockRejectedValue(duplicate),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(200);
        expect(response.body.idempotent).toBe(true);
        expect(response.body.run._id).toEqual(mockRunId.toString());
        expect(response.body.jobId).toEqual(mockJobId.toString());
      });

      test("queues the ingest for the run that won the race", async () => {
        const raced = { _id: mockRunId, name: "New Run", group: mockGroupId };
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(raced),
        });
        const duplicate = new Error("E11000 duplicate key error");
        duplicate.code = 11000;
        Run.mockImplementation(() => ({
          save: jest.fn().mockRejectedValue(duplicate),
        }));

        await request(app).post("/runs/new").send(requestBody());

        expect(enqueueRunIngest).toHaveBeenCalledWith(
          expect.objectContaining({ runId: mockRunId }),
        );
      });

      test("authorises the run that came back, not only the one asked for", async () => {
        // The race winner carries its own group, which need not agree with the
        // sample's. Same rule as the findOne branch: write access to the
        // existing run's group.
        const otherGroup = new mongoose.Types.ObjectId();
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ _id: mockRunId, group: otherGroup }),
        });
        const duplicate = new Error("E11000 duplicate key error");
        duplicate.code = 11000;
        Run.mockImplementation(() => ({
          save: jest.fn().mockRejectedValue(duplicate),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(403);
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });

      test("still fails the request when the duplicate key names nothing", async () => {
        // A duplicate on some other index: there is no run to hand back, so
        // this is a real error and must not be dressed up as idempotency.
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        const duplicate = new Error("E11000 duplicate key error");
        duplicate.code = 11000;
        Run.mockImplementation(() => ({
          save: jest.fn().mockRejectedValue(duplicate),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(500);
      });

      test("does not swallow a non-duplicate save failure", async () => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest.fn().mockRejectedValue(new Error("mongo is down")),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(500);
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });
    });

    describe("read/write asymmetry", () => {
      test("should refuse a user who may only read the sample's group", async () => {
        // FULL_RECORDS_ACCESS_USERS read every group but write none of them.
        setGroups({
          read: [{ _id: mockGroupId, name: "Test Group" }],
          write: [],
        });
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(403);
        expect(Run.findOne).not.toHaveBeenCalled();
      });
    });

    describe("durable ingest", () => {
      beforeEach(() => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });

        Run.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));
      });

      test("should queue the ingest and report its job id", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ additionalFiles: [{ name: "notes.txt" }] }));

        expect(response.status).toBe(201);
        // The 201 shape komondor-power parses is preserved; jobId is additive.
        expect(response.body).toHaveProperty("run");
        expect(response.body.jobId).toEqual(mockJobId.toString());

        expect(enqueueRunIngest).toHaveBeenCalledWith({
          runId: mockRunId,
          requestId: "test-request-id",
          payload: {
            rawFiles: [{ name: "test_R1.fq.gz" }],
            additionalFiles: [{ name: "notes.txt" }],
            rawFilesUploadInfo: { method: "local-filesystem" },
            // Recorded at enqueue time and used at claim time: the ingest
            // claims the submitter's staged uploads, and file-utils refuses a
            // claim on an upload staged by anybody else.
            username: "testuser",
          },
        });
      });

      test("should not respond until the ingest has been queued", async () => {
        // The bug this replaces: res.status(201) went out first and the work
        // lived in a setImmediate() closure, so a SIGKILL in between lost it
        // with nothing recorded anywhere.
        let release;
        const queued = new Promise((resolve) => {
          release = resolve;
        });
        enqueueRunIngest.mockImplementation(async () => {
          await queued;
          return { _id: mockJobId };
        });

        let responded = false;
        const pending = request(app)
          .post("/runs/new")
          .send(requestBody())
          .then((response) => {
            responded = true;
            return response;
          });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(responded).toBe(false);

        release();
        const response = await pending;
        expect(response.status).toBe(201);
      });

      test("should roll the run back when the enqueue fails", async () => {
        enqueueRunIngest.mockRejectedValue(new Error("Queue unavailable"));
        Run.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        // A 201 here would promise an ingest that was never recorded.
        expect(response.status).toBe(500);
        expect(Run.deleteOne).toHaveBeenCalledWith({ _id: mockRunId });
      });

      test("should roll the run back when the queue returns no job", async () => {
        enqueueRunIngest.mockResolvedValue(null);
        Run.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody());

        expect(response.status).toBe(500);
        expect(Run.deleteOne).toHaveBeenCalledWith({ _id: mockRunId });
      });
    });
  });

  describe("GET /runs/:id/status", () => {
    const mockRunId = new mongoose.Types.ObjectId();
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockReadId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });
    });

    test("should return detailed status for a run", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        status: "complete",
        statusError: null,
        md5VerificationStatus: "in_progress",
        md5VerificationAttempts: 1,
        md5VerificationLastAttempt: new Date("2026-02-02T10:00:00Z"),
        md5VerificationCompletedAt: null,
        group: mockGroupId,
        rawFiles: [],
        additionalFiles: [],
      };

      const mockReads = [
        {
          _id: mockReadId,
          run: mockRunId,
          MD5: "abc123",
          destinationMd5: "abc123",
          md5Mismatch: false,
          MD5LastChecked: new Date("2026-02-02T10:05:00Z"),
          file: { originalName: "file1.fastq" },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          run: mockRunId,
          MD5: "def456",
          destinationMd5: null,
          md5Mismatch: null,
          MD5LastChecked: null,
          file: { originalName: "file2.fastq" },
        },
      ];

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const Read = require("../../models/Read");
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockReads),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("runId");
      expect(response.body).toHaveProperty("runName", "Test Run");
      expect(response.body).toHaveProperty("status", "complete");
      expect(response.body).toHaveProperty(
        "md5VerificationStatus",
        "in_progress",
      );
      expect(response.body).toHaveProperty("progress");
      expect(response.body.progress).toEqual({
        totalFiles: 2,
        verifiedFiles: 1,
        mismatchedFiles: 0,
        percentComplete: 50,
      });
      expect(response.body.files).toHaveLength(2);
      expect(response.body.files[0]).toHaveProperty("fileName", "file1.fastq");
      expect(response.body.files[0]).toHaveProperty("md5Mismatch", false);
    });

    test("should surface the ingest job state alongside the MD5 status", async () => {
      const jobId = new mongoose.Types.ObjectId();
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        status: "pending",
        md5VerificationStatus: "pending",
        group: mockGroupId,
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const Read = require("../../models/Read");
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      IngestJob.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([
          {
            _id: jobId,
            runId: mockRunId,
            status: "failed",
            attempts: 3,
            maxAttempts: 3,
            lastError: "ENOSPC: no space left on device",
            createdAt: new Date("2026-02-02T09:00:00Z"),
            updatedAt: new Date("2026-02-02T09:10:00Z"),
          },
        ]),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
      expect(response.body.ingest).toEqual(
        expect.objectContaining({
          jobId: jobId.toString(),
          status: "failed",
          attempts: 3,
          maxAttempts: 3,
          lastError: "ENOSPC: no space left on device",
        }),
      );
    });

    test("should report a null ingest for a run that was never queued", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Legacy Run",
        group: mockGroupId,
        md5VerificationStatus: "complete",
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const Read = require("../../models/Read");
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
      expect(response.body.ingest).toBeNull();
    });

    test("should refuse an invalid run id without querying", async () => {
      Run.findById = jest.fn();

      const response = await request(app).get("/runs/not-an-id/status");

      expect(response.status).toBe(400);
      expect(Run.findById).not.toHaveBeenCalled();
    });

    test("should return 404 when run not found", async () => {
      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(404);
    });

    test("should return 403 when user lacks permission", async () => {
      const unauthorizedGroupId = new mongoose.Types.ObjectId();
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: unauthorizedGroupId,
        owner: "some_other_user",
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(403);
    });

    test("should allow access when user is not in group but is the owner", async () => {
      const unauthorizedGroupId = new mongoose.Types.ObjectId();
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: unauthorizedGroupId,
        owner: "testuser", // matches the req.user from our mocked middleware
        status: "complete",
        statusError: null,
        md5VerificationStatus: "in_progress",
        md5VerificationAttempts: 1,
        md5VerificationLastAttempt: new Date("2026-02-02T10:00:00Z"),
        md5VerificationCompletedAt: null,
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const Read = require("../../models/Read");
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
    });

    test("should allow a read-only user to see a run they cannot modify", async () => {
      // The other half of the asymmetry: no write capability at all, but the
      // status is still readable.
      setGroups({ read: [{ _id: mockGroupId }], write: [] });

      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: mockGroupId,
        owner: "some_other_user",
        md5VerificationStatus: "complete",
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const Read = require("../../models/Read");
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
    });
  });

  describe("POST /runs/:id/reingest", () => {
    const mockRunId = new mongoose.Types.ObjectId();
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockJobId = new mongoose.Types.ObjectId();

    /** A Run.findById(...).select(...) that resolves to `run`. */
    const mockRunLookup = (run) => {
      Run.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(run),
      });
    };

    /** An IngestJob.findOne(...).select(...) that resolves to `job`. */
    const mockJobLookup = (job) => {
      IngestJob.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(job),
      });
    };

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });

      mockRunLookup({
        _id: mockRunId,
        name: "Broken Run",
        group: mockGroupId,
        owner: "testuser",
        status: "error",
      });

      Run.updateOne = jest.fn().mockResolvedValue({});
      IngestJob.findOneAndUpdate.mockResolvedValue(null);
      mockJobLookup(null);
    });

    test("should return a permanently failed ingest to the queue", async () => {
      // enqueueRunIngest is $setOnInsert, so nothing else in the API can move
      // a dead job off "failed" — without this endpoint the only retry is an
      // operator editing the database by hand.
      IngestJob.findOneAndUpdate.mockResolvedValue({
        _id: mockJobId,
        runId: mockRunId,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        createdAt: new Date("2026-02-02T09:00:00Z"),
        updatedAt: new Date("2026-02-02T11:00:00Z"),
      });

      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(200);
      expect(response.body.jobId).toEqual(mockJobId.toString());
      expect(response.body.ingest).toHaveProperty("status", "pending");

      // Conditioned on "failed" inside the update, so a job a worker has just
      // claimed cannot be dragged back to pending underneath it.
      const [filter, update] = IngestJob.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual(expect.objectContaining({ status: "failed" }));
      expect(update.$set).toEqual(
        expect.objectContaining({ status: "pending", attempts: 0 }),
      );
    });

    test("should reset the attempt count so the worker can claim the job", async () => {
      // claimNextJob fails anything it claims past maxAttempts, so a requeue
      // that left attempts at 3 would be marked failed again on the next poll
      // without the ingest ever being retried.
      IngestJob.findOneAndUpdate.mockResolvedValue({
        _id: mockJobId,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
      });

      await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(IngestJob.findOneAndUpdate.mock.calls[0][1].$set.attempts).toBe(0);
    });

    test("should clear the error the failed ingest pushed onto the run", async () => {
      // failJob sets the run to status "error" so a dead ingest surfaces in
      // the frontend. Once the work is queued again that is no longer true.
      IngestJob.findOneAndUpdate.mockResolvedValue({
        _id: mockJobId,
        status: "pending",
        attempts: 0,
      });

      await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(Run.updateOne).toHaveBeenCalledWith(
        { _id: mockRunId },
        { $set: { status: "pending", statusError: null } },
      );
    });

    test("should refuse a caller who may only read the run's group", async () => {
      // Re-running an ingest moves files into the run's datastore directory,
      // so read-everywhere access is deliberately not enough.
      setGroups({ read: [{ _id: mockGroupId }], write: [] });

      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(403);
      expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("should refuse the run's owner when they cannot write to its group", async () => {
      // The status endpoints fall back to ownership, but those are reads.
      setGroups({ read: [], write: [] });

      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(403);
      expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("should refuse to disturb an ingest that has not failed", async () => {
      // A retry that clobbered a healthy run would be worse than no retry.
      mockJobLookup({ _id: mockJobId, status: "claimed", attempts: 1 });

      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(409);
      expect(Run.updateOne).not.toHaveBeenCalled();
    });

    test("should report a run that has no ingest job at all", async () => {
      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(404);
    });

    test("should return 404 for a run that does not exist", async () => {
      mockRunLookup(null);

      const response = await request(app).post(`/runs/${mockRunId}/reingest`);

      expect(response.status).toBe(404);
      expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("should refuse an invalid run id without querying", async () => {
      const response = await request(app).post("/runs/not-an-id/reingest");

      expect(response.status).toBe(400);
      expect(Run.findById).not.toHaveBeenCalled();
    });

    test("should prefer the queue's own reset when it exports one", async () => {
      // The reset belongs to lib/ingest-queue.js, which owns what "pending
      // again" means; the local write is a fallback for the queue as it
      // stands. If that export appears, this route must pick it up.
      const requeueRunIngest = jest
        .fn()
        .mockResolvedValue({ _id: mockJobId, status: "pending", attempts: 0 });
      ingestQueue.requeueRunIngest = requeueRunIngest;

      try {
        const response = await request(app).post(`/runs/${mockRunId}/reingest`);

        expect(response.status).toBe(200);
        expect(requeueRunIngest).toHaveBeenCalledWith(
          expect.objectContaining({ runId: mockRunId }),
        );
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      } finally {
        delete ingestQueue.requeueRunIngest;
      }
    });
  });

  describe("POST /runs/batch-status", () => {
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockRun1Id = new mongoose.Types.ObjectId();
    const mockRun2Id = new mongoose.Types.ObjectId();

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });
    });

    test("should return status for multiple runs", async () => {
      const mockRuns = [
        {
          _id: mockRun1Id,
          name: "Run 1",
          owner: "other_user",
          status: "complete",
          md5VerificationStatus: "complete",
          md5VerificationAttempts: 1,
          md5VerificationLastAttempt: new Date("2026-02-02T10:00:00Z"),
          md5VerificationCompletedAt: new Date("2026-02-02T10:05:00Z"),
          group: mockGroupId,
          createdAt: new Date("2026-02-02T09:00:00Z"),
        },
        {
          _id: mockRun2Id,
          name: "Run 2",
          owner: "testuser", // not in group, but is owner
          status: "complete",
          md5VerificationStatus: "pending",
          md5VerificationAttempts: 0,
          md5VerificationLastAttempt: null,
          md5VerificationCompletedAt: null,
          group: new mongoose.Types.ObjectId(), // unauthorized group
          createdAt: new Date("2026-02-02T09:30:00Z"),
        },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockRuns),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [mockRun1Id.toString(), mockRun2Id.toString()] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("runs");
      expect(response.body).toHaveProperty("total", 2);
      expect(response.body.runs).toHaveLength(2);
      expect(response.body.runs[0]).toHaveProperty("runName", "Run 1");
      expect(response.body.runs[0]).toHaveProperty(
        "md5VerificationStatus",
        "complete",
      );
      expect(response.body.runs[1]).toHaveProperty("runName", "Run 2");
      expect(response.body.runs[1]).toHaveProperty(
        "md5VerificationStatus",
        "pending",
      );
      expect(response.body.missing).toEqual([]);
      expect(response.body.invalid).toEqual([]);
    });

    test("should reject request with no runIds", async () => {
      const response = await request(app).post("/runs/batch-status").send({});

      expect(response.status).toBe(400);
    });

    test("should reject request with non-array runIds", async () => {
      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: "not-an-array" });

      expect(response.status).toBe(400);
    });

    test("should reject request with >100 runIds", async () => {
      const tooManyIds = Array(101).fill(mockRun1Id.toString());
      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: tooManyIds });

      expect(response.status).toBe(400);
    });

    test("should filter out runs user cannot access and say which ids are absent", async () => {
      const unauthorizedGroupId = new mongoose.Types.ObjectId();
      const mockRuns = [
        {
          _id: mockRun1Id,
          name: "Accessible Run",
          group: mockGroupId,
          status: "complete",
          md5VerificationStatus: "complete",
          createdAt: new Date(),
        },
        {
          _id: mockRun2Id,
          name: "Unauthorized Run",
          group: unauthorizedGroupId,
          status: "complete",
          md5VerificationStatus: "complete",
          createdAt: new Date(),
        },
      ];

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockRuns),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [mockRun1Id.toString(), mockRun2Id.toString()] });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.runs).toHaveLength(1);
      expect(response.body.runs[0].runName).toBe("Accessible Run");

      // komondor-power reads a short `runs` array as a complete answer, so the
      // dropped id has to be named rather than silently omitted.
      expect(response.body.requested).toBe(2);
      expect(response.body.missing).toEqual([mockRun2Id.toString()]);
    });

    test("should report ids that matched no run at all", async () => {
      const unknownId = new mongoose.Types.ObjectId().toString();

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [unknownId] });

      expect(response.status).toBe(200);
      expect(response.body.runs).toEqual([]);
      expect(response.body.missing).toEqual([unknownId]);
    });

    test("should echo requested ids exactly as they were submitted", async () => {
      // `missing` is matched back against the ids the caller sent, so an id
      // rewritten on the way through does not match anything it holds.
      // routes/projects.js and routes/samples.js narrow ids the same way and
      // neither rewrites the value.
      const upperCaseId = mockRun1Id.toString().toUpperCase();

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [upperCaseId] });

      expect(response.status).toBe(200);
      expect(response.body.missing).toEqual([upperCaseId]);
    });

    test("should not call a returned run missing when its id was sent in upper case", async () => {
      // Hex is case-insensitive to MongoDB, so this is the same id as the
      // lower-case one the run carries, and the two have to be matched as such.
      const upperCaseId = mockRun1Id.toString().toUpperCase();

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([
          {
            _id: mockRun1Id,
            name: "Run 1",
            group: mockGroupId,
            owner: "other_user",
            status: "complete",
            md5VerificationStatus: "complete",
            createdAt: new Date(),
          },
        ]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [upperCaseId, mockRun1Id.toString()] });

      expect(response.status).toBe(200);
      // The same id twice, in two cases, is one requested run.
      expect(response.body.requested).toBe(1);
      expect(response.body.runs).toHaveLength(1);
      expect(response.body.missing).toEqual([]);
    });

    test("should keep operators out of the query and report them as invalid", async () => {
      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [{ $ne: null }, mockRun1Id.toString()] });

      expect(response.status).toBe(200);
      expect(Run.find).toHaveBeenCalledWith({
        _id: { $in: [mockRun1Id.toString()] },
      });
      expect(response.body.invalid).toHaveLength(1);
    });

    test("should read the caller's groups once for the whole batch", async () => {
      const mockRuns = Array.from({ length: 5 }, (unused, index) => ({
        _id: new mongoose.Types.ObjectId(),
        name: `Run ${index}`,
        group: mockGroupId,
        status: "complete",
        md5VerificationStatus: "complete",
        createdAt: new Date(),
      }));

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockRuns),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: mockRuns.map((run) => run._id.toString()) });

      expect(response.status).toBe(200);
      expect(response.body.runs).toHaveLength(5);
      // Was one membership round-trip per run — up to a hundred per request.
      expect(Group.GroupsIAmIn).toHaveBeenCalledTimes(1);
    });
  });
});
