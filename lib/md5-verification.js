const _path = require("path");
const Read = require("../models/Read");
const Run = require("../models/Run");
const { calculateFileMd5 } = require("./utils/md5");

// Maximum retry attempts for MD5 verification
const MAX_RETRY_ATTEMPTS = 3;

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

  // Check if MD5 verification is disabled
  if (skipIfDisabled && process.env.SKIP_MD5_VERIFICATION === "true") {
    console.log(`[MD5 Verification] Skipped for run ${runId} (globally disabled)`);
    await Run.findByIdAndUpdate(runId, {
      $set: {
        md5VerificationStatus: "complete",
        md5VerificationCompletedAt: new Date(),
      },
    });
    return {
      success: true,
      skipped: true,
      message: "MD5 verification disabled globally",
    };
  }

  try {
    // Get the run and populate necessary fields
    const run = await Run.findById(runId).populate({
      path: "sample",
      populate: { path: "project" },
    }).populate("group");

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Update status to in_progress
    await Run.findByIdAndUpdate(runId, {
      $set: {
        md5VerificationStatus: "in_progress",
        md5VerificationLastAttempt: new Date(),
      },
      $inc: { md5VerificationAttempts: 1 },
    });

    console.log(
      `[MD5 Verification] Starting verification for run ${runId} (${run.name})`
    );

    // Get all reads for this run
    const reads = await Read.find({ run: runId }).populate("file");

    if (!reads || reads.length === 0) {
      console.log(`[MD5 Verification] No reads found for run ${runId}`);
      await Run.findByIdAndUpdate(runId, {
        $set: {
          md5VerificationStatus: "complete",
          md5VerificationCompletedAt: new Date(),
        },
      });
      return {
        success: true,
        filesVerified: 0,
        mismatches: 0,
        duration: Date.now() - startTime,
      };
    }

    // Verify each read's MD5
    const results = await Promise.all(
      reads.map((read) => verifyReadMd5(read, run))
    );

    const mismatches = results.filter((r) => r.mismatch).length;
    const errors = results.filter((r) => r.error).length;
    const verified = results.filter((r) => !r.error).length;

    const duration = Date.now() - startTime;

    // Log results
    console.log(
      `[MD5 Verification] Completed for run ${runId}: ${verified} verified, ${mismatches} mismatches, ${errors} errors (${duration}ms)`
    );

    // Update run status
    const finalStatus = errors > 0 ? "failed" : "complete";
    await Run.findByIdAndUpdate(runId, {
      $set: {
        md5VerificationStatus: finalStatus,
        md5VerificationCompletedAt: new Date(),
      },
    });

    return {
      success: finalStatus === "complete",
      filesVerified: verified,
      mismatches,
      errors,
      duration,
      runName: run.name,
    };
  } catch (error) {
    console.error(`[MD5 Verification] Error verifying run ${runId}:`, error);

    // Check if we should retry
    const run = await Run.findById(runId);
    const shouldRetry = run && run.md5VerificationAttempts < MAX_RETRY_ATTEMPTS;

    if (!shouldRetry) {
      // Max retries reached, mark as failed
      await Run.findByIdAndUpdate(runId, {
        $set: {
          md5VerificationStatus: "failed",
        },
      });
    }

    return {
      success: false,
      error: error.message,
      shouldRetry,
      attempts: run?.md5VerificationAttempts || 0,
    };
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
        `[MD5 Verification] No original MD5 for read ${read._id}, skipping`
      );
      return { readId: read._id, skipped: true };
    }

    // Calculate destination path
    const runPath = await run.getRelativePath();
    const destinationPath = _path.join(
      process.env.DATASTORE_ROOT,
      runPath,
      "raw",
      read.file.originalName
    );

    // Calculate MD5
    const destinationMd5 = await calculateFileMd5(destinationPath);
    const fileDuration = Date.now() - fileStartTime;

    // Compare checksums
    const mismatch = originalMd5 !== destinationMd5;

    if (mismatch) {
      console.warn(
        `[MD5 Verification] Mismatch for ${read.file.originalName}: expected ${originalMd5}, got ${destinationMd5}`
      );
    }

    // Update the Read document
    await Read.findByIdAndUpdate(read._id, {
      $set: {
        destinationMd5: destinationMd5,
        md5Mismatch: mismatch,
        MD5LastChecked: new Date(),
      },
    });

    console.log(
      `[MD5 Verification] ${read.file.originalName}: ${mismatch ? "MISMATCH" : "OK"} (${fileDuration}ms)`
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
      error
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
  const runs = await Run.find({
    md5VerificationStatus: "pending",
    status: "complete", // Only verify runs that completed file processing
    md5VerificationAttempts: { $lt: MAX_RETRY_ATTEMPTS },
  })
    .sort({ createdAt: 1 }) // Oldest first
    .limit(limit)
    .select("_id name");

  return runs;
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
    `[Cleanup] Found ${staleRuns.length} stale runs (processing > ${maxAgeHours}h)`
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
  cleanupStalePendingRuns,
  MAX_RETRY_ATTEMPTS,
};
