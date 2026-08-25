const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const File = require("../models/File");
const AdditionalFile = require("../models/AdditionalFile");
const Read = require("../models/Read");
const Run = require("../models/Run");
const { calculateFileMd5 } = require("./utils/md5");
const {
  cleanDirectoryName,
  safeBasename,
  resolveWithinReal,
} = require("./utils/safePath");
const quota = require("./upload-quota");

// Shared with routes/uploads.js and models/File.js — see lib/utils/uploadPath.js
// for why this must not be a local constant. Called rather than captured so an
// UPLOAD_DIRECTORY set after this module loads is still honoured.
const { uploadPath } = require("./utils/uploadPath");
const { auditHpcAccess } = require("./utils/hpcAudit");

// Maximum number of files to process concurrently (move + DB write)
const FILE_CONCURRENCY_LIMIT = 5;

/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The absolute path to the directory.
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      console.error(`Error ensuring directory ${dirPath} exists:`, error);
      throw error;
    }
  }
};

/**
 * Refuses an upload whose path would land outside the directory it belongs in.
 *
 * The raw value is logged but kept out of the thrown message: this error is
 * stored on the Run as `statusError` and read back by the client, so echoing the
 * attacker's own path would confirm which traversals reach the filesystem.
 *
 * @param {string} field - Which request field was rejected.
 * @param {*} rawValue - The offending value, for the log only.
 * @throws {Error} Always.
 */
const rejectUnsafePath = (field, rawValue) => {
  console.error(
    `[File Processing] Refusing upload: '${field}' resolves outside its permitted directory:`,
    rawValue,
  );
  throw new Error(
    `Cannot create File document: '${field}' is not a valid file path`,
  );
};

/**
 * Distinguishes a missing upload root from a bad filename.
 *
 * resolveWithinReal returns null for both, and blaming the request for an
 * unmounted transfer directory sends whoever reads the error looking in
 * entirely the wrong place.
 *
 * @param {string} label - The setting's name, for the message.
 * @param {string} root - The directory it points at.
 * @throws {Error} When the root is not a usable directory.
 */
const assertRootUsable = async (label, root) => {
  const usable = await fs
    .stat(root)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (!usable) {
    throw new Error(`${label} (${root}) is not an existing directory`);
  }
};

/**
 * Refuses a claim on a staged upload the caller does not own.
 *
 * Claiming is the one operation on an upload that was never checked. The tus
 * endpoints and /upload/cancel both call quota.isUploadOwner, so ownership was
 * enforced everywhere bytes are *written* and nowhere they are taken away:
 * naming somebody else's upload id here linked their file into the claimant's
 * datastore and unlinked it from the staging area, which is both a theft and a
 * denial of service against an upload the owner had not attached yet.
 *
 * The recorded owner is the tus sidecar's, which outlives both the transfer
 * and the process. An upload with no recorded owner is refused rather than
 * waved through — every upload the old unauthenticated mount accepted looks
 * exactly like that, and admitting them would preserve the hole this closes.
 *
 * Says no more than "not yours" so a claim on an id that never existed and a
 * claim on somebody else's are indistinguishable; this message is stored as
 * the Run's statusError and read back by the client.
 *
 * @param {string} uploadName - The staged upload's id, already sanitised.
 * @param {string} username - The authenticated caller doing the claiming.
 * @returns {Promise<void>}
 * @throws {Error} When the caller is not the recorded owner.
 */
const assertUploadClaimable = async (uploadName, username) => {
  const owner = await quota.getRecordedOwner(uploadPath(), uploadName);

  if (!quota.isUploadOwner(owner, username)) {
    console.error(
      `[File Processing] Refusing claim on upload '${uploadName}' by '${username}': recorded owner is '${owner}'`,
    );
    throw new Error(
      `Cannot create File document: the named upload does not belong to '${username}'`,
    );
  }
};

