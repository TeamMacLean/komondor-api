const express = require("express");
const router = express.Router();
const _path = require("path");

const Run = require("../models/Run");
const Sample = require("../models/Sample");
const { isAuthenticated } = require("./middleware");
const {
  canReadGroup,
  canWriteGroup,
  groupsICanRead,
} = require("../lib/utils/groupAccess");
// Taken as a namespace as well as by name: requeueFailedIngest below prefers
// the queue's own reset when lib/ingest-queue.js exports one, and a
// destructured import would freeze that decision at require time.
const ingestQueue = require("../lib/ingest-queue");
const {
  visibleGroupIds,
} = require("../lib/utils/fullAccessUsers");
const { enqueueRunIngest, idempotencyKeyFor, IngestJob } = ingestQueue;
const {
  handleError,
  generateRequestId,
  compareFilesToDirectory,
} = require("./_utils");

// A well-formed object id and nothing else.
//
// Deliberately stricter than mongoose's own ObjectId.isValid(), which accepts
// any 12-character string as raw bytes (so "sample_names" passes) and accepts
// any object whose toString() is 24 characters long.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Narrows a client-supplied value to an object id string.
 *
 * Anything that is not a plain string is refused before it can reach a query.
 * A JSON body can carry `{"$ne": null}` where an id belongs, and a bracketed
 * query string (`?id[$ne]=null`) is parsed into the same shape by express;
 * mongoose 5 preserves that object through casting, so it arrives at MongoDB
 * as an operator and matches an arbitrary document instead of none. That is
 * how `Run.findOne({ sample, name })` could hand back a run from any group,
 * populated with its whole file list, before anything was authorised.
 *
 * Returned exactly as it was submitted, which is how routes/projects.js and
 * routes/samples.js narrow the same values. Nothing needs it rewritten:
 * MongoDB casts hex without regard to case, and the string comparisons this
 * file makes with an id (does the submitted group match the sample's, was a
 * requested id among those returned) go through sameObjectId below. What does
 * need it unrewritten is the caller: batch-status names the ids it could not
 * answer for, and a caller matching that list against what it sent finds
 * nothing if the case has been changed underneath it.
 *
 * @param {*} value - A value taken from req.body, req.query or req.params.
 * @returns {string|null} The id, or null if it is not one.
 */
const asObjectIdString = (value) =>
  typeof value === "string" && OBJECT_ID_PATTERN.test(value) ? value : null;

/**
 * Whether two object ids name the same document.
 *
 * Case-insensitive, because hex is: an id submitted as "6A8C..." is the same
 * id as the "6a8c..." MongoDB stores, and a plain === reads that as a
 * mismatch — which here would mean a 400 or a 403 for a legitimate member.
 *
 * @param {*} a - An id, in any of the forms this file holds one.
 * @param {*} b - The id to compare it with.
 * @returns {boolean} True if both are present and name the same document.
 */
const sameObjectId = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The group id of a document whose `group` ref may or may not be populated.
 *
 * @param {object} doc - A document with a `group` field.
 * @returns {*} The group id, or null when there is no group.
 */
const groupIdOf = (doc) => {
  const group = doc && doc.group;

  if (!group) {
    return null;
  }

  return group._id || group;
};

// Only the fields the status endpoints report, so a job's payload — which is
// the whole submitted file list — is never pulled into a status response.
const INGEST_JOB_FIELDS =
  "runId status attempts maxAttempts lastError createdAt updatedAt";

/**
 * The ingest jobs for a set of runs, keyed by run id.
 *
 * Looked up by idempotency key rather than by runId so the queue keeps a
 * single definition of how a run maps to its job (lib/ingest-queue.js).
 *
 * @param {Array<mongoose.Types.ObjectId|string>} runIds - The runs to look up.
 * @returns {Promise<Map<string, mongoose.Document>>} Jobs keyed by run id.
 */
