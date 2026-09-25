const express = require("express");
const router = express.Router();
const _path = require("path");

const Run = require("../models/Run");
const Sample = require("../models/Sample");
const Project = require("../models/Project");
const LibraryType = require("../models/options/LibraryType");
const { isAuthenticated } = require("./middleware");
const {
  canReadGroup,
  canCreateInGroup,
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
  storageReadOnlyResponse,
} = require("./_utils");
const {
  resolveStorageState,
  publicStorageSummary,
  locationFor,
  notApplicableReconciliation,
  attachProjectStorage,
  setDerivedField,
} = require("../lib/storage-state");
// The same canonicalisation lib/file-utils.js applies before a name becomes a
// path on disk, so validation and storage agree on what "the same file" means.
const { safeBasename } = require("../lib/utils/safePath");
const {
  validateIngestFilesPayload,
  validatePartialFilesPayload,
  validateRawFilesForLibraryType,
} = require("../lib/ingest-payload-validation");

// Stricter than ObjectId.isValid(), which accepts any 12-character string.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const fileEntryName = (file) => file && file.name;

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

/** Resolves a Project without populating or changing the existing relation. */
const projectForSample = async (sampleLike) => {
  let sample = sampleLike;
  if (!sample || typeof sample !== "object" || !sample.project) {
    const sampleId =
      sample && typeof sample === "object" && sample._id ? sample._id : sample;
    if (!sampleId) return null;
    sample = await Sample.findById(sampleId).select("project");
  }

  if (!sample || !sample.project) return null;
  if (
    typeof sample.project === "object" &&
    sample.project._id &&
    (sample.project.path !== undefined || sample.project.storage !== undefined)
  ) {
    return sample.project;
  }

  return Project.findById(sample.project).select(
    "path storage +archiveMigration",
  );
};

