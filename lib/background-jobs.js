const cron = require("node-cron");
const {
  findRunsNeedingVerification,
  verifyRunMd5,
  recoverStalledVerifications,
  cleanupStalePendingRuns,
} = require("./md5-verification");
const { sendMd5VerificationEmail } = require("./utils/sendEmail");

// Track running jobs to prevent overlaps
let md5JobRunning = false;
let cleanupJobRunning = false;

// How long a run may sit in "in_progress" before it is treated as stranded by
// a restart and returned to the queue.
const STALLED_VERIFICATION_MINUTES = 60;

// Handles for the scheduled tasks, so tests and shutdown can stop them.
let scheduledTasks = [];
let startupTimer = null;

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
    // Return anything stranded by a restart to the queue before picking work up.
    try {
      const recovery = await recoverStalledVerifications(STALLED_VERIFICATION_MINUTES);
      if (recovery.requeued || recovery.failed) {
        console.log(
          `[Background Job] Recovered stalled verifications: ${recovery.requeued} requeued, ${recovery.failed} marked failed`,
        );
      }
    } catch (recoveryError) {
      console.error(
        "[Background Job] Failed to recover stalled verifications:",
        recoveryError,
      );
    }

    // Find runs needing verification
    const runs = await findRunsNeedingVerification(10); // Process up to 10 at a time

    if (runs.length === 0) {
      // Feature request: silence empty 5-minute cron logs
      return;
    }

    console.log(
      `[Background Job] Found ${runs.length} runs needing verification`
    );

    // Process runs sequentially to avoid overwhelming the system
    for (const run of runs) {
      const result = await verifyRunMd5(run._id);

      // If verifyRunMd5 returns success: false and exhausted retries,
      // explicitly log it or email the webmaster, but the DB is now updated
      // with a clear statusError message for the user to see on the frontend.
      if (result.success === false && !result.shouldRetry) {
        console.error(`[Background Job] Hard failure verifying run ${run._id}. Marked as failed.`);
      }

      // ONLY send email notification if verification finished with mismatches/file read errors
      if (!result.skipped && (result.mismatches > 0 || (result.errors && result.errors > 0))) {
        try {
          await sendMd5VerificationEmail({
            runId: run._id,
            runName: run.name || result.runName,
            filesVerified: result.filesVerified,
            mismatches: result.mismatches,
            errors: result.errors || 0,
            duration: result.duration,
            ownerUsername: run.owner,
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

  // Guard against a second call leaving orphaned schedules behind.
  stopBackgroundJobs();

  // MD5 verification job - runs every 5 minutes
  scheduledTasks.push(
    cron.schedule("*/5 * * * *", async () => {
      console.log("[Background Job] MD5 verification cron triggered");
      await processMd5Verification();
    }),
  );

  // Cleanup job - runs daily at 2:00 AM
  scheduledTasks.push(
    cron.schedule("0 2 * * *", async () => {
      console.log("[Background Job] Cleanup cron triggered");
      await processCleanup();
    }),
  );

  // Run initial MD5 verification on startup (after 10 seconds).
  // unref() so a pending timer never holds the process open on shutdown.
  startupTimer = setTimeout(() => {
    console.log("[Background Job] Running initial MD5 verification");
    processMd5Verification();
  }, 10000);
  if (typeof startupTimer.unref === "function") {
    startupTimer.unref();
  }

  console.log("[Background Jobs] Cron jobs initialized successfully");
  console.log("  - MD5 Verification: Every 5 minutes");
  console.log("  - Stale Run Cleanup: Daily at 2:00 AM");
};

/**
 * Stops every scheduled job. Used on shutdown and between tests.
 */
const stopBackgroundJobs = () => {
  scheduledTasks.forEach((task) => {
    try {
      if (task && typeof task.stop === "function") {
        task.stop();
      }
    } catch (error) {
      console.error("[Background Jobs] Failed to stop a scheduled task:", error);
    }
  });
  scheduledTasks = [];

  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
};

module.exports = {
  initializeBackgroundJobs,
  stopBackgroundJobs,
  processMd5Verification,
  processCleanup,
};