const findIngestJobs = async (runIds) => {
  const byRunId = new Map();

  if (!runIds || runIds.length === 0) {
    return byRunId;
  }

  const jobs = await IngestJob.find({
    idempotencyKey: { $in: runIds.map((runId) => idempotencyKeyFor(runId)) },
  }).select(INGEST_JOB_FIELDS);

  (jobs || []).forEach((job) => byRunId.set(String(job.runId), job));

  return byRunId;
};

/**
 * The queue's view of a run's ingest, in the shape the status endpoints report.
 *
 * Null means nothing was ever queued, which is what every run created before
 * the queue existed looks like — not an error, and deliberately distinct from
 * a job sitting at "pending".
 *
 * @param {mongoose.Document} [job] - The run's IngestJob, if it has one.
 * @returns {object|null} A summary safe to send to a client.
 */
const summariseIngestJob = (job) =>
  job
    ? {
        jobId: job._id,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError || null,
        queuedAt: job.createdAt,
        updatedAt: job.updatedAt,
      }
    : null;

/**
 * Returns a permanently failed ingest job to the queue.
 *
 * Prefers lib/ingest-queue.js's own reset, which is where this belongs: the
 * queue owns what "queued again" means. That export now exists
 * (`requeueRunIngest`), so the branch below is the taken one in production;
 * the local write is kept as a fallback so this route still works against a
 * queue module that does not export it. Both resolve to the requeued job, or
 * to null when there was no failed job to requeue.
 *
 * The two must stay in step. If the export ever gains different semantics —
 * notably one that does NOT reset attempts to 0, or that resets a job which
 * has not failed — this route adopts them silently, and its own tests mock the
 * queue so they would not catch it. __tests__/lib/ingest-queue.test.js pins the
 * contract on the other side.
 *
 * `attempts` goes back to zero deliberately. claimNextJob increments attempts
 * as it claims and fails outright anything past maxAttempts, so a job left at
 * its exhausted count would be marked failed again on the very next poll
 * without the ingest ever being re-attempted.
 *
 * The status is matched inside the update rather than checked first: a job a
 * worker has claimed in the meantime must not be dragged back to pending
 * underneath it, and only an atomic match can promise that.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.runId - The run to re-ingest.
 * @param {string} [params.requestId] - The asking request, for log correlation.
 * @returns {Promise<mongoose.Document|null>} The requeued job, or null.
 */
const requeueFailedIngest = async ({ runId, requestId }) => {
  if (typeof ingestQueue.requeueRunIngest === "function") {
    return ingestQueue.requeueRunIngest({ runId, requestId });
  }

  return IngestJob.findOneAndUpdate(
    { idempotencyKey: idempotencyKeyFor(runId), status: "failed" },
    {
      $set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        workerId: null,
        // Claimable immediately. Backoff exists to keep a worker off a full
        // disk; an operator asking for this retry has already been the wait.
        leaseExpiresAt: null,
        requestId,
      },
    },
    { new: true },
  );
};

/**
 * GET /runs
 * Fetches all runs visible to the authenticated user, sorted by most recent.
 */
router
  .route("/runs")
  .all(isAuthenticated)
  .get(async (req, res) => {
    try {
      // iCanSee is a custom static on the Run model. The live group ids are
      // resolved first — see routes/projects.js.
      const groupIds = await visibleGroupIds(req.user);
      const runs = await Run.iCanSee(req.user, groupIds)
        .populate("group")
        .sort("-createdAt")
        .exec();
      res.status(200).send({ runs });
    } catch (error) {
      handleError(res, error, 500, "Failed to retrieve runs.");
    }
  });

/**
 * GET /runs/names/:sampleId
 * Fetches all unique run names for a given sample.
 * Used for validation when creating new runs to prevent duplicate names.
 */
