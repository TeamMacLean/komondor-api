const Read = require("../models/Read");
const Run = require("../models/Run");
const Sample = require("../models/Sample");
const Project = require("../models/Project");
const { calculateFileMd5 } = require("./utils/md5");
const { NON_HPC_FILTER, resolveStorageState } = require("./storage-state");
const {
  cleanDirectoryName,
  safeBasename,
  resolveWithinReal,
} = require("./utils/safePath");

// Maximum retry attempts for MD5 verification
const MAX_RETRY_ATTEMPTS = 3;

// Run ids currently being verified in this process. `verifyRunMd5` is also
// called on demand from the run-creation route, outside the background job's
// overlap guard, so stalled-run recovery must not requeue one still running.
const inFlightRunIds = new Set();

/**
 * Verifies MD5 checksums for all reads in a given run.
 * @param {mongoose.Types.ObjectId} runId - The ID of the run to verify.
 * @param {object} options - Options for verification.
 * @param {boolean} options.skipIfDisabled - Skip verification if SKIP_MD5_VERIFICATION is true.
 * @returns {Promise<object>} Result object with status and statistics.
 */
const verifyRunMd5 = async (runId, options = {}) => {
  const { skipIfDisabled = true } = options;
  const startTime = Date.now();

  // Marks this run as being worked on so stalled-run recovery leaves it alone.
  const inFlightKey = String(runId);
  inFlightRunIds.add(inFlightKey);

  try {
    const run = await Run.findById(runId)
      .populate({
        path: "sample",
        populate: { path: "project" },
      })
      .populate("group");

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const project = run.sample && run.sample.project;
    const storageState = resolveStorageState(project);
    if (!storageState.acceptsHpcWrites) {
      if (storageState.integrityError) {
        console.error(
          `[storage-integrity] project ${project?._id || "unknown"}: ${storageState.integrityError}`,
        );
      }
      console.log(
        `[MD5 Verification] Skipped run ${runId}: project storage is ${storageState.state}`,
      );
      return {
        success: true,
        skipped: true,
        reason: "PROJECT_STORAGE_READ_ONLY",
      };
    }

    if (skipIfDisabled && process.env.SKIP_MD5_VERIFICATION === "true") {
      console.log(
        `[MD5 Verification] Skipped for run ${runId} (globally disabled)`,
      );
      await Run.findByIdAndUpdate(runId, {
        $set: {
          md5VerificationStatus: "complete",
          md5VerificationCompletedAt: new Date(),
          md5VerificationResult: { disabled: true },
        },
      });
      return {
        success: true,
        skipped: true,
        message: "MD5 verification disabled globally",
      };
    }

    await Run.findByIdAndUpdate(runId, {
      $set: {
        md5VerificationStatus: "in_progress",
        md5VerificationResult: null,
        md5VerificationLastAttempt: new Date(),
      },
      $inc: { md5VerificationAttempts: 1 },
    });

    console.log(
      `[MD5 Verification] Starting verification for run ${runId} (${run.name})`,
    );

    const reads = await Read.find({ run: runId }).populate("file");

    if (!reads || reads.length === 0) {
      console.log(`[MD5 Verification] No reads found for run ${runId}`);
      await Run.findByIdAndUpdate(runId, {
        $set: {
          md5VerificationStatus: "complete",
          md5VerificationCompletedAt: new Date(),
          md5VerificationResult: {
            verified: 0,
            mismatches: 0,
            errors: 0,
            skipped: 0,
            total: 0,
          },
        },
      });
      return {
        success: true,
        filesVerified: 0,
        mismatches: 0,
        duration: Date.now() - startTime,
      };
    }

    const results = await Promise.all(
      reads.map((read) => verifyReadMd5(read, run)),
    );

    const mismatches = results.filter((r) => r.mismatch).length;
    const errors = results.filter((r) => r.error).length;
    const verified = results.filter(
      (r) => !r.error && !r.mismatch && !r.skipped,
    ).length;
    const skipped = results.filter((r) => r.skipped).length;

    const duration = Date.now() - startTime;

    console.log(
      `[MD5 Verification] Completed for run ${runId}: ${verified} verified, ${mismatches} mismatches, ${errors} errors (${duration}ms)`,
    );

    const finalStatus = errors > 0 || mismatches > 0 ? "failed" : "complete";
    await Run.findByIdAndUpdate(runId, {
      $set: {
        md5VerificationStatus: finalStatus,
        md5VerificationCompletedAt: new Date(),
        md5VerificationResult: {
          verified,
          mismatches,
          errors,
          skipped,
          total: reads.length,
          disabled: false,
        },
      },
    });

    return {
      success: finalStatus === "complete",
      filesVerified: verified,
      mismatches,
      errors,
      skippedFiles: skipped,
      duration,
      runName: run.name,
      owner: run.owner,
    };
  } catch (error) {
    console.error(`[MD5 Verification] Error verifying run ${runId}:`, error);

    // Best-effort: this runs on a cron tick with no caller to catch a
    // rejection, so a second failure here must not escape.
    let run = null;
    let lookupFailed = false;
    try {
      run = await Run.findById(runId);
    } catch (lookupError) {
      lookupFailed = true;
      console.error(
        `[MD5 Verification] Could not re-read run ${runId} while handling a failure:`,
        lookupError,
      );
    }

    // A failed lookup says nothing about the retry budget: leave the status
    // alone and let recoverStalledVerifications pick the run up.
    if (lookupFailed) {
      return {
        success: false,
        error: error.message,
        shouldRetry: true,
        attempts: 0,
      };
    }

    const shouldRetry =
      !!run && run.md5VerificationAttempts < MAX_RETRY_ATTEMPTS;

    if (!shouldRetry) {
      try {
        await Run.findByIdAndUpdate(runId, {
          $set: {
            md5VerificationStatus: "failed",
            statusError:
              "MD5 Verification failed internally after maximum attempts. Please contact the webmaster (deeks@nbi.ac.uk).",
          },
        });
      } catch (updateError) {
        console.error(
          `[MD5 Verification] Could not mark run ${runId} as failed:`,
          updateError,
        );
      }
    } else {
      try {
        // Back to "pending": left "in_progress" it is never picked up again.
        await Run.findByIdAndUpdate(runId, {
          $set: {
            md5VerificationStatus: "pending",
          },
        });
      } catch (updateError) {
        console.error(
          `[MD5 Verification] Could not requeue run ${runId} for retry:`,
          updateError,
        );
      }
    }

    return {
      success: false,
      error: error.message,
      shouldRetry,
      attempts: run?.md5VerificationAttempts || 0,
    };
  } finally {
    inFlightRunIds.delete(inFlightKey);
  }
};

