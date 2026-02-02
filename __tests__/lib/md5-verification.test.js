const mongoose = require("mongoose");

// Mock dependencies before requiring the module
jest.mock("../../models/Run");
jest.mock("../../models/Read");
jest.mock("../../lib/utils/md5");

const Run = require("../../models/Run");
const Read = require("../../models/Read");
const { calculateFileMd5 } = require("../../lib/utils/md5");
const {
  verifyRunMd5,
  verifyReadMd5,
  findRunsNeedingVerification,
  cleanupStalePendingRuns,
  MAX_RETRY_ATTEMPTS,
} = require("../../lib/md5-verification");

describe("MD5 Verification", () => {
  const mockRunId = new mongoose.Types.ObjectId();
  const mockReadId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATASTORE_ROOT = "/mnt/reads";
    process.env.SKIP_MD5_VERIFICATION = "false";
  });

  describe("verifyRunMd5", () => {
    test("should skip verification when SKIP_MD5_VERIFICATION is true", async () => {
      process.env.SKIP_MD5_VERIFICATION = "true";

      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      const result = await verifyRunMd5(mockRunId);

      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
        mockRunId,
        expect.objectContaining({
          $set: expect.objectContaining({
            md5VerificationStatus: "complete",
          }),
        }),
      );
    });

    test("should verify all reads and return success", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        getRelativePath: jest.fn().mockResolvedValue("group/project/sample/run"),
      };

      const mockReads = [
        {
          _id: mockReadId,
          MD5: "abc123",
          file: { originalName: "file1.fastq" },
        },
      ];

      Run.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        mockResolvedValue: mockRun,
      });

      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockReads),
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      calculateFileMd5.mockResolvedValue("abc123");

      // Make Run.findById properly return the mock
      Run.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      const result = await verifyRunMd5(mockRunId);

      expect(result.success).toBe(true);
      expect(result.filesVerified).toBe(1);
      expect(result.mismatches).toBe(0);
      expect(Read.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReadId,
        expect.objectContaining({
          $set: expect.objectContaining({
            md5Mismatch: false,
          }),
        }),
      );
    });

    test("should detect MD5 mismatches", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        getRelativePath: jest.fn().mockResolvedValue("group/project/sample/run"),
      };

      const mockReads = [
        {
          _id: mockReadId,
          MD5: "abc123",
          file: { originalName: "file1.fastq" },
        },
      ];

      Run.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });

      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Read.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockReads),
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // Simulate MD5 mismatch
      calculateFileMd5.mockResolvedValue("different123");

      const result = await verifyRunMd5(mockRunId);

      expect(result.success).toBe(true);
      expect(result.mismatches).toBe(1);
      expect(Read.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReadId,
        expect.objectContaining({
          $set: expect.objectContaining({
            md5Mismatch: true,
          }),
        }),
      );
    });

    test("should handle errors and update retry count", async () => {
      Run.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("Database error")),
        }),
      });

      Run.findById.mockResolvedValue({
        md5VerificationAttempts: 1,
      });

      const result = await verifyRunMd5(mockRunId);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe("findRunsNeedingVerification", () => {
    test("should find runs with pending verification", async () => {
      const mockRuns = [
        { _id: "run1", name: "Run 1" },
        { _id: "run2", name: "Run 2" },
      ];

      Run.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockRuns),
      });

      const result = await findRunsNeedingVerification(10);

      expect(result).toEqual(mockRuns);
      expect(Run.find).toHaveBeenCalledWith(
        expect.objectContaining({
          md5VerificationStatus: "pending",
          status: "complete",
          md5VerificationAttempts: { $lt: MAX_RETRY_ATTEMPTS },
        }),
      );
    });
  });

  describe("cleanupStalePendingRuns", () => {
    test("should mark stale runs as error", async () => {
      const now = new Date();
      const staleRuns = [
        { _id: "run1", name: "Stale Run 1", createdAt: new Date(now - 25 * 60 * 60 * 1000) },
        { _id: "run2", name: "Stale Run 2", createdAt: new Date(now - 30 * 60 * 60 * 1000) },
      ];

      Run.find = jest.fn().mockResolvedValue(staleRuns);
      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      const result = await cleanupStalePendingRuns(24);

      expect(result.cleaned).toBe(2);
      expect(Run.findByIdAndUpdate).toHaveBeenCalledTimes(2);
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
        "run1",
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "error",
            md5VerificationStatus: "failed",
          }),
        }),
      );
    });
  });
});
