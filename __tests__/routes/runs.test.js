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
});
