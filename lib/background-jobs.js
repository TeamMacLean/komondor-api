const cron = require("node-cron");
const {
  findRunsNeedingVerification,
  verifyRunMd5,
  cleanupStalePendingRuns,
} = require("./md5-verification");
const { sendMd5VerificationEmail } = require("./utils/sendEmail");

// Track running jobs to prevent overlaps
let md5JobRunning = false;
let cleanupJobRunning = false;

/**
 * Processes pending MD5 verifications.
 * Runs immediately (on-demand) for new runs.
 */
const processMd5Verification = async () => {
  if (md5JobRunning) {
    console.log("[Background Job] MD5 verification already running, skipping");
    return;
  }

  md5JobRunning = true;

  try {
    console.log("[Background Job] Starting MD5 verification batch");

    // Find runs needing verification
    const runs = await findRunsNeedingVerification(10); // Process up to 10 at a time

    if (runs.length === 0) {
      console.log("[Background Job] No runs need MD5 verification");
      return;
    }

    console.log(
      `[Background Job] Found ${runs.length} runs needing verification`
    );

    // Process runs sequentially to avoid overwhelming the system
    for (const run of runs) {
      const result = await verifyRunMd5(run._id);

      // Send email notification if verification completed
      if (result.success && !result.skipped) {
        try {
          await sendMd5VerificationEmail({
            runId: run._id,
            runName: run.name || result.runName,
            filesVerified: result.filesVerified,
            mismatches: result.mismatches,
            errors: result.errors || 0,
            duration: result.duration,
          });
        } catch (emailError) {
          console.error(
            `[Background Job] Failed to send email for run ${run._id}:`,
            emailError
          );
        }
      }
    }

    console.log("[Background Job] MD5 verification batch completed");
  } catch (error) {
    console.error("[Background Job] Error processing MD5 verification:", error);
  } finally {
    md5JobRunning = false;
  }
};

/**
 * Cleans up stale pending runs.
 * Runs daily.
 */
const processCleanup = async () => {
  if (cleanupJobRunning) {
    console.log("[Background Job] Cleanup already running, skipping");
    return;
  }

  cleanupJobRunning = true;

  try {
    console.log("[Background Job] Starting stale run cleanup");
    const result = await cleanupStalePendingRuns(24); // 24 hours
    console.log(
      `[Background Job] Cleanup completed: ${result.cleaned} runs cleaned up`
    );
  } catch (error) {
    console.error("[Background Job] Error during cleanup:", error);
  } finally {
    cleanupJobRunning = false;
  }
};

/**
 * Initializes all background jobs.
 */
const initializeBackgroundJobs = () => {
  console.log("[Background Jobs] Initializing cron jobs...");

  // MD5 verification job - runs every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    console.log("[Background Job] MD5 verification cron triggered");
    await processMd5Verification();
  });

  // Cleanup job - runs daily at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[Background Job] Cleanup cron triggered");
    await processCleanup();
  });

  // Run initial MD5 verification on startup (after 10 seconds)
  setTimeout(() => {
    console.log("[Background Job] Running initial MD5 verification");
    processMd5Verification();
  }, 10000);

  console.log("[Background Jobs] Cron jobs initialized successfully");
  console.log("  - MD5 Verification: Every 5 minutes");
  console.log("  - Stale Run Cleanup: Daily at 2:00 AM");
};

module.exports = {
  initializeBackgroundJobs,
  processMd5Verification,
  processCleanup,
};
