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
// Namespace as well as named: requeueFailedIngest below prefers the queue's own
// reset if it exports one, and destructuring would freeze that at require time.
const ingestQueue = require("../lib/ingest-queue");
const { visibleGroupIds } = require("../lib/utils/fullAccessUsers");
const { enqueueRunIngest, idempotencyKeyFor, IngestJob } = ingestQueue;
const {
  handleError,
  generateRequestId,
  compareFilesToDirectory,
} = require("./_utils");

// Stricter than ObjectId.isValid(), which accepts any 12-character string.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Narrows a client-supplied value to an object id string.
 * Non-strings are refused before reaching a query: mongoose preserves a body's
 * `{"$ne": null}` through casting, where it matches an arbitrary document.
 * Returned exactly as submitted, because batch-status echoes ids back to the
 * caller, which then matches them against what it sent.
 * @param {*} value - Value from req.body, req.query or req.params.
 * @returns {string|null} The id, or null if it is not one.
 */
const asObjectIdString = (value) =>
  typeof value === "string" && OBJECT_ID_PATTERN.test(value) ? value : null;

/**
 * Whether two object ids name the same document.
 * Case-insensitive, because hex is: a plain === reads "6A8C…" and the stored
 * "6a8c…" as a mismatch, which here means a 403 for a legitimate member.
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

// Only what the status endpoints report: a job's payload is the whole submitted
// file list and must not be pulled into a status response.
const INGEST_JOB_FIELDS =
  "runId status attempts maxAttempts lastError createdAt updatedAt";

/**
 * The ingest jobs for a set of runs, keyed by run id. Looked up by idempotency
 * key, so lib/ingest-queue.js keeps the only definition of run-to-job.
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
 * Null means nothing was ever queued (as for runs predating the queue), which
 * is distinct from a job sitting at "pending".
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
 * Returns a permanently failed ingest job to the queue, preferring the queue's
 * own reset; the local write below must stay in step with it.
 * `attempts` resets to 0: claimNextJob fails anything past maxAttempts outright,
 * so an exhausted job would be failed again on the next poll. The status is
 * matched inside the update so a job a worker just claimed is not dragged back.
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.runId - The run to re-ingest.
 * @param {string} [params.requestId] - The asking request, for log correlation.
 * @param {object} [params.payload] - If given, replaces the job's stored
 *   payload instead of replaying it. lib/ingest-queue.js has no export for
 *   this yet (see crossFileNeeds), so it is applied here directly rather than
 *   through ingestQueue.requeueRunIngest, which would silently ignore it.
 * @returns {Promise<mongoose.Document|null>} The requeued job, or null.
 */
const requeueFailedIngest = async ({ runId, requestId, payload }) => {
  if (
    payload === undefined &&
    typeof ingestQueue.requeueRunIngest === "function"
  ) {
    return ingestQueue.requeueRunIngest({ runId, requestId });
  }

  const set = {
    status: "pending",
    attempts: 0,
    lastError: null,
    workerId: null,
    // Claimable immediately: an operator asking for a retry has waited.
    leaseExpiresAt: null,
    requestId,
  };
  if (payload !== undefined) {
    set.payload = payload;
  }

  return IngestJob.findOneAndUpdate(
    { idempotencyKey: idempotencyKeyFor(runId), status: "failed" },
    { $set: set },
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
      // Run names carry project and experiment detail, so this is authorised
      // against the sample the runs hang off.
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

      const runs = await Run.find({ sample: sampleId }).select("name").exec();

      const runNames = runs
        .map((run) => run.name)
        .filter((name) => name && name.trim() !== "");

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

      // Group membership is the whole test; no owner fallback (see
      // lib/utils/groupAccess).
      const canAccess = await canReadGroup(
        req.user,
        run.group && run.group._id,
      );
      if (!canAccess) {
        return handleError(
          res,
          new Error(
            `User '${req.user.username}' does not have permission to view this run.`,
          ),
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
        rawFilesStatus,
      });
    } catch (error) {
      handleError(res, error, 500, `Failed to retrieve run ${id}.`);
    }
  });

