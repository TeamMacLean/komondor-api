const express = require("express");
const { timingSafeEqual } = require("crypto");
const Run = require("../models/Run");
const Read = require("../models/Read");
const IngestJob = require("../models/IngestJob");
const { verificationSummary } = require("../lib/verification-summary");
const router = express.Router();

// Dedicated, read-only server-to-server credential. It cannot create records,
// fetch file contents, or authenticate against any normal user endpoint.
router.post("/internal/power/run-status", async (req, res) => {
  const expected = process.env.POWER_STATUS_TOKEN;
  if (!expected || expected.length < 32) {
    return res
      .status(503)
      .json({ error: "Power status monitoring is not configured" });
  }
  const supplied = req.get("X-Power-Status-Token") || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid monitoring credential" });
  }
  const { runIds, username } = req.body || {};
  if (
    !Array.isArray(runIds) ||
    runIds.length > 100 ||
    runIds.some((id) => typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) ||
    typeof username !== "string" ||
    !username.trim() ||
    username.length > 200
  ) {
    return res
      .status(400)
      .json({ error: "Provide a username and up to 100 run IDs" });
  }
  try {
    const ids = [...new Set(runIds.map((id) => id.toLowerCase()))];
    const runs = await Run.find({ _id: { $in: ids } })
      .select(
        "_id status statusError md5VerificationStatus md5VerificationResult",
      )
      .lean();
    const visibleIds = runs.map((run) => run._id);
    const [reads, jobs] = await Promise.all([
      Read.find({ run: { $in: visibleIds } })
        .select("run MD5 destinationMd5 md5Mismatch")
        .lean(),
      IngestJob.find({ runId: { $in: visibleIds }, type: "run-ingest" })
        .select("runId status lastError attempts")
        .lean(),
    ]);
    const returned = new Set(runs.map((run) => String(run._id)));
    return res.json({
      runs: runs.map((run) => {
        const job = jobs.find((j) => String(j.runId) === String(run._id));
        return {
          runId: String(run._id),
          status: run.status,
          statusError: run.statusError || null,
          ingest: job
            ? {
                status: job.status,
                lastError: job.lastError || null,
                attempts: job.attempts,
              }
            : null,
          verification: verificationSummary(
            run,
            reads.filter((r) => String(r.run) === String(run._id)),
          ),
        };
      }),
      missing: ids.filter((id) => !returned.has(id)),
    });
  } catch (error) {
    console.error(
      "[Power status] Could not read run status for",
      username,
      error.message,
    );
    return res
      .status(503)
      .json({ error: "Run status is temporarily unavailable" });
  }
});

module.exports = router;