router
  .route("/runs/names/:sampleId")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const sampleId = asObjectIdString(req.params.sampleId);

    if (!sampleId) {
      return handleError(res, new Error("A valid sample ID is required."), 400);
    }

    try {
      // A run name belongs to whoever may see the sample it hangs off. This
      // endpoint used to answer for any sample id at all, so run names — which
      // carry project and experiment detail — leaked across every group.
      const sample = await Sample.findById(sampleId).select("group");

      if (!sample) {
        return handleError(res, new Error("Sample not found."), 404);
      }

      if (!(await canReadGroup(req.user, sample.group))) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to view this sample.`,
          ),
          403,
        );
      }

      // Find all runs for this sample and get their names
      const runs = await Run.find({ sample: sampleId }).select("name").exec();

      // Extract names and filter out null/undefined/empty values
      const runNames = runs
        .map((run) => run.name)
        .filter((name) => name && name.trim() !== "");

      // Return unique names only
      const uniqueRunNames = [...new Set(runNames)];

      res.status(200).send({ runNames: uniqueRunNames });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to retrieve run names for sample ${sampleId}.`,
      );
    }
  });

/**
 * GET /run?id=:id
 * Fetches a single run by its ID, along with its associated data and files on disk.
 */
router
  .route("/run")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const id = asObjectIdString(req.query.id);
    if (!id) {
      return handleError(res, new Error("A valid run ID is required."), 400);
    }

    try {
      const run = await Run.findById(id)
        .populate("group")
        .populate("sample")
        .populate({ path: "additionalFiles", populate: { path: "file" } })
        .populate({ path: "rawFiles", populate: { path: "file" } })
        .exec();

      if (!run) {
        return handleError(res, new Error("Run not found."), 404);
      }

      // Permission check: user must be able to read the run's group, or own it.
      // A run whose group has been soft-deleted resolves to no group at all,
      // which canReadGroup refuses — so it stays visible only to its owner.
      //
      // The owner fallback survives only because `owner` is now stamped from
      // the session at creation (see POST /runs/new) rather than copied out of
      // req.body. While it was client-supplied this branch was a read grant
      // any caller could hand to any username; it is now a statement about who
      // actually submitted the run.
      const canAccess = await canReadGroup(
        req.user,
        run.group && run.group._id,
      );
      const isOwner = run.owner === req.user.username;
      if (!canAccess && !isOwner) {
        return handleError(
          res,
          new Error(`User '${req.user.username}' does not have permission to view this run.`),
          403,
        );
      }

      const runDirectory = _path.join(process.env.DATASTORE_ROOT, run.path);
      const rawDir = _path.join(runDirectory, "raw");
      const additionalDir = _path.join(runDirectory, "additional");

      const [raw, additional] = await Promise.all([
        compareFilesToDirectory(run.rawFiles, rawDir),
        compareFilesToDirectory(run.additionalFiles, additionalDir),
      ]);

      const actualReads = raw.actualFiles;
      const rawFilesStatus = raw.status;
      const actualAdditionalFiles = additional.actualFiles;
      const additionalFilesStatus = additional.status;

      res.status(200).send({
        run,
        actualReads,
        actualAdditionalFiles,
        additionalFilesStatus,
        rawFilesStatus
      });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve run ${id}.`);
    }
  });

/**
 * Validates the request body for creating a new run.
 * @param {object} body - The request body
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
const validateNewRunRequest = (body) => {
  const errors = [];
  const required = [
    "sample",
    "name",
    "sequencingProvider",
    "sequencingTechnology",
    "librarySource",
    "libraryType",
    "librarySelection",
    "libraryStrategy",
    "owner",
    "group",
  ];

  // Check required fields
  for (const field of required) {
    if (!body[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type-guard the boundary. `{"$ne": null}` is truthy, so it satisfies the
  // required check above and then reaches Run.findOne as a query operator; the
  // rest are checked here so a non-string can never be stored as one either.
  ["sample", "group"].forEach((field) => {
    if (body[field] && !asObjectIdString(body[field])) {
      errors.push(`${field} must be a valid ID`);
    }
  });

  [
    "name",
    "sequencingProvider",
    "sequencingTechnology",
    "librarySource",
    "libraryType",
    "librarySelection",
    "libraryStrategy",
    // Still required and still type-checked so the request shape is unchanged
    // for existing clients, but the stored owner is req.user.username — the
    // body's claim about it is validated and then ignored.
    "owner",
  ].forEach((field) => {
    if (body[field] && typeof body[field] !== "string") {
      errors.push(`${field} must be a string`);
    }
  });

  // Validate name length
  if (
    typeof body.name === "string" &&
    (body.name.length < 3 || body.name.length > 80)
  ) {
    errors.push("Run name must be between 3 and 80 characters");
  }

  // Validate rawFiles
  if (!body.rawFiles || body.rawFiles.length === 0) {
    errors.push("At least one raw file is required");
  }

  // Validate rawFilesUploadInfo
  if (!body.rawFilesUploadInfo || !body.rawFilesUploadInfo.method) {
    errors.push("Upload method is required (rawFilesUploadInfo.method)");
  } else if (
    !["hpc-mv", "local-filesystem"].includes(body.rawFilesUploadInfo.method)
  ) {
    errors.push(
      "Invalid upload method. Must be 'hpc-mv' or 'local-filesystem'",
    );
  }

  // For HPC uploads, validate relativePath
  if (body.rawFilesUploadInfo?.method === "hpc-mv") {
    if (
      !body.rawFilesUploadInfo.relativePath &&
      !body.rawFiles?.[0]?.relativePath
    ) {
      errors.push("HPC uploads require a relativePath");
    }
  }

  // Validate each raw file has required properties
  if (body.rawFiles && Array.isArray(body.rawFiles)) {
    body.rawFiles.forEach((file, index) => {
      const fileName = file.name || file.data?.name;
      if (!fileName) {
        errors.push(`Raw file at index ${index} is missing a name`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
};

/**
 * POST /runs/new
 * Creates a new run and queues the ingest of its files.
 */
router
  .route("/runs/new")
  .all(isAuthenticated)
  .post(async (req, res) => {
    let savedRun; // To hold the created run document for potential rollback
    const requestId = generateRequestId();

    try {
      // Validate request body before proceeding
      const validation = validateNewRunRequest(req.body);
      if (!validation.valid) {
        console.error(`[${requestId}] Validation failed:`, validation.errors);
        return handleError(
          res,
          new Error(validation.errors.join("; ")),
          400,
          `Validation failed: ${validation.errors.join("; ")}`,
          requestId,
        );
      }

      const {
        name,
        sequencingProvider,
        sequencingTechnology,
        librarySource,
        libraryType,
        librarySelection,
        libraryStrategy,
        insertSize,
        additionalFiles,
        rawFiles,
        rawFilesUploadInfo,
      } = req.body;

      // Guarded above; re-narrowed here so the value that reaches a query is
      // provably the checked one rather than a second read of req.body.
      const sampleId = asObjectIdString(req.body.sample);

      // The run's group is the sample's group, never the body's claim about it.
      // The old code authorised req.body.group and then attached the run to
      // req.body.sample without ever checking the two belonged together, so a
      // member of any group could hang a run — and its files — off another
      // group's sample.
      const parentSample = await Sample.findById(sampleId).select("group");
      if (!parentSample) {
        return handleError(
          res,
          new Error("The submitted sample does not exist."),
          400,
          "The submitted sample does not exist.",
          requestId,
        );
      }

      const group = parentSample.group;

      // Creating a run is a write, so it takes write access. Read access
      // across all groups (FULL_RECORDS_ACCESS_USERS) is deliberately not
      // enough — that conflation is what lib/utils/groupAccess.js exists to end.
      const canCreate = await canWriteGroup(req.user, group);
      if (!canCreate) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to create a run in this group.`,
          ),
          403,
          "Permission denied",
          requestId,
        );
      }

      // Checked after the permission decision, so a caller who may not write
      // to the sample's group learns nothing about which group owns it.
      if (!sameObjectId(asObjectIdString(req.body.group), group)) {
        return handleError(
          res,
          new Error("The submitted group does not own the submitted sample."),
          400,
          "The submitted group does not own the submitted sample.",
          requestId,
        );
      }

      // The idempotent answer: authorise the run that came back, queue its
      // ingest, and report it as a 200 rather than a fresh 201.
      //
      // Hoisted out of the findOne branch below because the unique index on
      // { sample, name } gives a second way to arrive here: two concurrent
      // retries of a lost 201 both miss the findOne, and whichever loses the
      // save race gets an E11000 for a run that demonstrably exists. That is
      // the same situation, and it must produce the same answer.
      const respondWithExistingRun = async (existingRun) => {
        // Authorise what came back, not only what was asked for. A run carries
        // its own group field, which need not still agree with its sample's —
        // every run predating this remediation can disagree, because the old
        // code stored req.body.group unchecked.
        //
        // Write access, not read. This branch is not a lookup: it enqueues an
        // ingest carrying the caller's own rawFiles payload against the run
        // that came back, which moves those files into that run's datastore
        // directory and writes Reads against it. FULL_RECORDS_ACCESS_USERS
        // read every group and write none, so gating this on canReadGroup
        // handed exactly those users a write into any group holding a run
        // whose group no longer matches its sample's.
        if (!(await canWriteGroup(req.user, groupIdOf(existingRun)))) {
          return handleError(
            res,
            new Error(
              `User '${req.user.username}' does not have permission to modify this run.`,
            ),
            403,
            "Permission denied",
            requestId,
          );
        }

        console.log(
          `[${requestId}] Run already exists: ${existingRun._id} (${existingRun.name})`,
        );

        // Queue here too. The key is the run id, so this returns the job that
        // already exists rather than doubling the work — and without it a
        // client retrying after a lost 201 has no way to re-trigger an ingest
        // that never happened.
        const existingJob = await enqueueRunIngest({
          runId: existingRun._id,
          requestId,
          payload: {
            rawFiles,
            additionalFiles,
            rawFilesUploadInfo,
            // Recorded at enqueue time and used at claim time: the person who
            // submitted the run is the person whose staged uploads it claims.
            username: req.user.username,
          },
        });

        // Return existing run (silent idempotency - 200 OK)
        return res.status(200).send({
          run: existingRun,
          idempotent: true,
          jobId: existingJob ? existingJob._id : null,
          message: "Run with this name already exists for this sample",
        });
      };

      // Check for existing run with same name and sample (idempotency).
      // Both values are narrowed above, so neither can arrive as an operator.
      const existingRun = await Run.findOne({
        sample: sampleId,
        name,
      }).populate("rawFiles additionalFiles");

      if (existingRun) {
        return respondWithExistingRun(existingRun);
      }

      const newRun = new Run({
        sample: sampleId,
        name,
        sequencingProvider,
        sequencingTechnology,
        librarySource,
        libraryType,
        librarySelection,
        libraryStrategy,
        insertSize: insertSize || null,
        // The session, never the body. `owner` arriving from req.body was an
        // unvalidated client string, and the per-record owner fallbacks below
        // read it as an access grant.
        owner: req.user.username,
        group,
      });

      try {
        savedRun = await newRun.save();
      } catch (saveError) {
        // The unique index on { sample, name } turns the idempotency race into
        // an error instead of a duplicate. Losing that race means the run this
        // request wanted now exists, so re-read it and answer exactly as the
        // findOne hit above would have. Anything else is a real failure.
        if (saveError && saveError.code === 11000) {
          const raced = await Run.findOne({ sample: sampleId, name }).populate(
            "rawFiles additionalFiles",
          );

          if (raced) {
            console.log(
              `[${requestId}] Lost the create race for run '${name}'; serving the winner ${raced._id}`,
            );
            return respondWithExistingRun(raced);
          }
        }

        throw saveError;
      }

      // The file work is recorded in the database BEFORE the client is told
      // yes. It used to run in a setImmediate() closure fired after
      // res.status(201), which existed only in this process's memory: PM2
      // SIGKILLs 30s into a deploy, and anything still in that closure was
      // gone with nothing anywhere to say it had been accepted. Awaited, so a
      // queue that cannot record the work fails the request instead of
      // returning a 201 for an ingest nobody will ever run.
      const job = await enqueueRunIngest({
        runId: savedRun._id,
        requestId,
        payload: {
            rawFiles,
            additionalFiles,
            rawFilesUploadInfo,
            // Recorded at enqueue time and used at claim time: the person who
            // submitted the run is the person whose staged uploads it claims.
            username: req.user.username,
          },
      });

      if (!job) {
        throw new Error("The ingest job could not be queued");
      }

      // The 201 shape is preserved — komondor-power parses `run` — with jobId
      // added so a client can poll the ingest it just caused.
      res.status(201).send({ run: savedRun, jobId: job._id });
    } catch (error) {
      // If an error occurs after the run has been saved, we must roll back the
      // change. A failed enqueue lands here: a run with no queued ingest would
      // sit at "pending" forever, so it must not survive the request.
      if (savedRun && savedRun._id) {
        await Run.deleteOne({ _id: savedRun._id });
        // Note: This does not clean up partially moved/created files.
        // A more robust transaction or cleanup mechanism would be needed for that.
      }

      if (error.name === "ValidationError") {
        return handleError(
          res,
          error,
          400,
          `Run validation failed: ${error.message}`,
          requestId,
        );
      }

      handleError(
        res,
        error,
        500,
        `Failed to create new run: ${error.message}`,
        requestId,
      );
    }
  });

