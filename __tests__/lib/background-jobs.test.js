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
    test("should process pending runs and send emails for errors", async () => {
      findRunsNeedingVerification.mockResolvedValue([
        { _id: "run1", name: "Run 1" },
        { _id: "run2", name: "Run 2" },
      ]);

      // Mock one success, one failure
      verifyRunMd5
        .mockResolvedValueOnce({
          success: true,
          skipped: false,
          runName: "Run 1",
          filesVerified: 1,
          mismatches: 0,
          errors: 0,
          duration: 100,
        })
        .mockResolvedValueOnce({
          success: false,
          skipped: false,
          runName: "Run 2",
          filesVerified: 1,
          mismatches: 1,
          errors: 0,
          duration: 100,
        });
      sendMd5VerificationEmail.mockResolvedValue(true);

      const { processMd5Verification } = require("../../lib/background-jobs");
      await processMd5Verification();

      expect(findRunsNeedingVerification).toHaveBeenCalledTimes(1);
      expect(verifyRunMd5).toHaveBeenCalledTimes(2);
      expect(verifyRunMd5).toHaveBeenCalledWith("run1");
      expect(verifyRunMd5).toHaveBeenCalledWith("run2");
      // ONLY the failed run should trigger an email now
      expect(sendMd5VerificationEmail).toHaveBeenCalledTimes(1);
      expect(sendMd5VerificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ runName: "Run 2", mismatches: 1 })
      );
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

  describe("log volume when there is nothing to do", () => {
    // The job fires every 5 minutes and almost always finds nothing, so an
    // idle pass must stay quiet — but not so quiet that a job which has
    // stopped running looks the same as one that is simply idle.
    let logSpy;

    beforeEach(() => {
      findRunsNeedingVerification.mockResolvedValue([]);
      logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    test("stays silent on a second idle pass within the hour", async () => {
      await processMd5Verification();
      logSpy.mockClear();

      jest.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      await processMd5Verification();

      expect(logSpy).not.toHaveBeenCalled();
    });

    test("reports in once an hour so silence is not mistaken for absence", async () => {
      await processMd5Verification();
      logSpy.mockClear();

      jest.setSystemTime(new Date("2026-01-01T01:00:01Z"));
      await processMd5Verification();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("idle"));
    });

    test("does not log merely because the cron fired", async () => {
      // Logging the tick itself put a line in the log every 5 minutes
      // regardless, which is what silencing the idle pass was meant to stop.
      cron.schedule = jest.fn();
      initializeBackgroundJobs();
      const [, onTick] = cron.schedule.mock.calls[0];
      await processMd5Verification(); // takes the hourly heartbeat
      jest.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      logSpy.mockClear();

      await onTick();

      expect(logSpy).not.toHaveBeenCalled();
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
