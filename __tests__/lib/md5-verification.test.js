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
    process.env.DATASTORE_ROOT = datastoreRoot;
    process.env.SKIP_MD5_VERIFICATION = "false";
    Run.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: mockRunId,
          name: "Test Run",
          sample: { project: { _id: new mongoose.Types.ObjectId() } },
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
                  s3Uri: "s3://archive/data/group/project",
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
        sample: { project: { _id: new mongoose.Types.ObjectId() } },
        getRelativePath: jest
          .fn()
          .mockResolvedValue("group/project/sample/run"),
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
        sample: { project: { _id: new mongoose.Types.ObjectId() } },
        getRelativePath: jest
          .fn()
          .mockResolvedValue("group/project/sample/run"),
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

  // The destination path is built from `read.file.originalName`, which is
  // client-supplied Upload-Metadata. New documents go through safeBasename in
  // lib/file-utils.js, but documents written before that guard existed were
  // never sanitised and this job reads them back — so the stored value is
  // still untrusted at this point, and this was the last path construction in
  // the file perimeter with no containment check.
  describe("verifyReadMd5 destination containment", () => {
    const runWithPath = (relativePath) => ({
      _id: mockRunId,
      name: "Test Run",
      sample: { project: { _id: new mongoose.Types.ObjectId() } },
      getRelativePath: jest.fn().mockResolvedValue(relativePath),
    });

    const readNamed = (originalName) => ({
      _id: mockReadId,
      MD5: "abc123",
      file: { originalName },
    });

    beforeEach(() => {
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      calculateFileMd5.mockResolvedValue("abc123");
    });

    test("hashes the file at the datastore location", async () => {
      const result = await verifyReadMd5(
        readNamed("file1.fastq"),
        runWithPath("group/project/sample/run"),
      );

      expect(calculateFileMd5).toHaveBeenCalledWith(
        path.join(datastoreRoot, "group/project/sample/run/raw/file1.fastq"),
      );
      expect(result.error).toBeUndefined();
    });

    test("tolerates a leading slash on the run's relative path", async () => {
      await verifyReadMd5(
        readNamed("file1.fastq"),
        runWithPath("/group/project/sample/run"),
      );

      expect(calculateFileMd5).toHaveBeenCalledWith(
        path.join(datastoreRoot, "group/project/sample/run/raw/file1.fastq"),
      );
    });

    test.each([
      ["a traversing originalName", "../../../../../../etc/passwd"],
      ["a traversal that stays inside the datastore", "../../other-group/x.fq"],
      ["an absolute originalName", "/etc/passwd"],
      ["a NUL-truncated originalName", "reads.fq\u0000.png"],
    ])(
      "refuses to hash anything outside the datastore: %s",
      async (_l, name) => {
        const result = await verifyReadMd5(
          readNamed(name),
          runWithPath("group/project/sample/run"),
        );

        // Never opened. Hashing it would turn md5Mismatch into an oracle for
        // files the API user was never entitled to read.
        expect(calculateFileMd5).not.toHaveBeenCalled();
        expect(result.error).toMatch(/does not resolve inside DATASTORE_ROOT/);
        // And nothing is recorded as verified.
        expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();
      },
    );

    test("refuses a destination reached through a symlink out of the datastore", async () => {
      // The lexical check alone is satisfied by <root>/link/raw/x: the string
      // never leaves the root, but the read does.
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "md5-outside-"));
      const linkPath = path.join(datastoreRoot, "linked-group");
      fs.symlinkSync(outside, linkPath);

      try {
        const result = await verifyReadMd5(
          readNamed("file1.fastq"),
          runWithPath("linked-group/project/sample/run"),
        );

        expect(calculateFileMd5).not.toHaveBeenCalled();
        expect(result.error).toMatch(/does not resolve inside DATASTORE_ROOT/);
      } finally {
        fs.unlinkSync(linkPath);
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    test("refuses a destination that is a symlink to another file INSIDE the datastore", async () => {
      // Distinct from the test above, and not covered by it. There the link
      // pointed *out* of the datastore, so containment refused it and the
      // hasher was never reached. Here the link's target is another group's
      // file inside the same root: realpath lands on a path still under
      // DATASTORE_ROOT, so resolveWithinReal returns the destination happily
      // and every containment check in the codebase is satisfied.
      //
      // The only thing left is O_NOFOLLOW in lib/utils/md5.js. Without it this
      // read is reported as a checksum MATCH against bytes it does not own —
      // a verified-OK stamp on somebody else's file. So this test runs the
      // real hasher; the mock cannot express the property.
      const victimDir = path.join(datastoreRoot, "other-group");
      const victim = path.join(victimDir, "their-reads.fq");
      fs.mkdirSync(victimDir, { recursive: true });
      fs.writeFileSync(victim, "SOMEBODY ELSE'S SEQUENCE DATA");
      const victimMd5 = crypto
        .createHash("md5")
        .update("SOMEBODY ELSE'S SEQUENCE DATA")
        .digest("hex");

      const rawDir = path.join(datastoreRoot, "group/project/sample/run/raw");
      const planted = path.join(rawDir, "file1.fastq");
      fs.mkdirSync(rawDir, { recursive: true });
      fs.symlinkSync(victim, planted);

      calculateFileMd5.mockImplementation(realCalculateFileMd5);

      try {
        const result = await verifyReadMd5(
          {
            _id: mockReadId,
            MD5: victimMd5,
            file: { originalName: "file1.fastq" },
          },
          runWithPath("group/project/sample/run"),
        );

        // Containment passed — that is the whole point of this test, and if
        // this assertion ever fails the test has stopped covering what it was
        // written for and is passing for the wrong reason.
        expect(calculateFileMd5).toHaveBeenCalledWith(planted);

        // ...and the read is still not verified, because the open refused.
        expect(result.error).toBeDefined();
        expect(result.mismatch).toBeUndefined();
        // Nothing is stamped onto the Read: no destinationMd5, and above all
        // no `md5Mismatch: false` recorded against another group's bytes.
        expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(path.join(datastoreRoot, "group"), {
          recursive: true,
          force: true,
        });
        fs.rmSync(victimDir, { recursive: true, force: true });
      }
    });

    test("a refused read fails the run rather than passing it", async () => {
      const mockRun = runWithPath("group/project/sample/run");

      Run.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockRun),
        }),
      });
      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Read.find = jest.fn().mockReturnValue({
        populate: jest
          .fn()
          .mockResolvedValue([readNamed("../../../../etc/passwd")]),
      });

      const result = await verifyRunMd5(mockRunId);

      expect(result.success).toBe(false);
      expect(result.errors).toBe(1);
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
        mockRunId,
        expect.objectContaining({
          $set: expect.objectContaining({ md5VerificationStatus: "failed" }),
        }),
      );
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