/**
 * GET /runs/:id/status
 * Returns detailed status information about a run, including its queued ingest
 * and MD5 verification progress.
 */
router
  .route("/runs/:id/status")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const requestId = generateRequestId();

    const runId = asObjectIdString(req.params.id);
    if (!runId) {
      return handleError(
        res,
        new Error("A valid run ID is required."),
        400,
        "A valid run ID is required.",
        requestId,
      );
    }

    try {
      const run = await Run.findById(runId)
        .populate("rawFiles")
        .populate("additionalFiles");

      if (!run) {
        return handleError(
          res,
          new Error("Run not found"),
          404,
          "Run not found",
          requestId,
        );
      }

      // Permission check: reading a status is a read.
      const canAccess = await canReadGroup(req.user, run.group);
      const isOwner = run.owner === req.user.username;
      if (!canAccess && !isOwner) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          `User '${req.user.username}' does not have permission to view this run`,
          requestId,
        );
      }

      // Get raw files with MD5 verification details
      const Read = require("../models/Read");
      const reads = await Read.find({ run: run._id }).populate("file");

      const md5Details = reads.map((read) => ({
        fileName: read.file?.originalName,
        md5Original: read.MD5,
        md5Destination: read.destinationMd5,
        md5Mismatch: read.md5Mismatch,
        lastChecked: read.MD5LastChecked,
      }));

      const totalFiles = reads.length;
      const verifiedFiles = reads.filter((r) => r.destinationMd5).length;
      const mismatchedFiles = reads.filter(
        (r) => r.md5Mismatch === true,
      ).length;

      // The ingest job answers the question md5VerificationStatus cannot: a run
      // stuck at "pending" with no files is either queued, being worked on, or
      // permanently failed, and only the queue knows which.
      const ingestJobs = await findIngestJobs([run._id]);

      res.status(200).send({
        runId: run._id,
        runName: run.name,
        status: run.status,
        statusError: run.statusError || null,
        ingest: summariseIngestJob(ingestJobs.get(String(run._id))),
        md5VerificationStatus: run.md5VerificationStatus,
        md5VerificationAttempts: run.md5VerificationAttempts,
        md5VerificationLastAttempt: run.md5VerificationLastAttempt,
        md5VerificationCompletedAt: run.md5VerificationCompletedAt,
        progress: {
          totalFiles,
          verifiedFiles,
          mismatchedFiles,
          percentComplete:
            totalFiles > 0
              ? Math.round((verifiedFiles / totalFiles) * 100)
              : 100,
        },
        files: md5Details,
      });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to get run status: ${error.message}`,
        requestId,
      );
    }
  });

/**
 * POST /runs/:id/reingest
 * Returns a permanently failed ingest to the queue.
 *
 * Its own endpoint on purpose, rather than something a repeated POST
 * /runs/new does by itself. enqueueRunIngest is $setOnInsert, so a re-POST
 * finds the dead job and changes nothing — which is why a failed ingest had
 * no retry at all short of editing the database — but making that call re-run
 * the ingest instead would mean any duplicate submission replays file moves
 * over a run that is already healthy. A retry has to be asked for.
 */
router
  .route("/runs/:id/reingest")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const requestId = generateRequestId();

    const runId = asObjectIdString(req.params.id);
    if (!runId) {
      return handleError(
        res,
        new Error("A valid run ID is required."),
        400,
        "A valid run ID is required.",
        requestId,
      );
    }

    try {
      const run = await Run.findById(runId).select("name group owner status");

      if (!run) {
        return handleError(
          res,
          new Error("Run not found"),
          404,
          "Run not found",
          requestId,
        );
      }

      // An ingest moves files into this run's datastore directory and writes
      // Reads against it, so retrying one takes write access to the run's
      // group. There is deliberately no owner fallback here of the kind the
      // status endpoints have: those answer a question, this does work.
      if (!(await canWriteGroup(req.user, groupIdOf(run)))) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          `User '${req.user.username}' does not have permission to modify this run`,
          requestId,
        );
      }

      const job = await requeueFailedIngest({ runId: run._id, requestId });

      if (!job) {
        // Nothing was reset, which is either "there is no job" or "there is
        // one and it has not failed". Those need different answers, and the
        // caller cannot act on the difference unless it is told.
        const existing = await IngestJob.findOne({
          idempotencyKey: idempotencyKeyFor(run._id),
        }).select(INGEST_JOB_FIELDS);

        if (!existing) {
          return handleError(
            res,
            new Error("No ingest job"),
            404,
            "This run has no ingest job to retry",
            requestId,
          );
        }

        return handleError(
          res,
          new Error("Ingest has not failed"),
          409,
          `The ingest for this run is '${existing.status}', not 'failed'; only a failed ingest can be retried`,
          requestId,
        );
      }

      // failJob pushes a permanent failure onto the run as status "error" so a
      // dead ingest surfaces where every other broken one does. That is no
      // longer true once the work is queued again, and leaving it would show
      // the run as broken while its retry is pending.
      //
      // Logged rather than thrown: the requeue is the durable part and it has
      // already happened, so failing the request over the run's display status
      // would tell the operator the retry did not happen when it did.
      try {
        await Run.updateOne(
          { _id: run._id },
          { $set: { status: "pending", statusError: null } },
        );
      } catch (statusError) {
        console.error(
          `[${requestId}] Requeued the ingest for run ${run._id} but could not clear its error status:`,
          statusError,
        );
      }

      console.log(
        `[${requestId}] Requeued ingest job ${job._id} for run ${run._id} at the request of '${req.user.username}'`,
      );

      res.status(200).send({
        runId: run._id,
        jobId: job._id,
        ingest: summariseIngestJob(job),
        message: "The failed ingest has been returned to the queue",
      });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to requeue the ingest: ${error.message}`,
        requestId,
      );
    }
  });

