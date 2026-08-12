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

// The job runs every 5 minutes and usually finds nothing, so an idle run says
// nothing worth 288 log lines a day. It is still logged occasionally: total
// silence makes "idle" and "no longer running" look identical.
const IDLE_HEARTBEAT_MS = 60 * 60 * 1000;
let lastIdleLogAt = 0;

// Exposed via getJobStatus() so liveness can be checked without reading logs.
const md5JobStatus = {
  lastStartedAt: null,
  lastFinishedAt: null,
  lastRunsFound: null,
  lastError: null,
};

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
  md5JobStatus.lastStartedAt = new Date();

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
    md5JobStatus.lastRunsFound = runs.length;

    if (runs.length === 0) {
      // Nothing to do: stay quiet rather than logging every 5 minutes, but
      // check in hourly so the job's silence is not mistaken for its absence.
      const now = Date.now();
      const sinceLastLog = now - lastIdleLogAt;
      // A negative gap means the wall clock stepped backwards (an NTP
      // correction, say). Treat that as due rather than waiting out a
      // deadline that has moved into the future.
      if (sinceLastLog >= IDLE_HEARTBEAT_MS || sinceLastLog < 0) {
        lastIdleLogAt = now;
        console.log(
          "[Background Job] MD5 verification idle — no runs awaiting verification",
        );
      }
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
    md5JobStatus.lastError = null;
  } catch (error) {
    console.error("[Background Job] Error processing MD5 verification:", error);
    md5JobStatus.lastError = { message: error.message, at: new Date() };
  } finally {
    md5JobRunning = false;
    md5JobStatus.lastFinishedAt = new Date();
  }
};

/**
 * A snapshot of the MD5 job's health, for a status endpoint or manual check.
 * @returns {{running: boolean, lastStartedAt: ?Date, lastFinishedAt: ?Date, lastRunsFound: ?number, lastError: ?object}}
 */
const getJobStatus = () => ({ running: md5JobRunning, ...md5JobStatus });

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

  // MD5 verification job - runs every 5 minutes.
  // The tick itself is not logged: doing so put a line in the log every 5
  // minutes regardless, which is what silencing the idle run was meant to stop.
  scheduledTasks.push(
    cron.schedule("*/5 * * * *", async () => {
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
      // destroy() also drops the task from node-cron's module-level registry;
      // stop() only clears its timer, leaving the entry to accumulate across
      // repeated initialise/stop cycles.
      if (task && typeof task.destroy === "function") {
        task.destroy();
      } else if (task && typeof task.stop === "function") {
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
  getJobStatus,
};