const projectForRun = (run) => projectForSample(run && run.sample);

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
      await attachProjectStorage(runs, { via: "sample" });
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

      const project = await projectForRun(run);
      const storageState = resolveStorageState(project);
      setDerivedField(run, "projectStorage", publicStorageSummary(project));

      let actualReads = null;
      let actualAdditionalFiles = null;
      let rawFilesStatus = notApplicableReconciliation(storageState.state);
      let additionalFilesStatus = notApplicableReconciliation(
        storageState.state,
      );

      if (storageState.state === "hpc") {
        const runDirectory = _path.join(process.env.DATASTORE_ROOT, run.path);
        const rawDir = _path.join(runDirectory, "raw");
        const additionalDir = _path.join(runDirectory, "additional");

        const [raw, additional] = await Promise.all([
          compareFilesToDirectory(run.rawFiles, rawDir),
          compareFilesToDirectory(run.additionalFiles, additionalDir),
        ]);
        actualReads = raw.actualFiles;
        rawFilesStatus = raw.status;
        actualAdditionalFiles = additional.actualFiles;
        additionalFilesStatus = additional.status;
      }

      res.status(200).send({
        run,
        location: locationFor(project, run.path, { includeRaw: true }),
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
      const parentSample =
        await Sample.findById(sampleId).select("group project");
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

      // ENA admins may create across groups; read access alone is insufficient.
      const canCreate = await canCreateInGroup(req.user, group);
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

      const project = await projectForSample(parentSample);
      if (!project) {
        return handleError(
          res,
          new Error("The submitted sample has no project."),
          500,
          "The submitted sample has no project and cannot take new runs.",
          requestId,
        );
      }
      const storageState = resolveStorageState(project);
      if (!storageState.acceptsHpcWrites) {
        return storageReadOnlyResponse(res, project, requestId);
      }

      // Library types are data, not a hard-coded enum: admins can add them and
      // both clients consume the same option collection. Resolve the submitted
      // value here and enforce its relationship semantics at the API boundary,
      // so a UI regression cannot create a paired library whose reads silently
      // land unpaired. Index reads are intentionally outside biological pairs.
      const selectedLibraryType = await LibraryType.findOne({
        value: libraryType,
      }).select("paired indexed");
      if (!selectedLibraryType) {
        return handleError(
          res,
          new Error(`Unknown library type: ${libraryType}`),
          400,
          `Unknown library type: ${libraryType}`,
          requestId,
        );
      }

      // Both clients treat paired/indexed as LibraryType properties. Keep the
      // rule in one shared helper because reingest and the worker must reject
      // the same metadata contradictions as fresh create.
      const libraryTypeErrors = validateRawFilesForLibraryType(
        rawFiles,
        selectedLibraryType,
      );
      if (libraryTypeErrors.length > 0) {
        return handleError(
          res,
          new Error(libraryTypeErrors.join("; ")),
          400,
          libraryTypeErrors.join("; "),
          requestId,
        );
      }

      // The idempotent answer, shared by the findOne hit below and the E11000
      // save race, which are the same situation and must answer the same way.
      const respondWithExistingRun = async (existingRun) => {
        // Authorises the run that came back, whose group need not still match
        // its sample's. Apply the same creation capability for retries because
        // this enqueues an ingest; a read-only user must still be refused.
        if (!(await canCreateInGroup(req.user, groupIdOf(existingRun)))) {
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
        setDerivedField(
          existingRun,
          "projectStorage",
          publicStorageSummary(project),
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
      setDerivedField(
        savedRun,
        "projectStorage",
        publicStorageSummary(project),
      );
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
      const project = await projectForRun(run);
      const projectStorage = publicStorageSummary(project);
      const md5VerificationApplicable =
        projectStorage.acceptsHpcWrites === true;

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
        md5VerificationApplicable,
        md5VerificationNotApplicableReason: md5VerificationApplicable
          ? null
          : "PROJECT_STORAGE_READ_ONLY",
        projectStorage,
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
 * A stable key for one rawFiles/additionalFiles entry, for comparing whether
 * a client's resubmission of an already-delivered name actually changes it.
 * JSON.stringify with sorted keys, not a hand-rolled field comparator: these
 * entries are plain JSON-shaped descriptors and two objects describing the
 * same delivered file are expected to be structurally identical, not merely
 * equivalent under some looser notion of sameness.
 *
 * Relationship metadata is excluded: it describes how reads relate, not the
 * bytes already delivered under this name. A retry may legitimately repoint,
 * pair, or unpair a delivered Read while leaving its immutable descriptor
 * untouched. Nested descriptor objects are canonicalised recursively; using
 * JSON.stringify's array replacer here used to drop every nested key that was
 * not also a top-level key, allowing a nested content change through as equal.
 * @param {object} file - A rawFiles/additionalFiles entry.
 * @returns {string} A canonical string for equality comparison.
 */
const RELATIONSHIP_FIELDS = new Set(["sibling", "paired", "rowID"]);

const stableJsonValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJsonValue(value[key]);
        return result;
      }, {});
  }
  return value;
};

const withoutRelationshipMetadata = (file) =>
  Object.keys(file || {}).reduce((result, key) => {
    if (!RELATIONSHIP_FIELDS.has(key)) {
      result[key] = file[key];
    }
    return result;
  }, {});

const relationshipMetadata = (file) =>
  ["sibling", "paired", "rowID"].reduce((result, key) => {
    if (file && file[key] !== undefined) {
      result[key] = file[key];
    }
    return result;
  }, {});

const entryFingerprint = (file) =>
  JSON.stringify(stableJsonValue(withoutRelationshipMetadata(file)));

/**
 * Merges a partial replacement payload with the ORIGINAL payload. Omission
 * means "unchanged" for delivered and undelivered entries alike, so fixing
 * one failed file cannot silently delete another failed file the caller did
 * not mention. Callers that intentionally supply a complete replacement list
 * opt into dropping omitted UNDELIVERED entries explicitly.
 *
 * A delivered name absent from the replacement, or resubmitted identically,
 * is filled in from the original — a client naturally resends its whole known
 * state, and only the broken part is actually different. A delivered name
 * the client resubmits with DIFFERENT content is refused (409) by name,
 * rather than silently kept as the original or silently applied: the retry
 * planner matches by name and would skip a changed entry regardless, so
 * accepting it without saying so would be exactly the silent no-op this
 * function exists to remove.
 *
 * @param {Array<object>} originalList - The failed job's stored entries.
 * @param {Array<object>|undefined} submittedList - What the caller sent.
 * @param {Set<string>} delivered - Original names already in the datastore.
 * @param {object} [options]
 * @param {boolean} [options.replaceUndelivered=false] - Treat submittedList as
 *   complete for entries not yet delivered. Delivered entries are immutable
 *   and are retained even when omitted.
 * @returns {{merged: Array<object>, rejectedChange: string|null}} The merged
 *   list, and the name of a rejected change if the caller tried to alter a
 *   delivered entry.
 */
const mergeReplacementList = (
  originalList,
  submittedList,
  delivered,
  { replaceUndelivered = false } = {},
) => {
  // The caller may correct only ONE of rawFiles/additionalFiles — the whole
  // point of a partial replacement. `undefined` here means "I am not
  // replacing this list at all", not "replace it with nothing".
  if (submittedList === undefined) {
    return { merged: originalList || [], rejectedChange: null };
  }

  // Keyed on the canonical basename, which is what actually names the file on
  // disk and what `delivered` is built from — matching on the raw string
  // instead let " A.fq" and "A.fq" look like two files to the merge and one
  // to the datastore, so a retry reattempted a delivered file and stayed
  // errored.
  const keyOf = (file) => {
    const name = fileEntryName(file);
    return typeof name === "string" ? safeBasename(name) || name : null;
  };
  const indexByKey = (list) =>
    new Map(
      (list || [])
        .filter((file) => keyOf(file) !== null)
        .map((file) => [keyOf(file), file]),
    );

  const original = indexByKey(originalList);
  const submitted = indexByKey(submittedList);

  const names = new Set([...original.keys(), ...submitted.keys()]);
  const merged = [];

  for (const name of names) {
    if (delivered.has(name)) {
      const originalEntry = original.get(name);
      const submittedEntry = submitted.get(name);
      if (
        submittedEntry !== undefined &&
        entryFingerprint(submittedEntry) !== entryFingerprint(originalEntry)
      ) {
        return {
          merged: null,
          rejectedChange: fileEntryName(submittedEntry) || name,
        };
      }
      if (originalEntry !== undefined) {
        // Keep the delivered entry's immutable description, but replace its
        // relationship state as one unit. In particular, the Web's real
        // unpair shape is `{ paired: false }` with no sibling: retaining the
        // original `paired:true` made that correction either 409 or 400.
        if (submittedEntry !== undefined) {
          merged.push({
            ...withoutRelationshipMetadata(originalEntry),
            ...relationshipMetadata(submittedEntry),
          });
        } else {
          merged.push(originalEntry);
        }
      }
    } else if (submitted.has(name)) {
      // Not yet delivered: whatever the caller submitted is the correction.
      merged.push(submitted.get(name));
    } else if (!replaceUndelivered && original.has(name)) {
      // Partial replacement is PATCH-like. An omitted, undelivered entry may
      // simply be another failure the caller is not fixing in this request;
      // retain it unless the caller explicitly said this is the complete
      // desired list.
      merged.push(original.get(name));
    }
    // Explicit full replacement: an omitted, undelivered original is dropped.
    // A delivered original took the immutable branch above and cannot be
    // removed through this endpoint.
  }

  return { merged, rejectedChange: null };
};

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
      const run = await Run.findById(runId).select(
        "name group owner status libraryType sample",
      );

      if (!run) {
        return handleError(
          res,
          new Error("Run not found"),
          404,
          "Run not found",
          requestId,
        );
      }

      // Creation access also covers ingest retries, so ENA admins can finish
      // uploads submitted across groups. Read access alone is insufficient.
      if (!(await canCreateInGroup(req.user, groupIdOf(run)))) {
        return handleError(
          res,
          new Error("Access denied"),
          403,
          `User '${req.user.username}' does not have permission to modify this run`,
          requestId,
        );
      }

      const project = await projectForRun(run);
      if (!project) {
        return handleError(
          res,
          new Error("Run has no project"),
          500,
          "This run has no project and cannot be reingested",
          requestId,
        );
      }
      const storageState = resolveStorageState(project);
      if (!storageState.acceptsHpcWrites) {
        return storageReadOnlyResponse(res, project, requestId);
      }

      // A replacement payload is optional: any of its fields being present
      // signals the caller means to correct the mistake that failed the
      // ingest, not merely replay it. Validated with the same shape check as
      // a fresh POST /runs/new, so a corrected payload can't itself be poison.
      const hasReplacementPayload =
        req.body &&
        (req.body.rawFiles !== undefined ||
          req.body.additionalFiles !== undefined ||
          req.body.rawFilesUploadInfo !== undefined ||
          req.body.replaceRawFiles !== undefined ||
          req.body.replaceAdditionalFiles !== undefined);

      let replacementPayload;
      if (hasReplacementPayload) {
        const replacementModeErrors = [];
        ["replaceRawFiles", "replaceAdditionalFiles"].forEach((field) => {
          if (
            req.body[field] !== undefined &&
            typeof req.body[field] !== "boolean"
          ) {
            replacementModeErrors.push(`${field} must be a boolean`);
          }
        });
        if (
          req.body.replaceRawFiles === true &&
          !Array.isArray(req.body.rawFiles)
        ) {
          replacementModeErrors.push(
            "replaceRawFiles requires a complete rawFiles array",
          );
        }
        if (
          req.body.replaceAdditionalFiles === true &&
          !Array.isArray(req.body.additionalFiles)
        ) {
          replacementModeErrors.push(
            "replaceAdditionalFiles requires a complete additionalFiles array",
          );
        }
        if (replacementModeErrors.length > 0) {
          return handleError(
            res,
            new Error(replacementModeErrors.join("; ")),
            400,
            `Replacement payload invalid: ${replacementModeErrors.join("; ")}`,
            requestId,
          );
        }

        const payloadErrors = validatePartialFilesPayload(req.body);
        if (payloadErrors.length > 0) {
          return handleError(
            res,
            new Error(payloadErrors.join("; ")),
            400,
            `Replacement payload invalid: ${payloadErrors.join("; ")}`,
            requestId,
          );
        }

        // A replacement can correct the files that have NOT landed yet
        // without also having to resubmit the ones that already succeeded.
        // The retry planner matches delivered files by name and skips them,
        // so a delivered entry is carried forward from the ORIGINAL stored
        // payload — unchanged, whether the caller resent it identically or
        // omitted it — and only an entry the caller actually tried to CHANGE
        // under a delivered name is refused, by name, rather than silently
        // kept or silently applied. Guarded: the export is new, and a stale
        // mock or partial upgrade must not silently skip the check.
        // Per-list, never pooled: a raw read and an additional file may
        // legitimately share a name, and treating one flat set as both made
        // an undelivered additional file un-correctable behind a delivered
        // raw one of the same name.
        //
        // The shape is asserted rather than defaulted. Silently substituting
        // an empty set for an unrecognised return would drop this guard
        // altogether and let a delivered file be changed unnoticed — and it
        // is exactly how a stale test double goes on passing while
        // production has moved on. Failing loudly is the point.
        const delivered = await ingestQueue.deliveredFileNames(run._id);
        if (
          !delivered ||
          !(delivered.raw instanceof Set) ||
          !(delivered.additional instanceof Set)
        ) {
          throw new Error(
            "deliveredFileNames did not return { raw: Set, additional: Set }",
          );
        }

        const existingJob = await IngestJob.findOne({
          idempotencyKey: idempotencyKeyFor(run._id),
          status: "failed",
        }).select("payload");
        const originalPayload = (existingJob && existingJob.payload) || {};

        const rawFilesMerge = mergeReplacementList(
          originalPayload.rawFiles,
          req.body.rawFiles,
          delivered.raw,
          { replaceUndelivered: req.body.replaceRawFiles === true },
        );
        if (rawFilesMerge.rejectedChange) {
          return handleError(
            res,
            new Error(`Already delivered: ${rawFilesMerge.rejectedChange}`),
            409,
            `Cannot change "${rawFilesMerge.rejectedChange}": it has already ` +
              "been delivered to the datastore. Resubmit it unchanged (or " +
              "omit it) to keep the rest of the correction, or resolve it " +
              "directly first.",
            requestId,
          );
        }

        const additionalFilesMerge = mergeReplacementList(
          originalPayload.additionalFiles,
          req.body.additionalFiles,
          delivered.additional,
          { replaceUndelivered: req.body.replaceAdditionalFiles === true },
        );
        if (additionalFilesMerge.rejectedChange) {
          return handleError(
            res,
            new Error(
              `Already delivered: ${additionalFilesMerge.rejectedChange}`,
            ),
            409,
            `Cannot change "${additionalFilesMerge.rejectedChange}": it has ` +
              "already been delivered to the datastore. Resubmit it " +
              "unchanged (or omit it) to keep the rest of the correction, " +
              "or resolve it directly first.",
            requestId,
          );
        }

        // Re-validated after merging: the merge can add back a delivered
        // entry the caller never mentioned, and that entry must still be
        // well-formed (it always was, on its way in — this is a consistency
        // check, not expected to fail in practice).
        const mergedErrors = validateIngestFilesPayload({
          rawFiles: rawFilesMerge.merged,
          additionalFiles: additionalFilesMerge.merged,
          rawFilesUploadInfo:
            req.body.rawFilesUploadInfo || originalPayload.rawFilesUploadInfo,
        });
        if (mergedErrors.length > 0) {
          return handleError(
            res,
            new Error(mergedErrors.join("; ")),
            400,
            `Merged replacement payload invalid: ${mergedErrors.join("; ")}`,
            requestId,
          );
        }

        const selectedLibraryType = await LibraryType.findOne({
          value: run.libraryType,
        }).select("paired indexed");
        if (!selectedLibraryType) {
          return handleError(
            res,
            new Error(`Unknown library type: ${run.libraryType}`),
            400,
            `Cannot reingest a run with unknown library type: ${run.libraryType}`,
            requestId,
          );
        }

        const libraryTypeErrors = validateRawFilesForLibraryType(
          rawFilesMerge.merged,
          selectedLibraryType,
        );
        if (libraryTypeErrors.length > 0) {
          return handleError(
            res,
            new Error(libraryTypeErrors.join("; ")),
            400,
            `Merged replacement contradicts library type "${
              run.libraryType
            }": ${libraryTypeErrors.join("; ")}`,
            requestId,
          );
        }

        replacementPayload = {
          rawFiles: rawFilesMerge.merged,
          additionalFiles: additionalFilesMerge.merged,
          rawFilesUploadInfo:
            req.body.rawFilesUploadInfo || originalPayload.rawFilesUploadInfo,
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
            "_id name status statusError md5VerificationStatus md5VerificationAttempts md5VerificationLastAttempt md5VerificationCompletedAt group sample createdAt",
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

      await attachProjectStorage(visibleRuns, { via: "sample" });

      const accessibleRuns = visibleRuns.map((run) => {
        const projectStorage = run.projectStorage;
        const md5VerificationApplicable =
          projectStorage?.acceptsHpcWrites === true;
        return {
          runId: run._id,
          runName: run.name,
          status: run.status,
          statusError: run.statusError || null,
          ingest: summariseIngestJob(ingestJobs.get(String(run._id))),
          md5VerificationStatus: run.md5VerificationStatus,
          md5VerificationAttempts: run.md5VerificationAttempts,
          md5VerificationLastAttempt: run.md5VerificationLastAttempt,
          md5VerificationCompletedAt: run.md5VerificationCompletedAt,
          md5VerificationApplicable,
          md5VerificationNotApplicableReason: md5VerificationApplicable
            ? null
            : "PROJECT_STORAGE_READ_ONLY",
          projectStorage,
          createdAt: run.createdAt,
        };
      });

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
