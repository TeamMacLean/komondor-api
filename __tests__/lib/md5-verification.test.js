const mongoose = require("mongoose");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Mock dependencies before requiring the module
jest.mock("../../models/Run");
jest.mock("../../models/Read");
jest.mock("../../models/Sample");
jest.mock("../../models/Project");
jest.mock("../../lib/utils/md5");

const Run = require("../../models/Run");
const Read = require("../../models/Read");
const Sample = require("../../models/Sample");
const Project = require("../../models/Project");
const { calculateFileMd5 } = require("../../lib/utils/md5");
// The unmocked hasher, for the one test whose subject is what the *open* does
// rather than what this module does with the digest. See the symlink-inside-
// the-datastore case below.
const { calculateFileMd5: realCalculateFileMd5 } = jest.requireActual(
  "../../lib/utils/md5",
);
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

  // A *real* directory, because the destination path is now resolved with
  // resolveWithinReal: it realpath()s the root to defeat symlink escapes, and
  // a root that does not exist cannot be vouched for, so "/mnt/reads" would
  // (correctly) refuse every read.
  let datastoreRoot;

  beforeAll(() => {
    datastoreRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "md5-verification-")),
    );
  });

  afterAll(() => {
    fs.rmSync(datastoreRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(path.join(datastoreRoot,"group"), {recursive:true,force:true});
    fs.mkdirSync(path.join(datastoreRoot,"group/project/sample/run/raw"), {recursive:true});
    fs.writeFileSync(path.join(datastoreRoot,"group/project/sample/run/raw/file1.fastq"), "test bytes");
    process.env.DATASTORE_ROOT = datastoreRoot;
    process.env.SKIP_MD5_VERIFICATION = "false";
    Run.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: mockRunId,
          name: "Test Run",
          sample: { project: { _id: new mongoose.Types.ObjectId(), path: "/group/project" } },
          getRelativePath: jest
            .fn()
            .mockResolvedValue("group/project/sample/run"),
        }),
      }),
    });
    Project.find = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });
    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });
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

    test("skips an archived project without changing checksum state", async () => {
      const now = new Date();
      Run.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: mockRunId,
            sample: {
              project: {
                _id: new mongoose.Types.ObjectId(),
                storage: {
                  state: "aws",
                  s3Uri: "s3://archive/group/project",
                  s3VerifiedAt: now,
                  hpcVerifiedAbsentAt: now,
                  archivedAt: now,
                },
              },
            },
          }),
        }),
      });

      const result = await verifyRunMd5(mockRunId);

      expect(result).toEqual({
        success: true,
        skipped: true,
        reason: "PROJECT_STORAGE_READ_ONLY",
      });
      expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(Read.find).not.toHaveBeenCalled();
      expect(calculateFileMd5).not.toHaveBeenCalled();
    });

    test("should verify all reads and return success", async () => {
      const mockRun = {
        _id: mockRunId,
        name: "Test Run",
        sample: { project: { _id: new mongoose.Types.ObjectId(), path: "/group/project" } },
        getRelativePath: jest
          .fn()
          .mockResolvedValue("group/project/sample/run"),
      };

      const mockReads = [
        {
          _id: mockReadId,
          MD5: "abc123",
          file: { originalName: "file1.fastq", path: "/group/project/sample/run/raw/file1.fastq" },
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
        sample: { project: { _id: new mongoose.Types.ObjectId(), path: "/group/project" } },
        getRelativePath: jest
          .fn()
          .mockResolvedValue("group/project/sample/run"),
      };

      const mockReads = [
        {
          _id: mockReadId,
          MD5: "abc123",
          file: { originalName: "file1.fastq", path: "/group/project/sample/run/raw/file1.fastq" },
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

      expect(result.success).toBe(false);
      expect(result.filesVerified).toBe(0);
      expect(result.mismatches).toBe(1);
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockRunId, {
        $set: expect.objectContaining({
          md5VerificationStatus: "failed",
          md5VerificationResult: expect.objectContaining({
            verified: 0,
            mismatches: 1,
          }),
        }),
      });
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

  describe("stored physical paths", () => {
    const run = () => ({_id: mockRunId, sample: {project: {_id: new mongoose.Types.ObjectId(), path: "/group/project"}}});
    const read = (storedPath) => ({_id: mockReadId, MD5: "abc123", file: {originalName: "historical.fastq.txt", path: storedPath}});
    beforeEach(() => { Read.findByIdAndUpdate = jest.fn().mockResolvedValue({}); calculateFileMd5.mockResolvedValue("abc123"); });
    test("uses processed location, retaining the old upload filename", async () => {
      const p = path.join(datastoreRoot,"group/project/sample/run/processed/actual.fastq");
      fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p,"processed bytes");
      const result = await verifyReadMd5(read("/group/project/sample/run/processed/actual.fastq"),run());
      expect(result.error).toBeUndefined(); expect(calculateFileMd5).toHaveBeenCalledWith(p);
    });
    test.each([undefined,"/other/project/file", "group/project/../other/file", "group/project/sample/../../file", "group/project/file\\escape", "group/project/file\0suffix"])("rejects absent, escaping or unsafe stored path %s", async stored => {
      const result=await verifyReadMd5(read(stored),run());
      expect(result.error).toBeDefined();expect(calculateFileMd5).not.toHaveBeenCalled();expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    test("does not fall back to an existing raw file when the stored path is missing", async () => {
      const result=await verifyReadMd5({...read("group/project/missing"),file:{path:"group/project/missing",originalName:"file1.fastq"}},run());
      expect(result.error).toBeDefined();expect(calculateFileMd5).not.toHaveBeenCalled();
    });
    test.each(["outside", "inside"])("refuses symlinks %s the datastore before hashing", async kind => {
      const target=kind==="outside"?__filename:path.join(datastoreRoot,"group/project/sample/run/raw/file1.fastq");
      const planted=path.join(datastoreRoot,"group/project/link");fs.symlinkSync(target,planted);
      const result=await verifyReadMd5(read("group/project/link"),run());
      expect(result.error).toMatch(/symlink/);expect(calculateFileMd5).not.toHaveBeenCalled();expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    test("refuses a symlinked ancestor even when the target remains within the project", async () => {
      fs.symlinkSync(path.join(datastoreRoot,"group/project/sample"),path.join(datastoreRoot,"group/project/link"));
      const result=await verifyReadMd5(read("group/project/link/run/raw/file1.fastq"),run());
      expect(result.error).toMatch(/symlink/);expect(calculateFileMd5).not.toHaveBeenCalled();
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

    test("excludes every sample belonging to a non-HPC project", async () => {
      Project.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: "archived-project" }]),
      });
      Sample.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: "archived-sample" }]),
      });
      Run.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([]),
      });

      await findRunsNeedingVerification(10);

      expect(Sample.find).toHaveBeenCalledWith({
        project: { $in: ["archived-project"] },
      });
      expect(Run.find.mock.calls[0][0].sample).toEqual({
        $nin: ["archived-sample"],
      });
    });
  });

  describe("cleanupStalePendingRuns", () => {
    test("should mark stale runs as error", async () => {
      const now = new Date();
      const staleRuns = [
        {
          _id: "run1",
          name: "Stale Run 1",
          createdAt: new Date(now - 25 * 60 * 60 * 1000),
        },
        {
          _id: "run2",
          name: "Stale Run 2",
          createdAt: new Date(now - 30 * 60 * 60 * 1000),
        },
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
