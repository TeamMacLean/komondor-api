/** A read-only interpretation, including runs written before result counters existed. */
function verificationSummary(run, reads = []) {
  const result = run.md5VerificationResult || {};
  const mismatches = reads.filter(
    (r) =>
      r.md5Mismatch === true ||
      (r.MD5 &&
        r.destinationMd5 &&
        r.MD5.toLowerCase() !== r.destinationMd5.toLowerCase()),
  ).length;
  const verified = reads.filter(
    (r) =>
      r.MD5 &&
      r.destinationMd5 &&
      r.md5Mismatch !== true &&
      r.MD5.toLowerCase() === r.destinationMd5.toLowerCase(),
  ).length;
  const skipped = reads.filter((r) => !r.MD5).length;
  const counts = { total: reads.length, verified, mismatches, skipped };
  // Old per-read results can remain during a retry; they are not the new
  // attempt's terminal outcome while verification is still running.
  if (["pending", "in_progress"].includes(run.md5VerificationStatus)) {
    return { ...counts, state: run.md5VerificationStatus };
  }
  if (mismatches > 0 || result.mismatches > 0)
    return { ...counts, state: "mismatch" };
  if (run.md5VerificationStatus === "failed" || result.errors > 0)
    return { ...counts, state: "failed" };
  if (run.status !== "complete") return { ...counts, state: "pending" };
  if (result.disabled) return { ...counts, state: "skipped" };
  if (run.md5VerificationStatus === "complete") {
    if (reads.length === 0 || skipped > 0)
      return { ...counts, state: "skipped" };
    if (verified === reads.length) return { ...counts, state: "passed" };
    // Never turn incomplete historical read records into a verification pass.
    return { ...counts, state: "failed" };
  }
  return {
    ...counts,
    state:
      run.md5VerificationStatus === "in_progress" ? "in_progress" : "pending",
  };
}

module.exports = { verificationSummary };