/**
 * Verifies MD5 checksum for a single read.
 * @param {mongoose.Document} read - The Read document.
 * @param {mongoose.Document} run - The Run document (for path calculation).
 * @returns {Promise<object>} Result object with mismatch status.
 */
const verifyReadMd5 = async (read, run) => {
  const fileStartTime = Date.now();

  try {
    if (!read.file) {
      throw new Error(`File not populated for read ${read._id}`);
    }

    const originalMd5 = read.MD5?.toLowerCase();
    if (!originalMd5) {
      console.warn(
        `[MD5 Verification] No original MD5 for read ${read._id}, skipping`,
      );
      return { readId: read._id, skipped: true };
    }

    // `originalName` is client-supplied, and documents written before
    // safeBasename existed were never sanitised. Both guards are needed:
    // safeBasename stops traversal within the datastore, resolveWithinReal
    // stops it leaving.
    const safeName = safeBasename(read.file.originalName);
    const runPath = await run.getRelativePath();
    const destinationPath = safeName
      ? await resolveWithinReal(
          process.env.DATASTORE_ROOT,
          cleanDirectoryName(runPath),
          "raw",
          safeName,
        )
      : null;

    if (!destinationPath) {
      // Thrown, not skipped: a name that cannot be trusted must not end up
      // quietly recorded as verified.
      throw new Error(
        `Refusing to verify read ${read._id}: its stored file name does not resolve inside DATASTORE_ROOT`,
      );
    }

    const destinationMd5 = await calculateFileMd5(destinationPath);
    const fileDuration = Date.now() - fileStartTime;

    const mismatch = originalMd5 !== destinationMd5;

    if (mismatch) {
      console.warn(
        `[MD5 Verification] Mismatch for ${read.file.originalName}: expected ${originalMd5}, got ${destinationMd5}`,
      );
    }

    await Read.findByIdAndUpdate(read._id, {
      $set: {
        destinationMd5: destinationMd5,
        md5Mismatch: mismatch,
        MD5LastChecked: new Date(),
      },
    });

    console.log(
      `[MD5 Verification] ${read.file.originalName}: ${mismatch ? "MISMATCH" : "OK"} (${fileDuration}ms)`,
    );

    return {
      readId: read._id,
      fileName: read.file.originalName,
      mismatch,
      duration: fileDuration,
    };
  } catch (error) {
    console.error(
      `[MD5 Verification] Error verifying read ${read._id}:`,
      error,
    );
    return {
      readId: read._id,
      fileName: read.file?.originalName,
      error: error.message,
    };
  }
};