/**
 * Creates a File document in the database.
 *
 * Every path component here arrives in the request body — the filename, the
 * upload name and the HPC relative path alike — so each is reduced to something
 * that cannot leave its root before it is used to build a path.
 *
 * @param {object} file - The file object from the request.
 * @param {string} fileType - The type of file ('additional' or 'run').
 * @param {string} uploadMethod - The method of upload ('hpc-mv' or 'local-filesystem').
 * @param {object} [hpcInfo] - Information for HPC uploads { relativePath }.
 * @param {string} [username] - The authenticated caller, whose ownership of a
 *   staged upload is checked before it is claimed.
 * @returns {Promise<mongoose.Document>} - The saved File document.
 */
const createFileDocument = async (
  file,
  fileType,
  uploadMethod,
  hpcInfo = {},
  username,
) => {
  const isHpc = uploadMethod === "hpc-mv";
  const rawName = isHpc ? file.name : file.uploadName;
  const rawOriginalName = file.name;

  if (!rawName || !rawOriginalName) {
    const missing = [!rawName && "name", !rawOriginalName && "originalName"]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Cannot create File document, missing properties: ${missing}`,
    );
  }

  const name = safeBasename(rawName);
  if (!name) {
    rejectUnsafePath(isHpc ? "name" : "uploadName", rawName);
  }

  // originalName is not just a label: moveToFolderAndSave builds the datastore
  // destination out of it, so a traversal here escapes the datastore later on
  // even when the upload itself lands in the right place.
  const originalName = safeBasename(rawOriginalName);
  if (!originalName) {
    rejectUnsafePath("originalName", rawOriginalName);
  }

  let filePath;

  if (isHpc) {
    if (!process.env.HPC_TRANSFER_DIRECTORY) {
      throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
    }

    // Use the relativePath from the file if available, otherwise from hpcInfo.
    // Leading slashes are stripped rather than rejected: path.join() used to
    // treat "/WGS_Test" as relative, and real uploads send it that way.
    const rawRelativePath = file.relativePath || hpcInfo.relativePath;
    const relativePath = cleanDirectoryName(rawRelativePath);

    filePath = await resolveWithinReal(
      process.env.HPC_TRANSFER_DIRECTORY,
      relativePath,
      name,
    );
    if (!filePath) {
      // Throws when the transfer directory itself is unusable. That is a
      // configuration fault rather than an attempted claim, so it is reported
      // as one and deliberately not recorded in the claim trail.
      await assertRootUsable(
        "HPC_TRANSFER_DIRECTORY",
        process.env.HPC_TRANSFER_DIRECTORY,
      );

      // A refused claim is the thing an operator most needs to see, and none
      // was recorded before: the trail held only successes. The attempted
      // target is included because that is what makes the line worth reading;
      // it is safe to include because auditHpcAccess escapes every value, so a
      // filename carrying a newline cannot forge a second record.
      //
      // The raw values, not the cleaned ones, and joined by hand rather than
      // with path.join(). cleanDirectoryName answers null for a name it
      // refuses outright — a control character in it — and path.join() throws a
      // TypeError on a null segment, which would replace this audit line and
      // the caller's "not a valid file path" with an unrelated internal error
      // on exactly the input most worth recording. What the caller actually
      // attempted is the raw value anyway; the cleaned one is a derived
      // artefact of a claim that is not going to happen.
      const attempted = [
        process.env.HPC_TRANSFER_DIRECTORY,
        rawRelativePath,
        rawName,
      ]
        .filter((part) => typeof part === "string" && part !== "")
        .join("/");

      auditHpcAccess({
        action: "claim",
        user: { username },
        path: attempted,
        outcome: "refused-outside-transfer-directory",
        detail: `type=${fileType}`,
      });
      rejectUnsafePath("relativePath", rawRelativePath);
    }
  } else {
    // 'local-filesystem'
    const uploadRoot = uploadPath();
    filePath = await resolveWithinReal(uploadRoot, name);
    if (!filePath) {
      await assertRootUsable("The upload directory", uploadRoot);
      rejectUnsafePath("uploadName", rawName);
    }

    // Checked after the path guards so a traversal still reports as a bad
    // path rather than as somebody else's upload.
    await assertUploadClaimable(name, username);
  }

  const savedFile = new File({
    name,
    type: fileType,
    originalName,
    path: filePath,
    tempUploadPath: uploadMethod === "local-filesystem" ? filePath : undefined,
    uploadName: name,
    uploadMethod,
  });

  return savedFile.save();
};

/**
 * Turns the rejected half of a settled batch into one honest error.
 *
 * Promise.all was used here before, which rejects on the first failure and
 * leaves its siblings running unsupervised: a file could — and did — land in
 * the datastore after the job had already been marked 'error', which then
 * stalled every later attempt on "destination already exists". Waiting for
 * every move to settle costs nothing but truth, and the count belongs in the
 * message because a single file's message read as though it were the only one
 * that had been tried.
 *
 * @param {Array<object>} settled - The Promise.allSettled results.
 * @param {number} total - How many files were in the batch.
 * @returns {Error|null} The aggregate error, or null when all succeeded.
 */
const batchFailure = (settled, total) => {
  const reasons = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);

  if (reasons.length === 0) {
    return null;
  }

  if (reasons.length === 1 && total === 1) {
    // Nothing to aggregate: one file, one failure. Wrapping it would only bury
    // the message the client is shown as the Run's statusError.
    return reasons[0];
  }

  // Deduplicated: five files failing on the same full disk is one fact, and
  // this message is stored as the Run's statusError and read by the client.
  const messages = [
    ...new Set(
      reasons.map((reason) => (reason && reason.message) || String(reason)),
    ),
  ];

  const error = new Error(
    `${reasons.length} of ${total} file(s) in this batch failed to process: ${messages.join(
      "; ",
    )}`,
  );
  error.errors = reasons;
  return error;
};

/**
 * Adopts a file an earlier attempt already moved, when — and only when — the
 * bytes at the destination are the ones this document describes and no other
 * row has claimed them.
 *
 * The failure it recovers from: the move succeeds and the Read/AdditionalFile
 * save immediately after it does not (a transient DB error, a stepped-down
 * primary). The source is unlinked from staging and the destination is
 * occupied, so every later attempt failed — ENOENT on the vanished source, or
 * "destination already exists" — and the API offered no way back. The bytes
 * sat in the datastore with nothing pointing at them.
 *
 * What stops this adopting somebody ELSE'S file:
 *   1. The destination is not caller-supplied. It is DATASTORE_ROOT plus the
 *      parent's own stored path plus the sanitised originalName, so reaching
 *      another group's file needs write access to that group's project first.
 *   2. The staged source must be gone. If it is still there the bytes were
 *      never moved by anyone, the destination belongs to something else, and
 *      the upload can simply be retried — so that case is still refused.
 *   3. Any File document already at that path must be unreferenced. If a Read
 *      or an AdditionalFile links it, those bytes belong to a live ingest and
 *      adopting them would point a second row at another row's file.
 *   4. When the request declares an MD5, the file at the destination must
 *      match it. A different file with the same name is not this file.
 *
 * @param {mongoose.Document} savedFile - The File document for this attempt.
 * @param {string} relPathWithFilename - Datastore-relative destination.
 * @param {string} sourcePath - Where the bytes were before the move.
 * @param {string} [expectedMd5] - The MD5 the request declared, if any.
 * @returns {Promise<mongoose.Document|null>} The document the row should point
 *   at, or null when the destination cannot safely be adopted.
 */
const adoptAlreadyMovedFile = async (
  savedFile,
  relPathWithFilename,
  sourcePath,
  expectedMd5,
) => {
  if (!process.env.DATASTORE_ROOT) {
    return null;
  }

  const destination = await resolveWithinReal(
    process.env.DATASTORE_ROOT,
    cleanDirectoryName(relPathWithFilename),
  );
  if (!destination) {
    return null;
  }

  const destinationStats = await fs.stat(destination).catch(() => null);
  if (!destinationStats || !destinationStats.isFile()) {
    return null;
  }

  // Condition 2. lstat, not stat: a symlink left at the source name is not the
  // source coming back, and treating it as "still there" is the safe reading.
  const sourceGone = await fs
    .lstat(sourcePath)
    .then(() => false)
    .catch((err) => err.code === "ENOENT");
  if (!sourceGone) {
    return null;
  }

  // Condition 4.
  if (expectedMd5) {
    const actualMd5 = await calculateFileMd5(destination).catch(() => null);
    if (!actualMd5 || actualMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
      return null;
    }
  }

  // Condition 3. moveToFolderAndSave stores the datastore-relative path on the
  // document, so that is what an earlier attempt's document holds.
  const occupant = await File.findOne({
    path: relPathWithFilename,
    _id: { $ne: savedFile._id },
  });

  if (occupant) {
    const claimed =
      (await Read.exists({ file: occupant._id })) ||
      (await AdditionalFile.exists({ file: occupant._id }));
    if (claimed) {
      return null;
    }

    // This attempt's own document points at a source that no longer exists and
    // is about to be superseded. It has to go rather than linger: File's
    // unique {name, path, createFileDocumentId} index would refuse the next
    // attempt's identical hpc-mv document otherwise.
    await File.deleteOne({ _id: savedFile._id });
    return occupant;
  }

  // Nothing points at the bytes at all — the save that failed was this
  // document's own. Repointing it is the whole recovery.
  savedFile.path = relPathWithFilename;
  return savedFile.save();
};

/**
 * Moves a file into the datastore, recovering an already-moved one, and
 * records the outcome of an HPC claim once it is a fact rather than an
 * intention.
 *
 * The claim audit lives here rather than beside the path checks because a
 * document that was created and then failed to move took nothing: the trail
 * used to say "ok" before the bytes had gone anywhere, which is the one thing
 * an audit trail must never do.
 *
 * @param {mongoose.Document} savedFile - The File document to move.
 * @param {string} relPathWithFilename - Datastore-relative destination.
 * @param {object} context
 * @param {string} context.fileType - 'additional' or 'run', for the trail.
 * @param {string} context.uploadMethod - 'hpc-mv' or 'local-filesystem'.
 * @param {string} [context.username] - The claiming caller.
 * @param {string} [context.expectedMd5] - The MD5 the request declared.
 * @returns {Promise<mongoose.Document>} The document the row should reference.
 */
const moveIntoDatastore = async (
  savedFile,
  relPathWithFilename,
  { fileType, uploadMethod, username, expectedMd5 },
) => {
  // Only the shared HPC inbox needs attribution: a local-filesystem upload was
  // already proved to belong to the caller by assertUploadClaimable, and its
  // staging area is not shared between groups. See lib/utils/hpcAudit.js.
  const isHpc = uploadMethod === "hpc-mv";
  const sourcePath = savedFile.path;

  /** Records what actually happened to the claim. */
  const audit = (outcome) => {
    if (!isHpc) {
      return;
    }
    auditHpcAccess({
      action: "claim",
      user: { username },
      path: sourcePath,
      outcome,
      detail: `type=${fileType}`,
    });
  };

  try {
    await savedFile.moveToFolderAndSave(relPathWithFilename);
  } catch (error) {
    const adopted = await adoptAlreadyMovedFile(
      savedFile,
      relPathWithFilename,
      sourcePath,
      expectedMd5,
    ).catch((adoptError) => {
      console.error(
        `[File Processing] Could not reconcile '${relPathWithFilename}' after a failed move:`,
        adoptError,
      );
      return null;
    });

    if (!adopted) {
      audit("failed");
      throw error;
    }

    console.log(
      `[File Processing] Adopted the copy of '${relPathWithFilename}' an earlier attempt left in the datastore: ${error.message}`,
    );
    audit("ok-reconciled");
    return adopted;
  }

  audit("ok");
  return savedFile;
};

/**
 * Processes and saves additional files for a given parent document (Project or Sample).
 * @param {Array<object>} additionalFiles - Array of file objects.
 * @param {string} parentType - 'project' or 'sample'.
 * @param {mongoose.Types.ObjectId} parentId - The ID of the parent document.
 * @param {string} parentPath - The relative path of the parent document.
 * @param {string} [username] - The authenticated caller, checked against the
 *   recorded owner of any staged upload being claimed.
 * @returns {Promise<void>}
 */
const processAdditionalFiles = async (
  additionalFiles,
  parentType,
  parentId,
  parentPath,
  username,
) => {
  if (!additionalFiles || additionalFiles.length === 0) {
    return;
  }

  const destinationDir = _path.join(
    process.env.DATASTORE_ROOT,
    parentPath,
    "additional",
  );
  await ensureDirectoryExists(destinationDir);

  const fileProcessingPromises = additionalFiles.map(async (file) => {
    // Determine upload method from file object or default to 'local-filesystem'
    const uploadMethod = file.uploadMethod || "local-filesystem";

    const savedFile = await createFileDocument(
      file,
      "additional",
      uploadMethod,
      file,
      username,
    );

    // The move happens here, before the AdditionalFile row exists, and the
    // row is written with skipPostSave, which models/AdditionalFile.js honours
    // in its post-save hook so the move is not attempted a second time.
    //
    // It used to be the other way round: the row was saved and its post-save
    // hook did the move and then swallowed the failure, so a file that never
    // left staging left behind a row asserting that it had — with no signal
    // anywhere. Everything downstream reads those rows as "ingested".
    //
    // parentPath is the parent's stored `path` ("/group/project/sample"),
    // which is what the hook's getRelativePath() returns modulo the leading
    // slash that cleanDirectoryName strips inside moveToFolderAndSave. Same
    // destination, two fewer populate queries per file.
    const relPathWithFilename = _path.join(
      parentPath,
      "additional",
      savedFile.originalName,
    );
    const fileForRow = await moveIntoDatastore(savedFile, relPathWithFilename, {
      fileType: "additional",
      uploadMethod,
      username,
      expectedMd5: file.md5,
    });

    const additionalFile = new AdditionalFile({
      [parentType]: parentId,
      file: fileForRow._id,
      MD5: file.md5?.toLowerCase(),
      skipPostSave: true, // Skip post-save hook — moved directly above
    });
    return additionalFile.save();
  });

  // allSettled, not all: a rejected Promise.all abandons its siblings, which
  // keep moving files after the caller has been told the batch failed. See the
  // same reasoning in processReadFiles.
  const settled = await Promise.allSettled(fileProcessingPromises);
  const failure = batchFailure(settled, additionalFiles.length);
  if (failure) {
    throw failure;
  }
};

/**
 * Updates Read documents to link paired-end reads as siblings.
 *
 * Two pairing rules live here, and they are the *only* statement of them:
 * an hpc-mv read names its sibling outright (`siblingName`), while a
 * local-filesystem read pairs with the other read carrying the same `rowId`,
 * and a row that does not hold exactly two reads is left unpaired rather than
 * guessed at.
 *
 * Exported because lib/ingest-queue.js `siblingLinks` reimplements exactly
 * those two rules — it has to answer "which reads should end up paired?" for a
 * retry that moved no files, and cannot reach into this module's internals.
 * That duplication is not yet removed by the export alone: the two work on
 * different shapes (this one on `pairingInfo` records that already carry
 * `readId`s, siblingLinks on the raw payload files, which have only names), so
 * converging them needs the rules pulled out over a normalised input rather
 * than one calling the other. **If the pairing rules change here, siblingLinks
 * must change with them.**
 *
 * @param {Array<object>} pairingInfo - Information about the created Read documents.
 * @param {string} uploadMethod - The upload method used.
 */
const linkPairedReads = async (pairingInfo, uploadMethod) => {
  const pairedReads = pairingInfo.filter((r) => r.isPaired);
  if (pairedReads.length === 0) {
    return;
  }

  let updatePromises;

  if (uploadMethod === "hpc-mv") {
    // Build a lookup map from fileName -> readId using the in-memory pairingInfo
    // This avoids a global File.findOne query that could match files from other runs
    const fileNameToReadId = new Map();
    for (const info of pairingInfo) {
      if (info.fileName) {
        fileNameToReadId.set(info.fileName, info.readId);
      }
    }

    updatePromises = pairedReads.map(async (read) => {
      // Look up the sibling's readId from the in-memory map (scoped to this run)
      const siblingReadId = fileNameToReadId.get(read.siblingName);
      if (!siblingReadId) {
        throw new Error(
          `Could not find sibling Read in current run for: ${read.siblingName}`,
        );
      }
      return Read.updateOne(
        { _id: read.readId },
        { $set: { sibling: siblingReadId } },
      );
    });
  } else {
    // 'local-filesystem'
    const readsByRowId = pairedReads.reduce((acc, read) => {
      acc[read.rowId] = acc[read.rowId] || [];
      acc[read.rowId].push(read);
      return acc;
    }, {});

    updatePromises = Object.values(readsByRowId).flatMap((pair) => {
      if (pair.length !== 2) {
        console.error(
          `Expected 2 reads for rowId ${pair[0]?.rowId}, but found ${pair.length}. Skipping pairing.`,
        );
        return [];
      }
      const [read1, read2] = pair;
      return [
        Read.updateOne(
          { _id: read1.readId },
          { $set: { sibling: read2.readId } },
        ),
        Read.updateOne(
          { _id: read2.readId },
          { $set: { sibling: read1.readId } },
        ),
      ];
    });
  }

  await Promise.all(updatePromises);
};

/**
 * Creates DB documents for a single read file and moves it.
 * MD5 validation is deferred to background processing.
 * @param {object} file - The file object from the request.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method.
 * @param {string} cachedRelativePath - The run's relative path, resolved once.
 * @param {string} [username] - The authenticated caller, checked against the
 *   recorded owner of any staged upload being claimed.
 * @returns {Promise<object>} An object containing pairing info.
 */
async function processSingleReadFile(
  file,
  runId,
  runPath,
  uploadInfo,
  cachedRelativePath,
  username,
) {
  const startTime = Date.now();

  // Create File and Read documents
  const savedFile = await createFileDocument(
    file,
    "run",
    uploadInfo.method,
    uploadInfo,
    username,
  );

  const isHpc = uploadInfo.method === "hpc-mv";
  const originalMd5 = file.md5?.toLowerCase();

  // Move first, record second.
  //
  // The Read used to be saved before this line, which made the row durable
  // before the bytes were: a move that failed (ENOSPC, EROFS, the no-clobber
  // EEXIST) left a Read pointing at a file still sitting in staging, and
  // everything downstream — the ingest queue's completion check, MD5
  // verification, the frontend's file list — reads a Read as proof the file
  // arrived. Ordering it this way makes the row mean what it says.
  //
  // Safe to reorder because readData sets skipPostSave: the Read's own
  // post-save hook would otherwise do this same move a second time.
  //
  // Uses the cached relative path (avoids 2 populate queries per file).
  const rawPath = _path.join(cachedRelativePath, "raw");
  const relPathWithFilename = _path.join(rawPath, savedFile.originalName);
  const fileForRow = await moveIntoDatastore(savedFile, relPathWithFilename, {
    fileType: "run",
    uploadMethod: uploadInfo.method,
    username,
    expectedMd5: originalMd5,
  });

  const readData = {
    run: runId,
    MD5: originalMd5, // Normalized to lowercase for consistent comparison
    // Built after the move, because the move may have reconciled this document
    // onto a copy an earlier attempt left behind — in which case the row must
    // point at the File that actually describes those bytes, not at the
    // superseded document this attempt created.
    file: fileForRow._id,
    paired: isHpc ? !!file.sibling : file.paired,
    ...(file.indexed !== undefined && { indexed: file.indexed }),
    destinationMd5: null, // Initialize - will be calculated in background
    md5Mismatch: null, // Initialize as null (not yet checked)
    skipPostSave: true, // Skip post-save hook — we moved the file directly above
  };

  const savedRead = await new Read(readData).save();

  const duration = Date.now() - startTime;
  console.log(
    `[File Processing] File '${fileForRow.originalName}' moved successfully (${duration}ms)`,
  );

  // Return necessary info for subsequent steps (pairing only - MD5 is deferred)
  return {
    pairingInfo: {
      readId: savedRead._id,
      isPaired: readData.paired,
      siblingName: isHpc ? file.sibling : null,
      fileName: fileForRow.originalName,
      rowId: isHpc ? null : file.rowID,
    },
  };
}

/**
 * Processes and saves read files for a given Run.
 * Files are moved immediately, but MD5 validation is deferred to background processing.
 * @param {Array<object>} readFiles - Array of file objects.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent Run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method and files.
 * @param {string} [username] - The authenticated caller, checked against the
 *   recorded owner of any staged upload being claimed.
 * @returns {Promise<void>}
 */
const processReadFiles = async (
  readFiles,
  runId,
  runPath,
  uploadInfo,
  username,
) => {
  if (!readFiles || readFiles.length === 0) {
    return;
  }

  try {
    const startTime = Date.now();

    // 1. Set the initial status of the run to 'processing'
    await Run.findByIdAndUpdate(runId, {
      $set: {
        status: "processing",
        md5VerificationStatus: "pending",
      },
    });

    // 2. Compute the run's relative path once (avoids repeated populate queries)
    const run = await Run.findById(runId);
    const cachedRelativePath = await run.getRelativePath();

    // 3. Ensure the destination directory exists
    const destinationDir = _path.join(
      process.env.DATASTORE_ROOT,
      cachedRelativePath,
      "raw",
    );
    await ensureDirectoryExists(destinationDir);

    // 4. Process files with limited concurrency (create docs and move files)
    const processingResults = [];
    for (let i = 0; i < readFiles.length; i += FILE_CONCURRENCY_LIMIT) {
      const batch = readFiles.slice(i, i + FILE_CONCURRENCY_LIMIT);

      // allSettled, not all: Promise.all rejects the moment one file fails and
      // abandons the other four, which carry on moving multi-gigabyte reads
      // long after this function has marked the run 'error'. A file landing in
      // the datastore after the row says the attempt failed is what leaves the
      // destination occupied and stalls every retry. Every move in the batch is
      // now finished — one way or the other — before the outcome is decided.
      const batchResults = await Promise.allSettled(
        batch.map((file) =>
          processSingleReadFile(
            file,
            runId,
            runPath,
            uploadInfo,
            cachedRelativePath,
            username,
          ),
        ),
      );

      const failure = batchFailure(batchResults, batch.length);
      if (failure) {
        throw failure;
      }

      processingResults.push(...batchResults.map((result) => result.value));
    }

    // 5. Link any paired-end reads
    const pairingInfo = processingResults.map((r) => r.pairingInfo);
    await linkPairedReads(pairingInfo, uploadInfo.method);

    // 6. Update the run to 'complete' status (files moved successfully)
    // MD5 verification will happen in background and update md5VerificationStatus
    await Run.findByIdAndUpdate(runId, { $set: { status: "complete" } });

    const duration = Date.now() - startTime;
    console.log(
      `[File Processing] Run ${runId} processed successfully in ${duration}ms. MD5 verification will run in background.`,
    );
  } catch (error) {
    console.error(
      `Critical error during read file processing for run ${runId}:`,
      error,
    );
    // Attempt to mark the run as 'error' if any step fails, with error details
    try {
      await Run.findByIdAndUpdate(runId, {
        $set: {
          status: "error",
          statusError: error.message || String(error),
          md5VerificationStatus: "failed",
        },
      });
    } catch (updateError) {
      console.error(
        `Failed to update run ${runId} status to 'error' after processing failure:`,
        updateError,
      );
    }
    // Re-throw the original error to be handled by the route
    throw error;
  }
};

module.exports = {
  ensureDirectoryExists,
  processAdditionalFiles,
  processReadFiles,
  // Exported for lib/ingest-queue.js, which duplicates its pairing rules in
  // siblingLinks(). See the note on linkPairedReads: the export is what lets
  // the two eventually converge, and until they do they have to be read
  // together.
  linkPairedReads,
};