/**
 * A rawFiles/additionalFiles entry's declared name, however the client spelled
 * it — lib/file-utils.js createFileDocument reads `.name` for every method,
 * with `.data.name` as the shape an older upload widget used.
 * @param {*} file - A candidate file entry.
 * @returns {*} The name, or a falsy value if there is none.
 */
const fileEntryName = (file) => file && file.name;

/**
 * The reason lib/file-utils.js createFileDocument would reject one rawFiles or
 * additionalFiles entry, or null if the entry is well-formed. Checked before
 * the entry ever reaches a durable job — a shape createFileDocument refuses
 * used to surface only when a worker processed the job, deep inside file
 * processing rather than at the door.
 * @param {*} file - The candidate entry.
 * @param {string} [method] - 'hpc-mv' or 'local-filesystem' for this entry.
 * @param {boolean} [relativePathCovered] - True when a relativePath elsewhere
 *   in the request (rawFilesUploadInfo) already applies to this entry —
 *   createFileDocument falls back to it for rawFiles. Always false for
 *   additionalFiles, which only ever carry their own relativePath.
 * @returns {string|null} A message fragment, e.g. "is missing a name".
 */
const fileEntryShapeError = (file, method, relativePathCovered) => {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return "must be an object";
  }

  const name = fileEntryName(file);
  if (!name || typeof name !== "string") {
    // createFileDocument reads file.name and nothing else. A nested
    // `data.name` used to satisfy this check and then fail inside the worker,
    // so it is refused here with a message naming the field to send.
    if (file.data && typeof file.data === "object" && file.data.name) {
      return "carries its name under data.name; send it as name";
    }
    return "is missing a name";
  }

  // createFileDocument builds the staged path from uploadName for a
  // local-filesystem claim, so an entry without one cannot be processed.
  if (
    method === "local-filesystem" &&
    (!file.uploadName || typeof file.uploadName !== "string")
  ) {
    return "is missing uploadName";
  }

  // Compared case-insensitively against the stored checksum, so a non-string
  // throws inside verification rather than failing here.
  if (file.md5 !== undefined && typeof file.md5 !== "string") {
    return "has a non-string md5";
  }

  if (
    method === "hpc-mv" &&
    !relativePathCovered &&
    (!file.relativePath || typeof file.relativePath !== "string")
  ) {
    return "is missing relativePath";
  }

  // siblingLinks (lib/ingest-queue.js, run via finaliseReadStage) matches
  // sibling by exact string equality, so a non-string value can never resolve
  // and fails the whole ingest at the pairing step.
  if (file.sibling !== undefined && typeof file.sibling !== "string") {
    return "has a non-string sibling";
  }

  if (file.paired !== undefined && typeof file.paired !== "boolean") {
    return "has a non-boolean paired flag";
  }

  return null;
};

/**
 * Validates a rawFiles or additionalFiles list: must actually be an array,
 * not merely truthy with a `.length` (an object like `{ length: 3 }` used to
 * pass here and reach the ingest job unexamined), and every entry must be
 * shaped the way createFileDocument requires.
 * @param {*} files - The candidate list.
 * @param {string} label - "Raw file" or "Additional file", for messages.
 * @param {(file: object) => string} methodFor - The upload method that will
 *   apply to one entry.
 * @param {(file: object) => boolean} relativePathCoveredFor - Whether the
 *   entry's relativePath requirement is already satisfied elsewhere.
 * @returns {string[]} Error messages; empty when the list is well-formed.
 */
