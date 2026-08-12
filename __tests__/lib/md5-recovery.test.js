/**
 * Tests for the failure-recovery paths in lib/md5-verification.js.
 *
 * verifyRunMd5 flips a run to "in_progress" before it starts. If the process
 * restarts mid-verification, nothing moved it back — findRunsNeedingVerification
 * only looks for "pending" — so the run sat unverified forever.
 */

jest.mock("../../models/Run", () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock("../../models/Read", () => ({ find: jest.fn() }));
jest.mock("../../lib/utils/md5", () => ({ calculateFileMd5: jest.fn() }));

const Run = require("../../models/Run");
const {
  recoverStalledVerifications,
  verifyRunMd5,
  MAX_RETRY_ATTEMPTS,
} = require("../../lib/md5-verification");

/** Stubs Run.find().select() */
const mockRunFind = (runs) => {
  Run.find.mockReturnValue({ select: jest.fn().mockResolvedValue(runs) });
};

const ORIGINAL_SKIP = process.env.SKIP_MD5_VERIFICATION;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.SKIP_MD5_VERIFICATION;
  Run.findByIdAndUpdate.mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_SKIP === undefined) {
    delete process.env.SKIP_MD5_VERIFICATION;
  } else {
    process.env.SKIP_MD5_VERIFICATION = ORIGINAL_SKIP;
  }
});

describe("recoverStalledVerifications", () => {
  test("does nothing when no run is stalled", async () => {
    mockRunFind([]);

    const result = await recoverStalledVerifications(60);

    expect(result).toEqual({ requeued: 0, failed: 0, runIds: [] });
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("queries only in_progress runs older than the cutoff", async () => {
    mockRunFind([]);

    await recoverStalledVerifications(30);

    const criteria = Run.find.mock.calls[0][0];
    expect(criteria.md5VerificationStatus).toBe("in_progress");
    expect(criteria.$or[0].md5VerificationLastAttempt.$lt).toBeInstanceOf(Date);
  });

  test("also matches runs that have no last-attempt timestamp", async () => {
    // `$lt` alone never matches a missing or null field, so a run stranded
    // without a timestamp would stay in_progress forever.
    mockRunFind([]);

    await recoverStalledVerifications(30);

    const criteria = Run.find.mock.calls[0][0];
    expect(criteria.$or).toEqual(
      expect.arrayContaining([
        { md5VerificationLastAttempt: null },
        { md5VerificationLastAttempt: { $exists: false } },
      ]),
    );
  });

  test("returns a run with retries left to the pending queue", async () => {
    mockRunFind([{ _id: "r1", name: "run1", md5VerificationAttempts: 1 }]);

    const result = await recoverStalledVerifications(60);

    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith("r1", {
      $set: { md5VerificationStatus: "pending" },
    });
  });

  test("marks a run that has exhausted its retries as failed", async () => {
    mockRunFind([
      { _id: "r1", name: "run1", md5VerificationAttempts: MAX_RETRY_ATTEMPTS },
    ]);

    const result = await recoverStalledVerifications(60);

    expect(result.failed).toBe(1);
    expect(result.requeued).toBe(0);
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith("r1", {
      $set: { md5VerificationStatus: "failed" },
    });
  });

  test("keeps going when one run cannot be updated", async () => {
    mockRunFind([
      { _id: "r1", md5VerificationAttempts: 0 },
      { _id: "r2", md5VerificationAttempts: 0 },
    ]);
    Run.findByIdAndUpdate
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce({});

    const result = await recoverStalledVerifications(60);

    expect(result.requeued).toBe(1);
    expect(result.runIds).toEqual(["r1", "r2"]);
  });
});

describe("verifyRunMd5 failure handling", () => {
  test("requeues a run that still has retries left", async () => {
    Run.findById
      .mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("lookup failed")),
        }),
      })
      .mockResolvedValueOnce({ md5VerificationAttempts: 1 });

    const result = await verifyRunMd5("r1");

    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith("r1", {
      $set: { md5VerificationStatus: "pending" },
    });
  });

  test("marks a run failed once retries are exhausted", async () => {
    Run.findById
      .mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("lookup failed")),
        }),
      })
      .mockResolvedValueOnce({ md5VerificationAttempts: MAX_RETRY_ATTEMPTS });

    const result = await verifyRunMd5("r1");

    expect(result.shouldRetry).toBe(false);
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith("r1", {
      $set: { 
        md5VerificationStatus: "failed",
        statusError: "MD5 Verification failed internally after maximum attempts. Please contact the webmaster (deeks@nbi.ac.uk).",
      },
    });
  });

  test("does not throw when the recovery lookup itself fails", async () => {
    // This runs on a cron tick with no caller to catch a rejection, so a second
    // failure here must stay contained.
    Run.findById
      .mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("lookup failed")),
        }),
      })
      .mockRejectedValueOnce(new Error("db down"));

    const result = await verifyRunMd5("r1");

    expect(result.success).toBe(false);
  });

  test("does not condemn a run when the recovery lookup fails", async () => {
    // A failed lookup says nothing about the retry budget. Marking the run
    // failed here would destroy a healthy run on a transient database blip.
    Run.findById
      .mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("lookup failed")),
        }),
      })
      .mockRejectedValueOnce(new Error("db down"));

    const result = await verifyRunMd5("r1");

    expect(result.shouldRetry).toBe(true);
    expect(Run.findByIdAndUpdate).not.toHaveBeenCalledWith("r1", {
      $set: { md5VerificationStatus: "failed" },
    });
  });

  test("does not throw when the status update also fails", async () => {
    Run.findById
      .mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockRejectedValue(new Error("lookup failed")),
        }),
      })
      .mockResolvedValueOnce({ md5VerificationAttempts: MAX_RETRY_ATTEMPTS });
    Run.findByIdAndUpdate.mockRejectedValue(new Error("db down"));

    await expect(verifyRunMd5("r1")).resolves.toMatchObject({ success: false });
  });

  test("skips verification and completes when globally disabled", async () => {
    process.env.SKIP_MD5_VERIFICATION = "true";

    const result = await verifyRunMd5("r1");

    expect(result).toMatchObject({ success: true, skipped: true });
    expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        $set: expect.objectContaining({ md5VerificationStatus: "complete" }),
      }),
    );
  });
});
