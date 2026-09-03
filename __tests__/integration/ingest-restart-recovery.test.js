/**
 * Real Mongo, real filesystem: a run ingest that gets partway through moving
 * its files, then a simulated process restart re-invokes the exact same
 * production retry path (lib/ingest-queue.js runIngestJob, reached the same
 * way the real worker reaches it — enqueue, claim, run). Proves the retry
 * lands on a correct final state — every file present exactly once, the Run
 * genuinely "complete" — rather than the poisoned-retry failure mode a naive
 * retry falls into: re-processing a file a prior attempt already moved finds
 * its staged source gone (the move unlinks it), and the destination already
 * claimed by that prior attempt's own File/Read rows, so the retry cannot
 * adopt it either — the run gets stuck at "error" despite every byte already
 * being exactly where it belongs. planRawFileStage's `toMove` filter (see
 * lib/ingest-queue.js) is what closes that gap: a retry only re-moves what
 * is actually still missing, never what an earlier attempt already delivered.
 *
 * "Simulated restart" here means calling runIngestJob() a second time on the
 * same IngestJob document, fetched fresh from Mongo — the function holds no
 * in-memory state of its own between calls, so this is exactly what a second
 * process picking the job back up after a crash would do.
 */

const fs = require("fs");
const path = require("path");

const { configureEnv, restoreEnv } = require("./support/env");
const { connect, resetCollections, disconnect } = require("./support/mongo");
const { makeRunChain, writeStagedUpload } = require("./support/fixtures");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("ingest-restart-recovery");
  await connect();
});

afterAll(async () => {
  await disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await resetCollections();
});

describe("a partially-completed ingest survives a simulated restart", () => {
  test("a file already moved on attempt 1 is not re-processed, and the run reaches 'complete'", async () => {
    const { run } = await makeRunChain();
    const {
      enqueueRunIngest,
      claimNextJob,
      runIngestJob,
      IngestJob,
    } = require("../../lib/ingest-queue");
    const Read = require("../../models/Read");
    const File = require("../../models/File");
    const Run = require("../../models/Run");

    // File A: a genuinely staged, complete upload — this is the one that
    // will succeed on attempt 1.
    const uploadA = await writeStagedUpload({
      directory: process.env.UPLOAD_DIRECTORY,
      declaredSize: 200,
      owner: "it-owner",
    });

    // File B: NOT staged at all on attempt 1 (uploadName names nothing on
    // disk) — an entirely ordinary partial failure: the second file's upload
    // hadn't landed yet, or the request named it before it finished. This is
    // what makes attempt 1 genuinely partial rather than all-or-nothing.
    const missingUploadNameB = require("crypto")
      .randomBytes(16)
      .toString("hex");

    const payload = {
      rawFiles: [
        { uploadName: uploadA, name: "reads_A.fastq.gz", paired: false },
        {
          uploadName: missingUploadNameB,
          name: "reads_B.fastq.gz",
          paired: false,
        },
      ],
      additionalFiles: [],
      rawFilesUploadInfo: { method: "local-filesystem" },
      username: "it-owner",
    };

    const queued = await enqueueRunIngest({ runId: run._id, payload });
    const job1 = await claimNextJob({ workerId: "worker-1" });
    expect(job1).not.toBeNull();

    // Attempt 1: file A can succeed, file B cannot — runIngestJob must
    // reject overall (file B is a real failure), but file A's move still
    // happens inside it (Promise.allSettled, not Promise.all).
    await expect(runIngestJob(job1)).rejects.toThrow(
      /named upload does not belong to 'it-owner'/i,
    );

    const relPath = await run.getRelativePath();
    const destinationA = path.join(
      process.env.DATASTORE_ROOT,
      relPath,
      "raw",
      "reads_A.fastq.gz",
    );
    const aLandedAfterAttempt1 = await fs.promises
      .access(destinationA)
      .then(() => true)
      .catch(() => false);
    expect(aLandedAfterAttempt1).toBe(true);

    const readsAfterAttempt1 = await Read.find({ run: run._id });
    expect(readsAfterAttempt1).toHaveLength(1);
    expect(readsAfterAttempt1[0].file).toBeTruthy();

    // "Restart": the real failJob path already ran inside runIngestJob's
    // caller in production (lib/ingest-queue.js's processOne); here the
    // direct runIngestJob() call bypasses that wrapper, so this test drives
    // the same failure bookkeeping by hand before simulating the retry.
    await IngestJob.updateOne(
      { _id: queued._id },
      { $set: { status: "pending", leaseExpiresAt: null, workerId: null } },
    );

    // File B's upload now genuinely completes — the ordinary case this run
    // was always going to reach once its second file finished uploading.
    await writeStagedUpload({
      directory: process.env.UPLOAD_DIRECTORY,
      declaredSize: 150,
      owner: "it-owner",
      originalName: "reads_B.fastq.gz",
    }).then(async (idB) => {
      // The job's payload still names the OLD (missing) upload id for file
      // B — a real retry re-reads whatever the client originally sent, so
      // this rewrites the persisted job the same way a corrected re-POST
      // would: same file, now-valid uploadName.
      await IngestJob.updateOne(
        { _id: queued._id },
        { $set: { "payload.rawFiles.1.uploadName": idB } },
      );
    });

    const job2 = await claimNextJob({ workerId: "worker-2" });
    expect(job2).not.toBeNull();

    // The property under test: does the retry reach a correct final state,
    // or does it choke re-processing file A (whose staged source attempt 1
    // already consumed)?
    await runIngestJob(job2);

    const destinationB = path.join(
      process.env.DATASTORE_ROOT,
      relPath,
      "raw",
      "reads_B.fastq.gz",
    );
    const bLanded = await fs.promises
      .access(destinationB)
      .then(() => true)
      .catch(() => false);
    expect(bLanded).toBe(true);

    // File A must still be exactly where attempt 1 left it — not moved
    // again, not duplicated.
    const aStillThere = await fs.promises
      .access(destinationA)
      .then(() => true)
      .catch(() => false);
    expect(aStillThere).toBe(true);

    const finalReads = await Read.find({ run: run._id }).populate("file");
    expect(finalReads).toHaveLength(2);
    const finalNames = finalReads.map((r) => r.file.originalName).sort();
    expect(finalNames).toEqual(["reads_A.fastq.gz", "reads_B.fastq.gz"]);

    // No orphaned File document left over from a rejected re-claim attempt
    // on file A.
    const allFiles = await File.find({
      originalName: { $in: ["reads_A.fastq.gz", "reads_B.fastq.gz"] },
    });
    expect(allFiles).toHaveLength(2);

    const finalRun = await Run.findById(run._id);
    expect(finalRun.status).toBe("complete");
  });
});
