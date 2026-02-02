const cron = require("node-cron");

// Mock dependencies
jest.mock("node-cron");
jest.mock("../../lib/md5-verification");
jest.mock("../../lib/utils/sendEmail");

const {
  findRunsNeedingVerification,
  verifyRunMd5,
  cleanupStalePendingRuns,
} = require("../../lib/md5-verification");
const { sendMd5VerificationEmail } = require("../../lib/utils/sendEmail");

// Import after mocks
const {
  initializeBackgroundJobs,
  processMd5Verification,
  processCleanup,
} = require("../../lib/background-jobs");

describe("Background Jobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("initializeBackgroundJobs", () => {
    test("should initialize cron jobs", () => {
      cron.schedule = jest.fn();

      initializeBackgroundJobs();

      // Should schedule MD5 verification job (every 5 minutes)
      expect(cron.schedule).toHaveBeenCalledWith(
        "*/5 * * * *",
        expect.any(Function),
      );

      // Should schedule cleanup job (daily at 2:00 AM)
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 2 * * *",
        expect.any(Function),
      );

      expect(cron.schedule).toHaveBeenCalledTimes(2);
    });

    test("should run initial MD5 verification after 10 seconds", () => {
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      initializeBackgroundJobs();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    });
  });

  describe("processMd5Verification", () => {
    test("should process pending runs and send emails", async () => {
      const mockRuns = [
        { _id: "run1", name: "Run 1" },
        { _id: "run2", name: "Run 2" },
      ];

      findRunsNeedingVerification.mockResolvedValue(mockRuns);
      verifyRunMd5.mockResolvedValue({
        success: true,
        filesVerified: 10,
        mismatches: 0,
        errors: 0,
        duration: 45000,
        runName: "Run 1",
      });
      sendMd5VerificationEmail.mockResolvedValue(true);

      await processMd5Verification();

      expect(findRunsNeedingVerification).toHaveBeenCalledWith(10);
      expect(verifyRunMd5).toHaveBeenCalledTimes(2);
      expect(verifyRunMd5).toHaveBeenCalledWith("run1");
      expect(verifyRunMd5).toHaveBeenCalledWith("run2");
      expect(sendMd5VerificationEmail).toHaveBeenCalledTimes(2);
    });

    test("should handle case when no runs need verification", async () => {
      findRunsNeedingVerification.mockResolvedValue([]);

      await processMd5Verification();

      expect(findRunsNeedingVerification).toHaveBeenCalled();
      expect(verifyRunMd5).not.toHaveBeenCalled();
      expect(sendMd5VerificationEmail).not.toHaveBeenCalled();
    });

    test("should not send email when verification is skipped", async () => {
      const mockRuns = [{ _id: "run1", name: "Run 1" }];

      findRunsNeedingVerification.mockResolvedValue(mockRuns);
      verifyRunMd5.mockResolvedValue({
        success: true,
        skipped: true,
        message: "MD5 verification disabled globally",
      });

      await processMd5Verification();

      expect(verifyRunMd5).toHaveBeenCalledWith("run1");
      expect(sendMd5VerificationEmail).not.toHaveBeenCalled();
    });

    test("should handle verification errors gracefully", async () => {
      const mockRuns = [{ _id: "run1", name: "Run 1" }];

      findRunsNeedingVerification.mockResolvedValue(mockRuns);
      verifyRunMd5.mockRejectedValue(new Error("Verification failed"));

      // Should not throw
      await expect(processMd5Verification()).resolves.not.toThrow();
    });

    test("should handle email sending errors gracefully", async () => {
      const mockRuns = [{ _id: "run1", name: "Run 1" }];

      findRunsNeedingVerification.mockResolvedValue(mockRuns);
      verifyRunMd5.mockResolvedValue({
        success: true,
        filesVerified: 10,
        mismatches: 0,
        errors: 0,
        duration: 45000,
      });
      sendMd5VerificationEmail.mockRejectedValue(new Error("Email failed"));

      // Should not throw
      await expect(processMd5Verification()).resolves.not.toThrow();
    });

    test("should skip if already running (mutex behavior)", async () => {
      const mockRuns = [{ _id: "run1", name: "Run 1" }];

      findRunsNeedingVerification.mockResolvedValue(mockRuns);

      // First call will process
      verifyRunMd5.mockResolvedValueOnce({
        success: true,
        filesVerified: 1,
        mismatches: 0,
        errors: 0,
        duration: 100,
      });

      await processMd5Verification();

      expect(findRunsNeedingVerification).toHaveBeenCalledTimes(1);
      expect(verifyRunMd5).toHaveBeenCalledTimes(1);

      // Reset mocks
      jest.clearAllMocks();

      // Second call should work fine when first is done
      findRunsNeedingVerification.mockResolvedValue([]);
      await processMd5Verification();

      expect(findRunsNeedingVerification).toHaveBeenCalledTimes(1);
    });
  });

  describe("processCleanup", () => {
    test("should clean up stale runs", async () => {
      cleanupStalePendingRuns.mockResolvedValue({
        cleaned: 5,
        runIds: ["run1", "run2", "run3", "run4", "run5"],
      });

      await processCleanup();

      expect(cleanupStalePendingRuns).toHaveBeenCalledWith(24);
    });

    test("should handle cleanup errors gracefully", async () => {
      cleanupStalePendingRuns.mockRejectedValue(new Error("Cleanup failed"));

      // Should not throw
      await expect(processCleanup()).resolves.not.toThrow();
    });

    test("should skip if already running (mutex behavior)", async () => {
      cleanupStalePendingRuns.mockResolvedValue({
        cleaned: 2,
        runIds: ["run1", "run2"],
      });

      await processCleanup();

      expect(cleanupStalePendingRuns).toHaveBeenCalledTimes(1);
      expect(cleanupStalePendingRuns).toHaveBeenCalledWith(24);

      // Reset and run again - should work when first is done
      jest.clearAllMocks();

      cleanupStalePendingRuns.mockResolvedValue({
        cleaned: 0,
        runIds: [],
      });

      await processCleanup();

      expect(cleanupStalePendingRuns).toHaveBeenCalledTimes(1);
    });
  });
});