const validateFileList = (files, label, methodFor, relativePathCoveredFor) => {
  if (!Array.isArray(files)) {
    return [
      `${label === "Raw file" ? "rawFiles" : "additionalFiles"} must be an array`,
    ];
  }

  const errors = [];
  files.forEach((file, index) => {
    const error = fileEntryShapeError(
      file,
      methodFor(file),
      relativePathCoveredFor(file),
    );
    if (error) {
      errors.push(`${label} at index ${index} ${error}`);
    }
  });

  const names = files.map(fileEntryName).filter((n) => typeof n === "string");

  // Names are the identity the retry planner and the pairing step both match
  // on, so two entries sharing one make delivery state ambiguous.
  const duplicates = [
    ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
  ];
  duplicates.forEach((name) => {
    errors.push(`${label} name "${name}" appears more than once`);
  });

  // A declared sibling that is not in this list can never be resolved: the
  // pairing step logs the absence and the run finishes "complete" with a
  // paired read that has no sibling.
  const present = new Set(names);
  files.forEach((file, index) => {
    if (
      file &&
      typeof file.sibling === "string" &&
      !present.has(file.sibling)
    ) {
      errors.push(
        `${label} at index ${index} names sibling "${file.sibling}", which is not in the list`,
      );
    }
  });

  return errors;
};

/**
 * Validates the rawFiles/additionalFiles/rawFilesUploadInfo portion of a
 * request body. Shared between the required fields on POST /runs/new and the
 * optional replacement payload POST /runs/:id/reingest accepts, so a
 * corrected reingest payload is held to exactly the same shape as a fresh
 * submission.
 * @param {object} body - An object with rawFiles, additionalFiles, rawFilesUploadInfo.
 * @returns {string[]} Error messages; empty when the payload is well-formed.
 */