/**
 * Finds runs that need MD5 verification.
 * @param {number} limit - Maximum number of runs to return.
 * @returns {Promise<Array>} Array of run IDs that need verification.
 */
const findRunsNeedingVerification = async (limit = 10) => {
  const nonHpcProjects = await Project.find(NON_HPC_FILTER).select("_id");
  let excludedSampleIds = [];
  if (nonHpcProjects.length > 0) {
    const samples = await Sample.find({
      project: { $in: nonHpcProjects.map((project) => project._id) },
    }).select("_id");
    excludedSampleIds = samples.map((sample) => sample._id);
  }

  const filter = {
    md5VerificationStatus: "pending",
    status: "complete", // Only verify runs that completed file processing
    md5VerificationAttempts: { $lt: MAX_RETRY_ATTEMPTS },
  };
  if (excludedSampleIds.length > 0) {
    filter.sample = { $nin: excludedSampleIds };
  }

  const runs = await Run.find(filter)
    .sort({ createdAt: 1 }) // Oldest first
    .limit(limit)
    .select("_id name");

  return runs;
};

/**
 * Returns runs to the pending queue after they were stranded mid-verification.
 *
 * Nothing else moves a run out of "in_progress": findRunsNeedingVerification
 * only looks for "pending". Runs out of retries are marked failed instead.
 *
 * @param {number} maxAgeMinutes - How long a run may stay in_progress.
 * @returns {Promise<{requeued: number, failed: number, runIds: Array}>}
 */
const recoverStalledVerifications = async (maxAgeMinutes = 60) => {
  const cutoffDate = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const found = await Run.find({
    md5VerificationStatus: "in_progress",
    // A stranded run may have no timestamp at all, which `$lt` never matches.
    $or: [
      { md5VerificationLastAttempt: { $lt: cutoffDate } },
      { md5VerificationLastAttempt: null },
      { md5VerificationLastAttempt: { $exists: false } },
    ],
  }).select("_id name md5VerificationAttempts");

  // Never reclaim a run this process is still working on.
  const stalledRuns = found.filter(
    (run) => !inFlightRunIds.has(String(run._id)),
  );

  if (stalledRuns.length === 0) {
    return { requeued: 0, failed: 0, runIds: [] };
  }

  console.log(
    `[MD5 Verification] Found ${stalledRuns.length} runs stalled in_progress for > ${maxAgeMinutes}m`,
  );

  let requeued = 0;
  let failed = 0;

  for (const run of stalledRuns) {
    const canRetry = run.md5VerificationAttempts < MAX_RETRY_ATTEMPTS;
    const nextStatus = canRetry ? "pending" : "failed";

    try {
      await Run.findByIdAndUpdate(run._id, {
        $set: { md5VerificationStatus: nextStatus },
      });
      if (canRetry) {
        requeued += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      console.error(
        `[MD5 Verification] Could not recover stalled run ${run._id}:`,
        error,
      );
    }
  }

  return { requeued, failed, runIds: stalledRuns.map((r) => r._id) };
};

/**
 * Cleans up stale pending runs (stuck in pending for too long).
 * @param {number} maxAgeHours - Maximum age in hours before marking as error.
 * @returns {Promise<object>} Result object with count of cleaned up runs.
 */
const cleanupStalePendingRuns = async (maxAgeHours = 24) => {
  const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const staleRuns = await Run.find({
    status: "processing",
    createdAt: { $lt: cutoffDate },
  });

  console.log(
    `[Cleanup] Found ${staleRuns.length} stale runs (processing > ${maxAgeHours}h)`,
  );

  for (const run of staleRuns) {
    console.log(`[Cleanup] Marking run ${run._id} (${run.name}) as error`);
    await Run.findByIdAndUpdate(run._id, {
      $set: {
        status: "error",
        md5VerificationStatus: "failed",
      },
    });
  }

  return {
    cleaned: staleRuns.length,
    runIds: staleRuns.map((r) => r._id),
  };
};

module.exports = {
  verifyRunMd5,
  verifyReadMd5,
  findRunsNeedingVerification,
  recoverStalledVerifications,
  cleanupStalePendingRuns,
  MAX_RETRY_ATTEMPTS,
};
