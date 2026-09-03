const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const runsRouter = require("../../routes/runs");
const Run = require("../../models/Run");
const Sample = require("../../models/Sample");
const LibraryType = require("../../models/options/LibraryType");
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
jest.mock("../../models/options/LibraryType");

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
  // Mirrors the real return shape: delivered names split per list, never
  // pooled. A raw read and an additional file may share a name.
  deliveredFileNames: jest
    .fn()
    .mockResolvedValue({ raw: new Set(), additional: new Set() }),
  idempotencyKeyFor: jest.fn((runId) => `run-ingest:${String(runId)}`),
  IngestJob: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../../routes/_utils", () => ({
  handleError: jest.fn((res, error, status, message) => {
    res.status(status).json({
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
    options.mode === "write" ? write : read
  );
};

/** A Sample.findById(...).select("group") that resolves to `sample`. */
const mockSampleLookup = (sample) => {
  Sample.findById = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(sample),
  });
};

/** A LibraryType.findOne(...).select("paired indexed") lookup. */
const mockLibraryTypeLookup = (libraryType) => {
  LibraryType.findOne = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(libraryType),
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
    const ORIGINAL_FULL_ACCESS = process.env.FULL_RECORDS_ACCESS_USERS;

    afterEach(() => {
      if (ORIGINAL_FULL_ACCESS === undefined) {
        delete process.env.FULL_RECORDS_ACCESS_USERS;
      } else {
        process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL_FULL_ACCESS;
      }
    });

    /** Stubs Run.iCanSee(...).populate().sort().exec(). */
    const mockICanSee = (runs) => {
      const chain = {
        populate: jest.fn(() => chain),
        sort: jest.fn(() => chain),
        exec: jest.fn().mockResolvedValue(runs),
      };
      Run.iCanSee = jest.fn(() => chain);
      return chain;
    };

    describe("the list is scoped to the caller's live groups", () => {
      // The scoping argument was unwatched: every test mocked iCanSee and
      // ignored what it was called with, so replacing
      // `await visibleGroupIds(req.user)` with `null` — null meaning "no filter
      // at all", i.e. every run in every group — kept the suite green.
      beforeEach(() => {
        // visibleGroupIds short-circuits to null for a full-access user, so the
        // list has to be empty for this to exercise the ordinary path.
        process.env.FULL_RECORDS_ACCESS_USERS = "[]";
      });

      test("should hand iCanSee the group ids resolved from the database", async () => {
        // Not the `groups` claim on the token: that is only as fresh as the
        // token, and a group soft-deleted since login must stop being visible.
        const liveGroupId = new mongoose.Types.ObjectId();
        setGroups({ read: [{ _id: liveGroupId }], write: [] });
        mockICanSee([]);

        const response = await request(app).get("/runs");

        expect(response.status).toBe(200);
        expect(Group.GroupsIAmIn).toHaveBeenCalledWith(expect.anything(), {
          mode: "read",
        });
        const [, groupIds] = Run.iCanSee.mock.calls[0];
        expect(groupIds.map(String)).toEqual([String(liveGroupId)]);
      });

      test("should hand iCanSee an empty list, not null, for a groupless caller", async () => {
        // [] means "belongs to nothing, match nothing"; null means "no filter".
        // The two are opposites, and conflating them turns a caller in no live
        // group into a reader of every group.
        setGroups({ read: [], write: [] });
        mockICanSee([]);

        const response = await request(app).get("/runs");

        expect(response.status).toBe(200);
        expect(Run.iCanSee.mock.calls[0][1]).toEqual([]);
      });
    });

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
    const singleRunId = new mongoose.Types.ObjectId();
    const runGroupId = new mongoose.Types.ObjectId();

    /** A Run.findById(...).populate() x4 .exec() that resolves to `run`. */
    const mockRunLookup = (run) => {
      const chain = { exec: jest.fn().mockResolvedValue(run) };
      chain.populate = jest.fn(() => chain);
      Run.findById = jest.fn(() => chain);
      return chain;
    };

    const buildRun = (overrides = {}) => ({
      _id: singleRunId,
      name: "Test Run",
      path: "group/project/sample/run",
      group: { _id: runGroupId, name: "Test Group" },
      owner: "other_user",
      rawFiles: [],
      additionalFiles: [],
      ...overrides,
    });

    beforeEach(() => {
      // The handler compares the run's files to its datastore directory, and
      // path.join throws on an undefined root.
      process.env.DATASTORE_ROOT = "/mnt/reads";
    });

    test("should return the run when the caller may read its group", async () => {
      setGroups({ read: [{ _id: runGroupId }], write: [] });
      mockRunLookup(buildRun());

      const response = await request(app).get(`/run?id=${singleRunId}`);

      expect(response.status).toBe(200);
      expect(response.body.run.name).toBe("Test Run");
    });

    test("should refuse a caller who cannot read the run's group", async () => {
      // Nothing in this suite exercised the 403: replacing the whole condition
      // with `if (false)` — deleting the refusal outright — changed no test.
      setGroups({ read: [{ _id: new mongoose.Types.ObjectId() }], write: [] });
      mockRunLookup(buildRun());

      const response = await request(app).get(`/run?id=${singleRunId}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/permission/i);
    });

    test("should refuse the run's owner when they cannot read its group", async () => {
      // The check used to read `if (!canAccess && !isOwner)`. `owner` is a
      // permanent grant no group change can withdraw, and on runs created
      // before it was stamped from the session it is a verbatim copy of
      // req.body — so an old record could name anybody and hand them a
      // cross-group read for good.
      setGroups({ read: [], write: [] });
      mockRunLookup(buildRun({ owner: "testuser" }));

      const response = await request(app).get(`/run?id=${singleRunId}`);

      expect(response.status).toBe(403);
    });

    test("should refuse a run whose group has been soft-deleted", async () => {
      // GroupsIAmIn omits soft-deleted groups for everybody, so a retired
      // group's runs become visible to nobody — including, now, their owner.
      setGroups({ read: [], write: [] });
      mockRunLookup(buildRun({ group: null, owner: "testuser" }));

      const response = await request(app).get(`/run?id=${singleRunId}`);

      expect(response.status).toBe(403);
    });

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
      // uploadName as well as name: createFileDocument builds the staged path
      // from uploadName for a local-filesystem claim, so a real client sends
      // both. Without it this fixture described a payload the worker rejects.
      rawFiles: [{ name: "test_R1.fq.gz", uploadName: "a".repeat(32) }],
      rawFilesUploadInfo: { method: "local-filesystem" },
      ...overrides,
    });

    beforeEach(() => {
      setGroups({
        read: [{ _id: mockGroupId, name: "Test Group" }],
        write: [{ _id: mockGroupId, name: "Test Group" }],
      });
      mockSampleLookup({ _id: mockSampleId, group: mockGroupId });
      mockLibraryTypeLookup({ value: "WGS", paired: false, indexed: false });
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
          existingRun._id.toString()
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
          expect.objectContaining({ runId: mockRunId })
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
            })
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
          })
        );
      });
    });

    describe("owner is the session, not the body", () => {
      beforeEach(() => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
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
          expect.objectContaining({ owner: "testuser" })
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
          expect.objectContaining({ runId: mockRunId })
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
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));
      });

      test("should queue the ingest and report its job id", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              additionalFiles: [
                { name: "notes.txt", uploadName: "b".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(201);
        // The 201 shape komondor-power parses is preserved; jobId is additive.
        expect(response.body).toHaveProperty("run");
        expect(response.body.jobId).toEqual(mockJobId.toString());

        expect(enqueueRunIngest).toHaveBeenCalledWith({
          runId: mockRunId,
          requestId: "test-request-id",
          payload: {
            rawFiles: [{ name: "test_R1.fq.gz", uploadName: "a".repeat(32) }],
            additionalFiles: [
              { name: "notes.txt", uploadName: "b".repeat(32) },
            ],
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

    describe("rawFiles / additionalFiles shape validation", () => {
      // `!x || x.length === 0` used to be the whole check: a plain object
      // with a numeric .length is truthy and has a length, so it passed and
      // reached the ingest job as-is instead of being refused at the door.
      test("should refuse a rawFiles that is truthy-with-a-length but not an array", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: { length: 2, 0: { name: "a" }, 1: { name: "b" } },
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
        expect(Run.findOne).not.toHaveBeenCalled();
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });

      test("should refuse a rawFiles entry missing a name", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                { name: "good_R1.fq.gz" },
                { uploadName: "no-name-here" },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/index 1/);
        expect(Sample.findById).not.toHaveBeenCalled();
        expect(enqueueRunIngest).not.toHaveBeenCalled();
      });

      test("should refuse a well-formed array with an entry that is not an object", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({ rawFiles: [{ name: "ok_R1.fq.gz" }, "not-a-file"] })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("should refuse an hpc-mv rawFiles entry with no relativePath anywhere", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [{ name: "hpc_R1.fq.gz" }],
              rawFilesUploadInfo: { method: "hpc-mv" },
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("should accept an hpc-mv rawFiles entry covered by rawFilesUploadInfo.relativePath", async () => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [{ name: "hpc_R1.fq.gz" }],
              rawFilesUploadInfo: {
                method: "hpc-mv",
                relativePath: "/WGS_Test",
              },
            })
          );

        expect(response.status).toBe(201);
      });

      test("should accept an explicit empty relativePath for a file at the HPC transfer root", async () => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [{ name: "at-transfer-root.fq.gz", relativePath: "" }],
              rawFilesUploadInfo: { method: "hpc-mv" },
            })
          );

        expect(response.status).toBe(201);
      });

      test("should refuse additionalFiles that is truthy-with-a-length but not an array", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({ additionalFiles: { length: 1, 0: { name: "n" } } })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("should refuse an additionalFiles entry missing a name", async () => {
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ additionalFiles: [{ notes: "oops" }] }));

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses an entry whose name is nested under data.name", async () => {
        // createFileDocument reads file.name only. This shape passed validation
        // and then failed inside the worker, stranding a durable job.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                { data: { name: "test_R1.fq.gz" }, uploadName: "a".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a local-filesystem entry with no uploadName", async () => {
        // The worker builds the staged path from uploadName for this method,
        // so an entry without one cannot be processed.
        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ rawFiles: [{ name: "test_R1.fq.gz" }] }));

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a non-string md5", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "test_R1.fq.gz",
                  uploadName: "a".repeat(32),
                  md5: { $ne: null },
                },
              ],
            })
          );

        expect(response.status).toBe(400);
      });

      test("refuses two entries sharing one name", async () => {
        // Name is the identity the retry planner matches delivered files on,
        // so a duplicate makes delivery state ambiguous.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                { name: "dup.fq.gz", uploadName: "a".repeat(32) },
                { name: "dup.fq.gz", uploadName: "b".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses an entry marked paired with no sibling", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  paired: true,
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a rowID that is a lone entry, not a pair", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
      });

      test("refuses a rowID shared by three entries", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
                {
                  name: "R3.fq.gz",
                  uploadName: "c".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
      });

      test("refuses rowID even when exactly two entries share it", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  paired: true,
                  rowID: "row-1",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/unsupported rowID/i);
      });

      test("refuses a paired library whose non-index reads are not paired", async () => {
        mockLibraryTypeLookup({
          value: "Paired-end",
          paired: true,
          indexed: false,
        });

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              libraryType: "Paired-end",
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  paired: false,
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  paired: false,
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/paired library requires/i);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("accepts a paired indexed library with a reciprocal pair and an unpaired index", async () => {
        mockLibraryTypeLookup({
          value: "Paired-indexed",
          paired: true,
          indexed: true,
        });
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              libraryType: "Paired-indexed",
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "R2.fq.gz",
                  paired: true,
                  indexed: false,
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  sibling: "R1.fq.gz",
                  paired: true,
                  indexed: false,
                },
                {
                  name: "I1.fq.gz",
                  uploadName: "c".repeat(32),
                  paired: false,
                  indexed: true,
                },
              ],
            })
          );

        expect(response.status).toBe(201);
      });

      test("refuses the Power shape that marks sibling reads as index reads", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              libraryType: "Paired-indexed",
              rawFilesUploadInfo: { method: "hpc-mv" },
              // Power can currently produce this from one CSV row containing
              // read_isIndex=TRUE plus read_siblingFullHpcPath. Index reads are
              // outside biological pairs and cannot name each other as mates.
              rawFiles: [
                {
                  name: "index_R1.fq.gz",
                  relativePath: "batch",
                  indexed: true,
                  sibling: "index_R2.fq.gz",
                },
                {
                  name: "index_R2.fq.gz",
                  relativePath: "batch",
                  indexed: true,
                  sibling: "index_R1.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(
          /indexed read.*cannot declare a sibling/i
        );
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses an indexed library with no indexed raw file", async () => {
        mockLibraryTypeLookup({
          value: "Indexed",
          paired: false,
          indexed: true,
        });

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              libraryType: "Indexed",
              rawFiles: [
                {
                  name: "reads.fq.gz",
                  uploadName: "a".repeat(32),
                  indexed: false,
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/requires at least one indexed/i);
      });

      test("refuses an index read under a non-indexed library", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "index.fq.gz",
                  uploadName: "a".repeat(32),
                  indexed: true,
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/non-indexed library/i);
      });

      test("refuses a library type that is not in the shared option collection", async () => {
        mockLibraryTypeLookup(null);
        Run.findOne = jest.fn();

        const response = await request(app)
          .post("/runs/new")
          .send(requestBody({ libraryType: "invented-type" }));

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/unknown library type/i);
        expect(Run.findOne).not.toHaveBeenCalled();
      });

      test("refuses sibling declarations for an unpaired library", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "R2.fq.gz",
                  paired: true,
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  sibling: "R1.fq.gz",
                  paired: true,
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/unpaired library/i);
      });

      test("refuses a sibling that is not in the list", async () => {
        // An unresolvable sibling used to be logged and ignored, leaving the
        // run "complete" with a paired read that has no sibling.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "test_R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "never_uploaded_R2.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a file that names itself as its own sibling", async () => {
        // siblingLinks emits one directed [name, sibling] link per
        // declaration and asks nothing else of it, so a self-link was
        // accepted and the file was "paired" with itself. Reproduced against
        // a real Mongo and filesystem by a re-audit.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "R1.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a one-way sibling declaration", async () => {
        // A named B, B named nobody. Both files land, A's Read gets a
        // sibling and B's stays null — the run finishes "complete" half
        // paired, which is exactly the silent half-success this validation
        // exists to prevent.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "R2.fq.gz",
                },
                { name: "R2.fq.gz", uploadName: "b".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a three-file sibling cycle", async () => {
        // A→B→C→A. Every sibling resolves to a file that is present, so a
        // presence-only check passes it, but no two of them are a pair.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "A.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "B.fq.gz",
                },
                {
                  name: "B.fq.gz",
                  uploadName: "b".repeat(32),
                  sibling: "C.fq.gz",
                },
                {
                  name: "C.fq.gz",
                  uploadName: "c".repeat(32),
                  sibling: "A.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses two names that differ only in what safeBasename strips", async () => {
        // Validation compared raw strings; storage canonicalises with
        // safeBasename (lib/file-utils.js createFileDocument), which trims
        // and drops any directory part. So " R1.fq.gz" and "R1.fq.gz" were
        // two distinct files to the duplicate check and one file on disk —
        // a re-audit ran the retry and watched it reattempt an
        // already-delivered file and stay errored.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                { name: "R1.fq.gz", uploadName: "a".repeat(32) },
                { name: " R1.fq.gz", uploadName: "b".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a sibling that is not already a bare filename", async () => {
        // A review found the hole this closes. Validation canonicalised names
        // before comparing them, but lib/ingest-queue.js siblingLinks matches
        // the RAW payload string — so {name:"A.fq", sibling:" B.fq"} and
        // {name:"B.fq", sibling:"A.fq"} passed the mutuality check and then
        // delivered half-paired at runtime: A's link to " B.fq" never
        // resolved, B's to "A.fq" did, and the run finished "complete" with A
        // unpaired. Requiring the canonical form at the door is what makes
        // raw and canonical the same string everywhere downstream.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [
                {
                  name: "A.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: " B.fq.gz",
                },
                {
                  name: "B.fq.gz",
                  uploadName: "b".repeat(32),
                  sibling: "A.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("refuses a name that is not already a bare filename", async () => {
        // Same reason from the other side: lib/file-utils.js stores
        // safeBasename(name) while the retry planner matches the raw string,
        // so a delivered "A.fq" stored under a payload entry named " A.fq"
        // is re-attempted by every retry, forever.
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [{ name: " A.fq.gz", uploadName: "a".repeat(32) }],
            })
          );

        expect(response.status).toBe(400);
        expect(Sample.findById).not.toHaveBeenCalled();
      });

      test("accepts a complete sibling pair", async () => {
        mockLibraryTypeLookup({
          value: "Paired-end",
          paired: true,
          indexed: false,
        });
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              libraryType: "Paired-end",
              rawFiles: [
                {
                  name: "R1.fq.gz",
                  uploadName: "a".repeat(32),
                  sibling: "R2.fq.gz",
                },
                {
                  name: "R2.fq.gz",
                  uploadName: "b".repeat(32),
                  sibling: "R1.fq.gz",
                },
              ],
            })
          );

        expect(response.status).toBe(201);
      });

      test("should still succeed with a well-formed rawFiles and additionalFiles array", async () => {
        Run.findOne = jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        });
        Run.mockImplementation(() => ({
          save: jest
            .fn()
            .mockResolvedValue({ _id: mockRunId, name: "New Run" }),
        }));

        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              rawFiles: [{ name: "test_R1.fq.gz", uploadName: "a".repeat(32) }],
              additionalFiles: [
                { name: "notes.txt", uploadName: "b".repeat(32) },
              ],
            })
          );

        expect(response.status).toBe(201);
      });

      test("refuses an unsupported additional-file upload method", async () => {
        const response = await request(app)
          .post("/runs/new")
          .send(
            requestBody({
              additionalFiles: [
                { name: "notes.txt", uploadMethod: "teleport" },
              ],
            })
          );

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/invalid uploadMethod/i);
        expect(Sample.findById).not.toHaveBeenCalled();
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
        "in_progress"
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
        })
      );
    });

    test("a status response never carries the job payload", async () => {
      // An IngestJob's payload is the whole submitted file list. Two separate
      // things keep it out of a status response — the projection in
      // INGEST_JOB_FIELDS and the allowlist in summariseIngestJob — and this
      // pins the observable half: whatever the query returns, the client is
      // not shown it.
      //
      // Deliberately handed a job that DOES carry a payload, which is what the
      // query would return if the projection were ever dropped.
      const jobId = new mongoose.Types.ObjectId();
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: mockGroupId,
        status: "queued",
        md5VerificationStatus: "pending",
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
            status: "pending",
            attempts: 0,
            maxAttempts: 3,
            payload: {
              rawFiles: [{ name: "secret.fq", uploadName: "abc123" }],
              username: "someone-else",
            },
            createdAt: new Date("2026-02-02T09:00:00Z"),
            updatedAt: new Date("2026-02-02T09:00:00Z"),
          },
        ]),
      });

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(200);
      expect(response.body.ingest).not.toHaveProperty("payload");
      expect(Object.keys(response.body.ingest).sort()).toEqual([
        "attempts",
        "jobId",
        "lastError",
        "maxAttempts",
        "queuedAt",
        "status",
        "updatedAt",
      ]);
    });

    test("the ingest lookup asks the database for no more than it reports", async () => {
      // The other half, and the reason the test above is not enough on its
      // own: summariseIngestJob's allowlist means the payload stays out of the
      // response even if the projection is deleted, so the response cannot
      // witness the projection. This asserts the query shape directly —
      // nothing that is not reported is fetched, so a payload never reaches
      // process memory to be leaked by some later change to the summariser.
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: mockGroupId,
        status: "queued",
        md5VerificationStatus: "pending",
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

      const select = jest.fn().mockResolvedValue([]);
      IngestJob.find.mockReturnValue({ select });

      await request(app).get(`/runs/${mockRunId}/status`);

      expect(select).toHaveBeenCalledTimes(1);
      const projection = select.mock.calls[0][0];
      // An inclusion projection, so the fields are named rather than excluded
      // — a mongoose projection of undefined or "" would fetch the whole
      // document, payload included.
      expect(typeof projection).toBe("string");
      expect(projection.trim()).not.toBe("");
      expect(projection).not.toMatch(/payload/);
      expect(projection.split(/\s+/).filter(Boolean).sort()).toEqual([
        "attempts",
        "createdAt",
        "lastError",
        "maxAttempts",
        "runId",
        "status",
        "updatedAt",
      ]);
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

    test("should refuse the run's owner when they cannot read its group", async () => {
      // UPDATED: this used to assert a 200. The status check read
      // `if (!canAccess && !isOwner)`, which let anybody named in a run's
      // `owner` field read its status from outside every group it belongs to —
      // and `owner` was client-supplied on every run created before this
      // branch. Ownership is no longer a grant anywhere; see GET /run.
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

      expect(response.status).toBe(403);
    });

    test("the authorisation decision never reads the run's owner field", async () => {
      // A second angle on the removal asserted just above, deliberately not
      // shaped like it. That test says the answer is 403; this one says
      // `owner` is not an input to the answer at all — so a re-introduced
      // clause is caught by the read itself, and the two tests fail
      // independently rather than as one assertion in two places.
      let ownerReads = 0;
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        group: new mongoose.Types.ObjectId(), // a group the caller cannot read
        status: "complete",
        statusError: null,
        md5VerificationStatus: "in_progress",
      };
      Object.defineProperty(mockRun, "owner", {
        enumerable: true,
        configurable: true,
        get() {
          ownerReads += 1;
          return "testuser"; // the caller, so a restored clause would match
        },
      });

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

      expect(ownerReads).toBe(0);
      expect(response.status).toBe(403);
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
        libraryType: "single",
      });
      mockLibraryTypeLookup({
        value: "single",
        paired: false,
        indexed: false,
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
        expect.objectContaining({ status: "pending", attempts: 0 })
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
        { $set: { status: "pending", statusError: null } }
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
          expect.objectContaining({ runId: mockRunId })
        );
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      } finally {
        delete ingestQueue.requeueRunIngest;
      }
    });

    describe("replacement payload", () => {
      const correctedPayload = {
        rawFiles: [{ name: "corrected_R1.fq.gz", uploadName: "abc123" }],
        rawFilesUploadInfo: { method: "local-filesystem" },
      };

      test("with no body, behaves exactly as today: it replays the existing payload", async () => {
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({});

        expect(response.status).toBe(200);
        const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
        expect(update.$set).not.toHaveProperty("payload");
      });

      test("replaces the job's stored payload when a corrected one is supplied", async () => {
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
          payload: { ...correctedPayload, username: "testuser" },
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send(correctedPayload);

        expect(response.status).toBe(200);
        const [filter, update] = IngestJob.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual(expect.objectContaining({ status: "failed" }));
        expect(update.$set.payload).toEqual(
          expect.objectContaining({
            rawFiles: correctedPayload.rawFiles,
            rawFilesUploadInfo: correctedPayload.rawFilesUploadInfo,
            // Whoever supplied the fix is whose staged uploads the retry
            // claims, same rule as a fresh POST /runs/new.
            username: "testuser",
          })
        );
      });

      test("does not delegate to the queue's own reset when replacing a payload", async () => {
        // Today's requeueRunIngest export takes no payload; delegating to it
        // anyway would silently serve the old payload back instead of the fix.
        const requeueRunIngest = jest
          .fn()
          .mockResolvedValue({ _id: mockJobId });
        ingestQueue.requeueRunIngest = requeueRunIngest;

        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });

        try {
          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send(correctedPayload);

          expect(response.status).toBe(200);
          expect(requeueRunIngest).not.toHaveBeenCalled();
          expect(IngestJob.findOneAndUpdate).toHaveBeenCalled();
        } finally {
          delete ingestQueue.requeueRunIngest;
        }
      });

      test("refuses a malformed replacement payload and does not touch the job", async () => {
        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            rawFiles: [{ uploadName: "no-name-here" }],
            rawFilesUploadInfo: { method: "local-filesystem" },
          });

        expect(response.status).toBe(400);
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });

      test("requires explicit replacement-mode flags to be booleans", async () => {
        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({ replaceRawFiles: "yes" });

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(
          /replaceRawFiles must be a boolean/
        );
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });

      describe("a delivered file mixed with an undelivered correction", () => {
        // The scenario a re-audit flagged as the real-world case that matters:
        // a paired submission where one file landed and its sibling failed
        // because of a bad upload id. Fixing just the broken one should not
        // require also resubmitting the one that already worked, and must not
        // silently drop or silently reapply either.
        //
        // These entries carry reciprocal `sibling`/`paired` metadata for a
        // reason. An earlier
        // version of this fixture called itself "a paired submission" and
        // declared neither — so the one-mate correction below never reached
        // the pairing rules at all, and the 400 they returned on exactly this
        // workflow went unnoticed until a re-audit ran it over real HTTP.
        // The mismatch between a fixture's stated intent and its actual
        // content is the whole failure mode; keep these fields.
        const originalRawFiles = [
          {
            name: "delivered_R1.fq.gz",
            uploadName: "good-upload-id",
            paired: true,
            sibling: "broken_R2.fq.gz",
          },
          {
            name: "broken_R2.fq.gz",
            uploadName: "bad-upload-id",
            paired: true,
            sibling: "delivered_R1.fq.gz",
          },
        ];

        beforeEach(() => {
          ingestQueue.deliveredFileNames.mockResolvedValueOnce({
            raw: new Set(["delivered_R1.fq.gz"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: originalRawFiles,
              rawFilesUploadInfo: { method: "local-filesystem" },
            },
          });
        });

        const usePairedRun = () => {
          mockRunLookup({
            _id: mockRunId,
            name: "Broken paired Run",
            group: mockGroupId,
            owner: "testuser",
            status: "error",
            libraryType: "paired",
          });
          mockLibraryTypeLookup({
            value: "paired",
            paired: true,
            indexed: false,
          });
        };

        test("carries the delivered file forward unchanged when the correction omits it", async () => {
          usePairedRun();
          IngestJob.findOneAndUpdate.mockResolvedValue({
            _id: mockJobId,
            status: "pending",
            attempts: 0,
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                {
                  name: "broken_R2.fq.gz",
                  uploadName: "corrected-upload-id",
                  paired: true,
                  sibling: "delivered_R1.fq.gz",
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            });

          expect(response.status).toBe(200);
          const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
          expect(update.$set.payload.rawFiles).toEqual(
            expect.arrayContaining([
              originalRawFiles[0], // delivered_R1.fq.gz, untouched
              expect.objectContaining({
                name: "broken_R2.fq.gz",
                uploadName: "corrected-upload-id",
              }),
            ])
          );
        });

        test("accepts an identical resubmission of the delivered file alongside the correction", async () => {
          usePairedRun();
          // A client naturally resends its whole known state, not just the
          // diff — resubmitting the delivered entry byte-for-byte must not
          // be treated as an attempted change.
          IngestJob.findOneAndUpdate.mockResolvedValue({
            _id: mockJobId,
            status: "pending",
            attempts: 0,
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                originalRawFiles[0], // resent unchanged
                {
                  name: "broken_R2.fq.gz",
                  uploadName: "corrected-upload-id",
                  paired: true,
                  sibling: "delivered_R1.fq.gz",
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            });

          expect(response.status).toBe(200);
        });

        test("refuses a resubmission that actually changes the delivered file's content", async () => {
          // The genuine hazard the merge exists to catch: the retry planner
          // matches delivered files by name and skips them, so a changed
          // uploadName/md5 under a delivered name would be a silent no-op if
          // accepted — it can neither be kept (that's not what the caller
          // asked for) nor applied (the file is already in the datastore).
          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                {
                  name: "delivered_R1.fq.gz",
                  uploadName: "DIFFERENT-upload-id",
                  paired: true,
                  sibling: "broken_R2.fq.gz",
                },
                {
                  name: "broken_R2.fq.gz",
                  uploadName: "corrected-upload-id",
                  paired: true,
                  sibling: "delivered_R1.fq.gz",
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            });

          expect(response.status).toBe(409);
          expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
        });

        test("renaming the undelivered mate can update the delivered file's sibling pointer", async () => {
          // hpc-mv pairs by naming a sibling. Renaming the file that has NOT
          // landed forces its delivered mate's pointer to change too, and a
          // re-audit found that left no legal payload at all: omit the
          // delivered mate and it still points at a name no longer in the
          // list (400); update the pointer and it counts as changing a
          // delivered file (409). The delivered file's BYTES are untouched
          // either way — only the link moves, and siblingLinks re-derives
          // every link from the merged list.
          ingestQueue.deliveredFileNames.mockReset();
          ingestQueue.deliveredFileNames.mockResolvedValue({
            raw: new Set(["landed_R1.fq"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: [
                { name: "landed_R1.fq", sibling: "typo_R2.fq" },
                { name: "typo_R2.fq", sibling: "landed_R1.fq" },
              ],
              rawFilesUploadInfo: {
                method: "hpc-mv",
                relativePath: "/WGS_Test",
              },
            },
          });
          IngestJob.findOneAndUpdate.mockResolvedValue({
            _id: mockJobId,
            status: "pending",
            attempts: 0,
          });
          usePairedRun();

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                { name: "landed_R1.fq", sibling: "correct_R2.fq" },
                { name: "correct_R2.fq", sibling: "landed_R1.fq" },
              ],
              rawFilesUploadInfo: {
                method: "hpc-mv",
                relativePath: "/WGS_Test",
              },
              // A list is patch-like by default. Renaming intentionally
              // removes the old undelivered name, so state that this is the
              // complete desired raw-file list.
              replaceRawFiles: true,
            });

          expect(response.status).toBe(200);
          const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
          expect(update.$set.payload.rawFiles).toEqual(
            expect.arrayContaining([
              { name: "landed_R1.fq", sibling: "correct_R2.fq" },
              { name: "correct_R2.fq", sibling: "landed_R1.fq" },
            ])
          );
        });

        test("still refuses a delivered file whose own bytes are being changed, sibling aside", async () => {
          // Excluding `sibling` from the comparison must not smuggle a real
          // content change past the guard.
          ingestQueue.deliveredFileNames.mockReset();
          ingestQueue.deliveredFileNames.mockResolvedValue({
            raw: new Set(["landed_R1.fq"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: [
                { name: "landed_R1.fq", md5: "aaa", sibling: "typo_R2.fq" },
                { name: "typo_R2.fq", md5: "bbb", sibling: "landed_R1.fq" },
              ],
              rawFilesUploadInfo: {
                method: "hpc-mv",
                relativePath: "/WGS_Test",
              },
            },
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                { name: "landed_R1.fq", md5: "CHANGED", sibling: "ok_R2.fq" },
                { name: "ok_R2.fq", md5: "bbb", sibling: "landed_R1.fq" },
              ],
              rawFilesUploadInfo: {
                method: "hpc-mv",
                relativePath: "/WGS_Test",
              },
            });

          expect(response.status).toBe(409);
          expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
        });

        test("detects a nested descriptor change on a delivered file", async () => {
          ingestQueue.deliveredFileNames.mockReset();
          ingestQueue.deliveredFileNames.mockResolvedValue({
            raw: new Set(["landed.fq"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: [
                {
                  name: "landed.fq",
                  uploadName: "upload-1",
                  data: { metadata: { source: "lane-1", chunks: [1, 2] } },
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            },
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                {
                  name: "landed.fq",
                  uploadName: "upload-1",
                  data: { metadata: { source: "lane-2", chunks: [1, 2] } },
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            });

          expect(response.status).toBe(409);
          expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
        });

        test("treats reordered nested keys as the same delivered descriptor", async () => {
          ingestQueue.deliveredFileNames.mockReset();
          ingestQueue.deliveredFileNames.mockResolvedValue({
            raw: new Set(["landed.fq"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: [
                {
                  name: "landed.fq",
                  uploadName: "upload-1",
                  data: {
                    z: 1,
                    metadata: { source: "lane-1", chunks: [1, 2] },
                  },
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            },
          });
          IngestJob.findOneAndUpdate.mockResolvedValue({
            _id: mockJobId,
            status: "pending",
            attempts: 0,
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              rawFiles: [
                {
                  data: {
                    metadata: { chunks: [1, 2], source: "lane-1" },
                    z: 1,
                  },
                  uploadName: "upload-1",
                  name: "landed.fq",
                },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            });

          expect(response.status).toBe(200);
        });

        test("a delivered raw file does not block an undelivered additional file of the same name", async () => {
          // Reproduced by a re-audit: delivered names were pooled into ONE
          // set across both lists, so a delivered raw "shared.fastq" made an
          // undelivered ADDITIONAL "shared.fastq" un-correctable — a 409 on a
          // reingest that never touched the delivered file. They are separate
          // rows with separate destinations, planned separately; they share a
          // namespace, not an identity.
          ingestQueue.deliveredFileNames.mockReset();
          ingestQueue.deliveredFileNames.mockResolvedValue({
            raw: new Set(["shared.fastq"]),
            additional: new Set(),
          });
          mockJobLookup({
            _id: mockJobId,
            payload: {
              rawFiles: [{ name: "shared.fastq", uploadName: "raw-up" }],
              additionalFiles: [
                { name: "shared.fastq", uploadName: "bad-additional-up" },
              ],
              rawFilesUploadInfo: { method: "local-filesystem" },
            },
          });
          IngestJob.findOneAndUpdate.mockResolvedValue({
            _id: mockJobId,
            status: "pending",
            attempts: 0,
          });

          const response = await request(app)
            .post(`/runs/${mockRunId}/reingest`)
            .send({
              additionalFiles: [
                { name: "shared.fastq", uploadName: "corrected-additional-up" },
              ],
            });

          expect(response.status).toBe(200);
          const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
          expect(update.$set.payload.additionalFiles).toEqual([
            { name: "shared.fastq", uploadName: "corrected-additional-up" },
          ]);
          // The delivered RAW entry of the same name is untouched.
          expect(update.$set.payload.rawFiles).toEqual([
            { name: "shared.fastq", uploadName: "raw-up" },
          ]);
        });
      });

      test("refuses a replacement payload that names the same file twice", async () => {
        // A review reproduced this: the duplicate-name check was moved behind
        // the whole-list gate along with the pairing rules, but a duplicate
        // is a defect in the SUBMISSION, not a statement about entries the
        // caller did not send. Worse than merely permissive —
        // mergeReplacementList indexes by name into a Map, so the two
        // collapsed LAST-WINS and the merged list looked clean to the
        // re-validation afterwards. A client that double-adds a correction
        // (a double-click, a script appending to a list it already has) got
        // 200 with the second copy silently winning.
        ingestQueue.deliveredFileNames.mockReset();
        ingestQueue.deliveredFileNames.mockResolvedValue({
          raw: new Set(),
          additional: new Set(),
        });
        mockJobLookup({
          _id: mockJobId,
          payload: {
            rawFiles: [{ name: "A.fq", uploadName: "u1" }],
            rawFilesUploadInfo: { method: "local-filesystem" },
          },
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            rawFiles: [
              { name: "A.fq", uploadName: "corrected" },
              { name: "A.fq", uploadName: "OOPS-second" },
            ],
            rawFilesUploadInfo: { method: "local-filesystem" },
          });

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/appears more than once/i);
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });

      test("refuses to unpair a delivered read while the Run's LibraryType is paired", async () => {
        // Relationship reconciliation can mechanically clear a pointer, but
        // reingest must not use that ability to leave a paired Run complete
        // with unpaired Reads. Changing LibraryType is a separate authorised
        // metadata workflow.
        ingestQueue.deliveredFileNames.mockReset();
        ingestQueue.deliveredFileNames.mockResolvedValue({
          raw: new Set(["landed_R1.fq"]),
          additional: new Set(),
        });
        mockJobLookup({
          _id: mockJobId,
          payload: {
            rawFiles: [
              {
                name: "landed_R1.fq",
                sibling: "gone_R2.fq",
                paired: true,
              },
              {
                name: "gone_R2.fq",
                sibling: "landed_R1.fq",
                paired: true,
              },
            ],
            rawFilesUploadInfo: {
              method: "hpc-mv",
              relativePath: "/WGS_Test",
            },
          },
        });
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });
        mockRunLookup({
          _id: mockRunId,
          name: "Broken paired Run",
          group: mockGroupId,
          owner: "testuser",
          status: "error",
          libraryType: "paired",
        });
        mockLibraryTypeLookup({
          value: "paired",
          paired: true,
          indexed: false,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            // Exact Web unpair shape: paired:false and no sibling.
            rawFiles: [{ name: "landed_R1.fq", paired: false }],
            rawFilesUploadInfo: {
              method: "hpc-mv",
              relativePath: "/WGS_Test",
            },
            replaceRawFiles: true,
          });

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/paired library requires/i);
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });

      test("a partial correction retains every omitted undelivered raw file", async () => {
        const originalRawFiles = [
          {
            name: "partial_R1.fq",
            uploadName: "good-r1",
            paired: true,
            sibling: "partial_R2.fq",
            indexed: false,
          },
          {
            name: "partial_R2.fq",
            uploadName: "bad-r2",
            paired: true,
            sibling: "partial_R1.fq",
            indexed: false,
          },
          {
            name: "partial_I1.fq",
            uploadName: "bad-i1",
            paired: false,
            indexed: true,
          },
        ];
        ingestQueue.deliveredFileNames.mockReset();
        ingestQueue.deliveredFileNames.mockResolvedValue({
          raw: new Set(["partial_R1.fq"]),
          additional: new Set(),
        });
        mockJobLookup({
          _id: mockJobId,
          payload: {
            rawFiles: originalRawFiles,
            rawFilesUploadInfo: { method: "local-filesystem" },
          },
        });
        mockRunLookup({
          _id: mockRunId,
          name: "Broken paired-indexed Run",
          group: mockGroupId,
          owner: "testuser",
          status: "error",
          libraryType: "paired-indexed",
        });
        mockLibraryTypeLookup({
          value: "paired-indexed",
          paired: true,
          indexed: true,
        });
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            rawFiles: [
              {
                ...originalRawFiles[1],
                uploadName: "corrected-r2",
              },
            ],
            rawFilesUploadInfo: { method: "local-filesystem" },
          });

        expect(response.status).toBe(200);
        const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
        expect(update.$set.payload.rawFiles).toEqual(
          expect.arrayContaining([
            originalRawFiles[0],
            expect.objectContaining({
              name: "partial_R2.fq",
              uploadName: "corrected-r2",
            }),
            originalRawFiles[2],
          ])
        );
        expect(update.$set.payload.rawFiles).toHaveLength(3);
      });

      test("an explicit full replacement still cannot violate the Run's indexed type", async () => {
        const originalRawFiles = [
          {
            name: "full_R1.fq",
            uploadName: "good-r1",
            paired: true,
            sibling: "full_R2.fq",
          },
          {
            name: "full_R2.fq",
            uploadName: "bad-r2",
            paired: true,
            sibling: "full_R1.fq",
          },
          {
            name: "full_I1.fq",
            uploadName: "bad-i1",
            paired: false,
            indexed: true,
          },
        ];
        ingestQueue.deliveredFileNames.mockReset();
        ingestQueue.deliveredFileNames.mockResolvedValue({
          raw: new Set(["full_R1.fq"]),
          additional: new Set(),
        });
        mockJobLookup({
          _id: mockJobId,
          payload: {
            rawFiles: originalRawFiles,
            rawFilesUploadInfo: { method: "local-filesystem" },
          },
        });
        mockRunLookup({
          _id: mockRunId,
          name: "Broken paired-indexed Run",
          group: mockGroupId,
          owner: "testuser",
          status: "error",
          libraryType: "paired-indexed",
        });
        mockLibraryTypeLookup({
          value: "paired-indexed",
          paired: true,
          indexed: true,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            rawFiles: [
              {
                ...originalRawFiles[1],
                uploadName: "corrected-r2",
              },
            ],
            rawFilesUploadInfo: { method: "local-filesystem" },
            replaceRawFiles: true,
          });

        expect(response.status).toBe(400);
        expect(response.body.detail).toMatch(/requires at least one indexed/i);
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });

      test("a correction to only additionalFiles leaves rawFiles untouched, not dropped", async () => {
        // rawFiles is entirely absent from this submission — correcting the
        // OTHER list must not be read as "replace rawFiles with nothing".
        const originalRawFiles = [
          { name: "R1.fq.gz", uploadName: "up-1" },
          { name: "R2.fq.gz", uploadName: "up-2" },
        ];
        mockJobLookup({
          _id: mockJobId,
          payload: {
            rawFiles: originalRawFiles,
            rawFilesUploadInfo: { method: "local-filesystem" },
          },
        });
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({
            additionalFiles: [
              { name: "notes.txt", uploadName: "a".repeat(32) },
            ],
          });

        expect(response.status).toBe(200);
        const [, update] = IngestJob.findOneAndUpdate.mock.calls[0];
        expect(update.$set.payload.rawFiles).toEqual(originalRawFiles);
      });

      test("a plain reingest still works when files have been delivered", async () => {
        // Refusing the payload must not block the no-payload retry of the rest.
        ingestQueue.deliveredFileNames.mockResolvedValueOnce({
          raw: new Set(["already_delivered_R1.fq.gz"]),
          additional: new Set(),
        });
        IngestJob.findOneAndUpdate.mockResolvedValue({
          _id: mockJobId,
          status: "pending",
          attempts: 0,
        });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send({});

        expect(response.status).toBe(200);
      });

      test("is still refused to a caller without write access to the run's group", async () => {
        setGroups({ read: [{ _id: mockGroupId }], write: [] });

        const response = await request(app)
          .post(`/runs/${mockRunId}/reingest`)
          .send(correctedPayload);

        expect(response.status).toBe(403);
        expect(IngestJob.findOneAndUpdate).not.toHaveBeenCalled();
      });
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
          owner: "testuser",
          status: "complete",
          md5VerificationStatus: "pending",
          md5VerificationAttempts: 0,
          md5VerificationLastAttempt: null,
          md5VerificationCompletedAt: null,
          // UPDATED: this used to be a group the caller is not in, and the run
          // was returned anyway because it named them as `owner`. Ownership is
          // no longer a grant, so a run in the caller's own group is what makes
          // this a test of the batch shape rather than of the filter.
          group: mockGroupId,
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
        "complete"
      );
      expect(response.body.runs[1]).toHaveProperty("runName", "Run 2");
      expect(response.body.runs[1]).toHaveProperty(
        "md5VerificationStatus",
        "pending"
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

    test("the batch filter never reads a run's owner field", async () => {
      // A second angle on the removal asserted below, shaped differently on
      // purpose: that test says the run is absent from the response, this one
      // says `owner` was never an input to deciding so. A re-introduced
      // `|| run.owner === req.user.username` has to read the field to compare
      // it, so it trips here regardless of what the response then contains.
      let ownerReads = 0;
      const run = {
        _id: mockRun1Id,
        name: "Someone Else's Run",
        group: new mongoose.Types.ObjectId(), // not a group the caller reads
        status: "complete",
        md5VerificationStatus: "complete",
        createdAt: new Date(),
      };
      Object.defineProperty(run, "owner", {
        enumerable: true,
        configurable: true,
        get() {
          ownerReads += 1;
          return "testuser";
        },
      });

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([run]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [mockRun1Id.toString()] });

      expect(ownerReads).toBe(0);
      expect(response.body.runs).toHaveLength(0);
    });

    test("the batch query does not even fetch owner from the database", async () => {
      // The third angle, and the only one that is about the query rather than
      // about the handler: `owner` is not in the projection, so a clause that
      // tried to consult it would be reading undefined rather than a stale
      // grant. Asserting the projection makes that explicit instead of
      // incidental, and it fails for a reason neither behavioural test can.
      const select = jest.fn().mockResolvedValue([]);
      Run.find = jest.fn().mockReturnValue({ select });

      await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [mockRun1Id.toString()] });

      expect(select).toHaveBeenCalledTimes(1);
      const projection = select.mock.calls[0][0];
      // A named inclusion list: undefined or "" would fetch whole documents,
      // owner included.
      expect(typeof projection).toBe("string");
      expect(projection.trim()).not.toBe("");
      const fields = projection.split(/\s+/).filter(Boolean);
      expect(fields).not.toContain("owner");
      // `group` is what the filter actually decides on, so it has to be here —
      // otherwise every run would be invisible for the wrong reason and this
      // test would pass on a broken endpoint.
      expect(fields).toContain("group");
    });

    test("should not return a run in another group because it names the caller as owner", async () => {
      // The filter used to read `readableGroups.has(...) || run.owner ===
      // req.user.username`, so one un-revocable string on a historical run —
      // `owner` was copied out of req.body until this branch — pulled it into a
      // batch the caller could otherwise not see. `owner` is not even selected
      // any more.
      const unauthorizedGroupId = new mongoose.Types.ObjectId();

      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([
          {
            _id: mockRun1Id,
            name: "Someone Else's Run",
            group: unauthorizedGroupId,
            owner: "testuser",
            status: "complete",
            md5VerificationStatus: "complete",
            createdAt: new Date(),
          },
        ]),
      });

      const response = await request(app)
        .post("/runs/batch-status")
        .send({ runIds: [mockRun1Id.toString()] });

      expect(response.status).toBe(200);
      expect(response.body.runs).toHaveLength(0);
      // Reported absent rather than refused: saying which of "no such run" and
      // "not yours" it was would make this an existence oracle.
      expect(response.body.missing).toEqual([mockRun1Id.toString()]);
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