const validateIngestFilesPayload = (body) => {
  const errors = [];

  if (!body.rawFilesUploadInfo || !body.rawFilesUploadInfo.method) {
    errors.push("Upload method is required (rawFilesUploadInfo.method)");
  } else if (
    !["hpc-mv", "local-filesystem"].includes(body.rawFilesUploadInfo.method)
  ) {
    errors.push(
      "Invalid upload method. Must be 'hpc-mv' or 'local-filesystem'",
    );
  }

  if (!Array.isArray(body.rawFiles) || body.rawFiles.length === 0) {
    errors.push("At least one raw file is required");
  } else {
    const rawMethod = body.rawFilesUploadInfo?.method;
    // Every rawFiles entry, not just index 0: a relativePath here covers all
    // of them, so this is checked once rather than per entry.
    const relativePathCovered = Boolean(body.rawFilesUploadInfo?.relativePath);
    errors.push(
      ...validateFileList(
        body.rawFiles,
        "Raw file",
        () => rawMethod,
        () => relativePathCovered,
      ),
    );
  }

  // Optional: absent or empty is fine (processAdditionalFiles no-ops), but
  // anything present must be shaped correctly, same as rawFiles.
  if (body.additionalFiles !== undefined) {
    errors.push(
      ...validateFileList(
        body.additionalFiles,
        "Additional file",
        // Per-entry: unlike rawFiles, each additional file carries its own
        // uploadMethod (see lib/file-utils.js processAdditionalFiles).
        (file) => (file && file.uploadMethod) || "local-filesystem",
        () => false,
      ),
    );
  }

  return errors;
};

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

  for (const field of required) {
    if (!body[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type-guarded here: `{"$ne": null}` is truthy, so it passes the required
  // check above and then reaches Run.findOne as a query operator.
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
    // Still validated so the request shape is unchanged for existing clients,
    // but the stored owner is req.user.username; the body's claim is ignored.
    "owner",
  ].forEach((field) => {
    if (body[field] && typeof body[field] !== "string") {
      errors.push(`${field} must be a string`);
    }
  });

  if (
    typeof body.name === "string" &&
    (body.name.length < 3 || body.name.length > 80)
  ) {
    errors.push("Run name must be between 3 and 80 characters");
  }

  errors.push(...validateIngestFilesPayload(body));

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

      // Re-narrowed, not re-read from req.body, so the value reaching the query
      // is provably the checked one.
      const sampleId = asObjectIdString(req.body.sample);

      // The sample's group, never the body's claim about it: otherwise a member
      // of any group can hang a run, and its files, off another group's sample.
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

      // Write capability, not read: a cross-group reader must not create here.
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

      // After the permission decision, so an unauthorised caller learns nothing
      // about which group owns the sample.
      if (!sameObjectId(asObjectIdString(req.body.group), group)) {
        return handleError(
          res,
          new Error("The submitted group does not own the submitted sample."),
          400,
          "The submitted group does not own the submitted sample.",
          requestId,
        );
      }

      // The idempotent answer, shared by the findOne hit below and the E11000
      // save race, which are the same situation and must answer the same way.
      const respondWithExistingRun = async (existingRun) => {
        // Authorises the run that came back, whose group need not still match
        // its sample's — and for write, since this enqueues an ingest.
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

        // Queued here too, keyed by run id so it returns any existing job: a
        // client retrying a lost 201 has no other way to trigger the ingest.
        const existingJob = await enqueueRunIngest({
          runId: existingRun._id,
          requestId,
          payload: {
            rawFiles,
            additionalFiles,
            rawFilesUploadInfo,
            // Recorded at enqueue time, used at claim time: the submitter is
            // whose staged uploads the job claims.
            username: req.user.username,
          },
        });

        return res.status(200).send({
          run: existingRun,
          idempotent: true,
          jobId: existingJob ? existingJob._id : null,
          message: "Run with this name already exists for this sample",
        });
      };

      // Idempotency. Both values are narrowed above, so neither can arrive as
      // a query operator.
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
        // From the session, never the body: `owner` is shown and exported as
        // "who submitted this run".
        owner: req.user.username,
        group,
      });

      try {
        savedRun = await newRun.save();
      } catch (saveError) {
        // The unique index on { sample, name } turns the idempotency race into
        // an E11000: the wanted run now exists, so answer as the findOne would.
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

      // Awaited before the 201: the file work must be recorded durably, or a
      // restart loses an ingest the client was already told had been accepted.
      const job = await enqueueRunIngest({
        runId: savedRun._id,
        requestId,
        payload: {
          rawFiles,
          additionalFiles,
          rawFilesUploadInfo,
          // Recorded at enqueue time, used at claim time: the submitter is
          // whose staged uploads the job claims.
          username: req.user.username,
        },
      });

      if (!job) {
        throw new Error("The ingest job could not be queued");
      }

      // Shape preserved for komondor-power, plus jobId so the client can poll.
      res.status(201).send({ run: savedRun, jobId: job._id });
    } catch (error) {
      // Roll back a saved run: one with no queued ingest sits at "pending"
      // forever, so it must not survive a failed enqueue.
      if (savedRun && savedRun._id) {
        await Run.deleteOne({ _id: savedRun._id });
        // Does not clean up partially moved files.
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

      // Group membership is the whole test; no owner fallback (see GET /run).
      const canAccess = await canReadGroup(req.user, run.group);
      if (!canAccess) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          `User '${req.user.username}' does not have permission to view this run`,
          requestId,
        );
      }

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

      // Only the queue can say whether a run stuck at "pending" with no files
      // is queued, being worked on, or permanently failed.
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
 * Returns a permanently failed ingest to the queue. Its own endpoint on
 * purpose: making POST /runs/new retry would let a duplicate submission replay
 * file moves over a run that is already healthy.
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

      // Write access: an ingest moves files and writes Reads, unlike the read
      // that GET /runs/:id/status performs.
      if (!(await canWriteGroup(req.user, groupIdOf(run)))) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          `User '${req.user.username}' does not have permission to modify this run`,
          requestId,
        );
      }

      // A replacement payload is optional: any of its fields being present
      // signals the caller means to correct the mistake that failed the
      // ingest, not merely replay it. Validated with the same shape check as
      // a fresh POST /runs/new, so a corrected payload can't itself be poison.
      const hasReplacementPayload =
        req.body &&
        (req.body.rawFiles !== undefined ||
          req.body.additionalFiles !== undefined ||
          req.body.rawFilesUploadInfo !== undefined);

      let replacementPayload;
      if (hasReplacementPayload) {
        const payloadErrors = validateIngestFilesPayload(req.body);
        if (payloadErrors.length > 0) {
          return handleError(
            res,
            new Error(payloadErrors.join("; ")),
            400,
            `Replacement payload invalid: ${payloadErrors.join("; ")}`,
            requestId,
          );
        }

        // The retry planner matches delivered files by NAME, so a correction
        // that changes an already-delivered file's identity (a different
        // upload, source or checksum under the same name) would be silently
        // skipped, and dropping a delivered name would strand its Read.
        // Corrections are therefore allowed only for what has not landed yet.
        // Guarded: the export is new, and a stale mock or partial upgrade
        // must not silently skip the check.
        const delivered =
          typeof ingestQueue.deliveredFileNames === "function"
            ? await ingestQueue.deliveredFileNames(run._id)
            : new Set();

        if (delivered.size > 0) {
          const submittedNames = new Set(
            [...(req.body.rawFiles || []), ...(req.body.additionalFiles || [])]
              .map((file) => file && file.name)
              .filter((name) => typeof name === "string"),
          );

          const dropped = [...delivered].filter(
            (name) => !submittedNames.has(name),
          );

          if (dropped.length > 0) {
            return handleError(
              res,
              new Error(`Already delivered: ${dropped.join(", ")}`),
              409,
              `Cannot drop ${dropped.join(", ")} from the payload: ` +
                "already delivered to the datastore. Correct only the files " +
                "that have not landed yet.",
              requestId,
            );
          }
        }

        replacementPayload = {
          rawFiles: req.body.rawFiles,
          additionalFiles: req.body.additionalFiles,
          rawFilesUploadInfo: req.body.rawFilesUploadInfo,
          // Whoever supplies the fix is whose staged uploads the retry claims.
          username: req.user.username,
        };
      }

      const job = await requeueFailedIngest({
        runId: run._id,
        requestId,
        payload: replacementPayload,
      });

      if (!job) {
        // Nothing reset: either there is no job, or there is one that has not
        // failed. Those need different answers.
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

      // The run's "error" status is stale once the work is queued again.
      // Logged, not thrown: the requeue has already happened durably.
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

      // Audit trail for the overwrite: the original payload is gone once this
      // line runs, and this is the only record that it was replaced at all.
      if (replacementPayload) {
        console.log(
          `[${requestId}] Reingest for run ${run._id}: the stored ingest payload was replaced at the request of '${req.user.username}'`,
        );
      }

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
 * Returns status information for multiple runs at once. Body: { runIds: [...] }
 * Every requested id is accounted for, in `runs`, `missing` or `invalid`:
 * komondor-power reads a short `runs` array as a complete answer.
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

      // Keyed by the lower-cased id but holding the id as submitted: two
      // spellings of the same hex are one run, and `missing` echoes the caller's.
      const invalid = [];
      const wanted = new Map();
      runIds.forEach((value) => {
        const id = asObjectIdString(value);
        if (id) {
          if (!wanted.has(id.toLowerCase())) {
            wanted.set(id.toLowerCase(), id);
          }
        } else {
          // Truncated because this is echoed straight back to the caller.
          invalid.push(String(value).slice(0, 64));
        }
      });

      const requested = [...wanted.values()];

      const runs = requested.length
        ? await Run.find({ _id: { $in: requested } }).select(
            "_id name status statusError md5VerificationStatus md5VerificationAttempts md5VerificationLastAttempt md5VerificationCompletedAt group createdAt",
          )
        : [];

      // One read of the user's groups for the whole batch, not one per run.
      const readableGroups = new Set(
        (await groupsICanRead(req.user))
          .map((group) => group && group._id && String(group._id))
          .filter(Boolean),
      );

      // Group membership decides visibility, exactly as on GET /run.
      const visibleRuns = (runs || []).filter((run) =>
        readableGroups.has(String(run.group)),
      );

      const ingestJobs = await findIngestJobs(
        visibleRuns.map((run) => run._id),
      );

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

      // Lower-cased on both sides: an id sent in upper case would otherwise be
      // reported missing in the same response that answers for it.
      const returned = new Set(
        accessibleRuns.map((run) => String(run.runId).toLowerCase()),
      );

      // Does not distinguish "no such run" from "not yours": that would make
      // this an existence oracle for other groups' runs.
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
