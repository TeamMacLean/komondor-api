const cron = require("node-cron");

// Mock dependencies
jest.mock("node-cron");
jest.mock("../../lib/md5-verification");
jest.mock("../../lib/utils/sendEmail");
jest.mock("../../lib/upload-quota");

const {
  findRunsNeedingVerification,
  verifyRunMd5,
  cleanupStalePendingRuns,
} = require("../../lib/md5-verification");
const { sendMd5VerificationEmail } = require("../../lib/utils/sendEmail");
const { cleanupAbandonedUploads } = require("../../lib/upload-quota");

// Import after mocks
const {
  initializeBackgroundJobs,
  processMd5Verification,
  processCleanup,
  processUploadSweep,
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

      // Should schedule the abandoned upload sweep (daily at 3:00 AM). It is
      // deliberately an hour after the run cleanup so the two are not
      // competing for the same disk at the same moment.
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 3 * * *",
        expect.any(Function),
      );

      // Exact count, so a job added without a test here fails loudly rather
      // than being scheduled silently.
      expect(cron.schedule).toHaveBeenCalledTimes(3);
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

  describe("processUploadSweep", () => {
    const emptyResult = {
      removed: [],
      sidecars: [],
      completed: [],
      orphans: [],
      errors: [],
    };

    test("sweeps the configured upload directory", async () => {
      cleanupAbandonedUploads.mockResolvedValue(emptyResult);

      await processUploadSweep();

      expect(cleanupAbandonedUploads).toHaveBeenCalledWith({
        directory: require("path").join(process.cwd(), "files"),
      });
    });

    test("does not delete finished or orphaned uploads", async () => {
      // The two destructive options must stay off. A finished upload is a file
      // the user has not yet attached to a project, and an orphan is every
      // upload the old unauthenticated server accepted — deleting either on a
      // timer destroys data somebody still expects to find.
      cleanupAbandonedUploads.mockResolvedValue(emptyResult);

      await processUploadSweep();

      const [options] = cleanupAbandonedUploads.mock.calls[0];
      expect(options.includeCompleted).toBeUndefined();
      expect(options.includeOrphans).toBeUndefined();
    });

    test("handles a sweep failure without throwing", async () => {
      cleanupAbandonedUploads.mockRejectedValue(new Error("disk gone"));

      await expect(processUploadSweep()).resolves.not.toThrow();
    });

    test("reports what it left behind", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      cleanupAbandonedUploads.mockResolvedValue({
        removed: ["a"],
        sidecars: ["a.json"],
        completed: ["b"],
        orphans: ["c"],
        errors: [{ id: "d", error: "EACCES" }],
      });

      await processUploadSweep();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("could not process"),
        [{ id: "d", error: "EACCES" }],
      );

      // Sidecar deletions are real removals and have to be visible to an
      // operator reading the summary, not only in the returned object.
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 orphaned sidecars removed"),
      );

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
