const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const runsRouter = require("../../routes/runs");
const Run = require("../../models/Run");
const { isAuthenticated } = require("../../routes/middleware");

// Mock the middleware
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: jest.fn((req, res, next) => {
    req.user = { username: "testuser", isAdmin: false, groups: ["group-123"] };
    next();
  }),
}));

// Mock the Run model
jest.mock("../../models/Run");

// Mock Group model for permission checks
jest.mock("../../models/Group", () => ({
  GroupsIAmIn: jest
    .fn()
    .mockResolvedValue([
      { _id: { toString: () => "group-123" }, name: "Test Group" },
    ]),
}));

// Mock other dependencies
jest.mock("../../lib/sortAssociatedFiles", () => ({
  sortAdditionalFiles: jest.fn().mockResolvedValue(true),
  sortReadFiles: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../lib/utils/sendOverseerEmail", () =>
  jest.fn().mockResolvedValue(true),
);

jest.mock("../../routes/_utils", () => ({
  handleError: jest.fn((res, error, status, message) => {
    res.status(status).json({ error: message || error.message });
  }),
  getActualFiles: jest.fn().mockResolvedValue([]),
}));

const app = express();
app.use(express.json());
app.use("/", runsRouter);

describe("Runs API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /runs/names/:sampleId", () => {
    const mockSampleId = new mongoose.Types.ObjectId().toString();

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

    test("should handle invalid sample ID format", async () => {
      Run.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockRejectedValue(new Error("Invalid ObjectId format")),
        }),
      });

      const response = await request(app).get("/runs/names/invalid-id");

      expect(response.status).toBe(500);
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

  describe("POST /runs/new - Idempotency", () => {
    const mockSampleId = new mongoose.Types.ObjectId();
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockRunId = new mongoose.Types.ObjectId();

    test("should return existing run when duplicate is detected (idempotent)", async () => {
      const existingRun = {
        _id: mockRunId,
        sample: mockSampleId,
        name: "Duplicate Run",
        status: "complete",
        md5VerificationStatus: "complete",
        rawFiles: [],
        additionalFiles: [],
      };

      // Mock findOne to return existing run
      Run.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(existingRun),
      });

      const requestBody = {
        sample: mockSampleId.toString(),
        name: "Duplicate Run",
        sequencingProvider: "Test Provider",
        sequencingTechnology: "Illumina",
        librarySource: "GENOMIC",
        libraryType: "WGS",
        librarySelection: "RANDOM",
        libraryStrategy: "WGS",
        owner: "testuser",
        group: mockGroupId.toString(),
        rawFiles: [],
        rawFilesUploadInfo: { method: "local-filesystem" },
      };

      const response = await request(app).post("/runs/new").send(requestBody);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("idempotent", true);
      expect(response.body).toHaveProperty("message");
      expect(response.body.run._id).toEqual(existingRun._id);
      expect(Run.findOne).toHaveBeenCalledWith({
        sample: mockSampleId.toString(),
        name: "Duplicate Run",
      });
    });

    test("should create new run when no duplicate exists", async () => {
      // Mock findOne to return null (no existing run)
      Run.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      const mockNewRun = {
        _id: mockRunId,
        sample: mockSampleId,
        name: "New Run",
        save: jest.fn().mockResolvedValue({
          _id: mockRunId,
          name: "New Run",
        }),
      };

      Run.mockImplementation(() => mockNewRun);

      const requestBody = {
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
        rawFiles: [],
        rawFilesUploadInfo: { method: "local-filesystem" },
      };

      const response = await request(app).post("/runs/new").send(requestBody);

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty("idempotent");
      expect(Run.findOne).toHaveBeenCalledWith({
        sample: mockSampleId.toString(),
        name: "New Run",
      });
    });
  });

  describe("GET /runs/:id/status", () => {
    const mockRunId = new mongoose.Types.ObjectId();
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockReadId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      require("../../models/Group").GroupsIAmIn.mockResolvedValue([
        { _id: mockGroupId, name: "Test Group" },
      ]);
    });

    test("should return detailed status for a run", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        status: "complete",
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
        populate: jest.fn().mockReturnThis(),
        mockResolvedValue: mockRun,
      });

      Run.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockRun),
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

    test("should return 404 when run not found", async () => {
      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
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
      };

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        mockResolvedValue: mockRun,
      });

      Run.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockRun),
      });

      // User doesn't have access to unauthorizedGroupId
      require("../../models/Group").GroupsIAmIn.mockResolvedValue([
        { _id: mockGroupId, name: "Test Group" },
      ]);

      const response = await request(app).get(`/runs/${mockRunId}/status`);

      expect(response.status).toBe(403);
    });
  });

  describe("POST /runs/batch-status", () => {
    const mockGroupId = new mongoose.Types.ObjectId();
    const mockRun1Id = new mongoose.Types.ObjectId();
    const mockRun2Id = new mongoose.Types.ObjectId();
    const mockRun3Id = new mongoose.Types.ObjectId();

    beforeEach(() => {
      require("../../models/Group").GroupsIAmIn.mockResolvedValue([
        { _id: mockGroupId, name: "Test Group" },
      ]);
    });

    test("should return status for multiple runs", async () => {
      const mockRuns = [
        {
          _id: mockRun1Id,
          name: "Run 1",
          status: "complete",
          md5VerificationStatus: "complete",
          md5VerificationAttempts: 1,
          md5VerificationLastAttempt: new Date("2026-02-02T10:00:00Z"),
          md5VerificationCompletedAt: new Date("2026-02-02T10:30:00Z"),
          group: mockGroupId,
          createdAt: new Date("2026-02-02T09:00:00Z"),
        },
        {
          _id: mockRun2Id,
          name: "Run 2",
          status: "complete",
          md5VerificationStatus: "pending",
          md5VerificationAttempts: 0,
          md5VerificationLastAttempt: null,
          md5VerificationCompletedAt: null,
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
        "complete",
      );
      expect(response.body.runs[1]).toHaveProperty("runName", "Run 2");
      expect(response.body.runs[1]).toHaveProperty(
        "md5VerificationStatus",
        "pending",
      );
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

    test("should filter out runs user cannot access", async () => {
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
    });
  });
});