/**
 * POST /runs/batch-status
 * Returns status information for multiple runs at once.
 * Body: { runIds: [...] }
 *
 * Every requested id is accounted for in the response: an id that produced no
 * entry in `runs` appears in `missing`, and one that was not a well-formed id
 * appears in `invalid`. komondor-power reads a short `runs` array as a complete
 * answer, so a silently dropped id reads as a run that finished.
 */
router
  .route("/runs/batch-status")
  .all(isAuthenticated)
  .post(async (req, res) => {
    const requestId = generateRequestId();

    try {
      const { runIds } = req.body;

      if (!runIds || !Array.isArray(runIds)) {
        return handleError(
          res,
          new Error("Invalid request"),
          400,
          "runIds must be an array",
          requestId,
        );
      }

      if (runIds.length > 100) {
        return handleError(
          res,
          new Error("Too many runs requested"),
          400,
          "Maximum 100 runs per request",
          requestId,
        );
      }

      // Partition before querying: a malformed id must not reach the query, and
      // the caller has to be told which of its ids were dropped.
      //
      // Keyed by the lower-cased id but holding the id as it was submitted:
      // two spellings of the same hex are one requested run, and the caller
      // gets its own spelling back in `missing`.
      const invalid = [];
      const wanted = new Map();
      runIds.forEach((value) => {
        const id = asObjectIdString(value);
        if (id) {
          if (!wanted.has(id.toLowerCase())) {
            wanted.set(id.toLowerCase(), id);
          }
        } else {
          // Truncated: this is echoed straight back, and an id is 24
          // characters, so anything longer is not one and need not be quoted
          // in full to be recognised.
          invalid.push(String(value).slice(0, 64));
        }
      });

      const requested = [...wanted.values()];

      const runs = requested.length
        ? await Run.find({ _id: { $in: requested } }).select(
            "_id name status statusError md5VerificationStatus md5VerificationAttempts md5VerificationLastAttempt md5VerificationCompletedAt group owner createdAt",
          )
        : [];

      // One read of the user's groups for the whole batch. Asking per run cost
      // a round-trip each, up to a hundred of them for a single request.
      const readableGroups = new Set(
        (await groupsICanRead(req.user))
          .map((group) => group && group._id && String(group._id))
          .filter(Boolean),
      );

      const visibleRuns = (runs || []).filter(
        (run) =>
          readableGroups.has(String(run.group)) ||
          run.owner === req.user.username,
      );

      const ingestJobs = await findIngestJobs(visibleRuns.map((run) => run._id));

      const accessibleRuns = visibleRuns.map((run) => ({
        runId: run._id,
        runName: run.name,
        status: run.status,
        statusError: run.statusError || null,
        ingest: summariseIngestJob(ingestJobs.get(String(run._id))),
        md5VerificationStatus: run.md5VerificationStatus,
        md5VerificationAttempts: run.md5VerificationAttempts,
        md5VerificationLastAttempt: run.md5VerificationLastAttempt,
        md5VerificationCompletedAt: run.md5VerificationCompletedAt,
        createdAt: run.createdAt,
      }));

      // Lower-cased on both sides of the comparison below: `requested` holds
      // whatever spelling the caller sent, and a run's own id is always lower
      // case, so an id sent in upper case would otherwise be reported missing
      // in the same response that answers for it.
      const returned = new Set(
        accessibleRuns.map((run) => String(run.runId).toLowerCase()),
      );

      // Deliberately does not distinguish "no such run" from "not yours". The
      // caller needs to know the id is absent so it stops reading a short array
      // as a complete answer; saying which of the two it was would turn this
      // endpoint into an existence oracle for other groups' runs.
      const missing = requested.filter((id) => !returned.has(id.toLowerCase()));

      res.status(200).send({
        runs: accessibleRuns,
        total: accessibleRuns.length,
        requested: requested.length,
        missing,
        invalid,
      });
    } catch (error) {
      handleError(
        res,
        error,
        500,
        `Failed to get batch status: ${error.message}`,
        requestId,
      );
    }
  });

module.exports = router;
