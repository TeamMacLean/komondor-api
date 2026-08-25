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

// Called, not captured at load: UPLOAD_DIRECTORY may be set after this module
// loads. Shared with routes/uploads.js and models/File.js.
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
 * The raw value is logged but kept out of the message, which reaches the client
 * as the Run's statusError.
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
 * Distinguishes a missing upload root from a bad filename — resolveWithinReal
 * returns null for both.
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
 * An upload with no recorded owner is refused, not waved through: that is what
 * uploads from the old unauthenticated mount look like.
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
 * Creates a File document in the database. Every path component arrives in the
 * request body, so each is reduced to something that cannot leave its root.
 * @param {object} file - The file object from the request.
 * @param {string} fileType - 'additional' or 'run'.
 * @param {string} uploadMethod - 'hpc-mv' or 'local-filesystem'.
 * @param {object} [hpcInfo] - Information for HPC uploads { relativePath }.
 * @param {string} [username] - The authenticated caller, checked before a claim.
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

  // Not just a label: moveToFolderAndSave builds the datastore destination out
  // of originalName, so a traversal here escapes the datastore later.
  const originalName = safeBasename(rawOriginalName);
  if (!originalName) {
    rejectUnsafePath("originalName", rawOriginalName);
  }

  let filePath;

  if (isHpc) {
    if (!process.env.HPC_TRANSFER_DIRECTORY) {
      throw new Error("HPC_TRANSFER_DIRECTORY is not configured");
    }

    // Leading slashes stripped, not rejected: real uploads send "/WGS_Test".
    const rawRelativePath = file.relativePath || hpcInfo.relativePath;
    const relativePath = cleanDirectoryName(rawRelativePath);

    filePath = await resolveWithinReal(
      process.env.HPC_TRANSFER_DIRECTORY,
      relativePath,
      name,
    );
    if (!filePath) {
      // Reported as a configuration fault, not as a refused claim.
      await assertRootUsable(
        "HPC_TRANSFER_DIRECTORY",
        process.env.HPC_TRANSFER_DIRECTORY,
      );

      // Raw values, joined by hand: cleanDirectoryName can return null and
      // path.join() throws a TypeError on a null segment.
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

    // After the path guards, so a traversal reports as a bad path.
    await assertUploadClaimable(name, username);

    // Ownership alone is not completeness: without this, a short or
    // truncated blob is claimed and moved into a project as if it were the
    // whole file. See lib/upload-quota.js's assertUploadComplete.
    await quota.assertUploadComplete(uploadRoot, name);
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
 * Turns the rejected half of a settled batch into one error.
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
    // Unwrapped: this message is shown to the client as the Run's statusError.
    return reasons[0];
  }

  // Deduplicated: five files failing on one full disk is a single fact.
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
 * Adopts a file an earlier attempt already moved: the move succeeded, the row
 * save after it did not, and the bytes now sit in the datastore unreferenced.
 *
 * All four must hold, or a file that is not this one could be adopted: 1. the
 * destination comes from the parent's stored path, never the request; 2. for a
 * source moveToFolderAndSave would actually unlink, the staged source is gone;
 * 3. no Read or AdditionalFile references a File already at that path; 4. the
 * declared MD5, if any, matches.
 *
 * @param {mongoose.Document} savedFile - The File document for this attempt.
 * @param {string} relPathWithFilename - Datastore-relative destination.
 * @param {string} sourcePath - Where the bytes were before the move.
 * @param {string} [expectedMd5] - The MD5 the request declared, if any.
 * @param {boolean} [sourceMayPersist] - True for an hpc-mv claim, whose source
 *   moveToFolderAndSave deliberately leaves in place on a successful move (see
 *   models/File.js's `keepSource`, BREAKING_CHANGES.md entry 35). For that
 *   source, condition 2 asks whether the source and destination are the same
 *   inode (proof of a real hard-link move) instead of asking whether the
 *   source is gone, which a kept source never is regardless of whether this
 *   attempt's own move happened.
 * @returns {Promise<mongoose.Document|null>} The document the row should point
 *   at, or null when the destination cannot safely be adopted.
 */
const adoptAlreadyMovedFile = async (
  savedFile,
  relPathWithFilename,
  sourcePath,
  expectedMd5,
  sourceMayPersist = false,
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

  // Condition 2. For a source moveToFolderAndSave always unlinks, its
  // absence proves this document's own move already consumed it — lstat, not
  // stat, so a symlink left at the source name still counts as "there",
  // which fails closed. For a source that may persist (hpc-mv), "still
  // there" no longer distinguishes "my move already happened" from "nothing
  // was moved yet", so instead this asks whether the destination and the
  // source are the exact same file (same device, same inode) — true for a
  // same-filesystem hpc-mv move, which is what moveToFolderAndSave actually
  // does (a hard link, not a copy). A same-named-but-unrelated file sitting
  // at the destination — nothing moved by anybody — fails this the same way
  // it fails an MD5 check: it is a different file, not this one. Left
  // unproven for a cross-device hpc-mv move (the source is copied, not
  // linked, so it is never the same inode as the destination even on a
  // genuine success) — refusing that narrower case is the safe direction to
  // fail in, not a guess either way.
  if (sourceMayPersist) {
    const sourceStats = await fs.stat(sourcePath).catch(() => null);
    if (
      !sourceStats ||
      sourceStats.dev !== destinationStats.dev ||
      sourceStats.ino !== destinationStats.ino
    ) {
      return null;
    }
  } else {
    const sourceGone = await fs
      .lstat(sourcePath)
      .then(() => false)
      .catch((err) => err.code === "ENOENT");
    if (!sourceGone) {
      return null;
    }
  }

  // Condition 4.
  if (expectedMd5) {
    const actualMd5 = await calculateFileMd5(destination).catch(() => null);
    if (!actualMd5 || actualMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
      return null;
    }
  }

  // Condition 3. Matched on the datastore-relative path, which is what
  // moveToFolderAndSave stores on the document.
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

    // Deleted, not left behind: File's unique {name, path, createFileDocumentId}
    // index would otherwise refuse the next attempt's identical document.
    await File.deleteOne({ _id: savedFile._id });
    return occupant;
  }

  // Nothing points at the bytes: the failed save was this document's own.
  savedFile.path = relPathWithFilename;
  return savedFile.save();
};

/**
 * Moves a file into the datastore, recovering an already-moved one, and audits
 * the HPC claim after the move: a claim that failed to move took nothing.
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
  // Only the shared HPC inbox needs attribution; assertUploadClaimable already
  // proved ownership for a local-filesystem upload.
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
      // hpc-mv's source is deliberately kept on a successful move (FIX 1 /
      // BREAKING_CHANGES.md entry 35), so "still there" cannot be used to
      // tell a successful-but-unsaved move apart from a move that never
      // happened — see adoptAlreadyMovedFile's own doc for why this is safe.
      isHpc,
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
 * @param {string} [username] - The authenticated caller, checked before a claim.
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
    const uploadMethod = file.uploadMethod || "local-filesystem";

    const savedFile = await createFileDocument(
      file,
      "additional",
      uploadMethod,
      file,
      username,
    );

    // Move first, then write the row with skipPostSave, so a failed move leaves
    // no AdditionalFile row claiming the file arrived.
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
  // keep moving files after the caller has been told the batch failed.
  const settled = await Promise.allSettled(fileProcessingPromises);
  const failure = batchFailure(settled, additionalFiles.length);
  if (failure) {
    throw failure;
  }
};

/**
 * Creates DB documents for a single read file and moves it.
 * MD5 validation is deferred to background processing.
 * @param {object} file - The file object from the request.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method.
 * @param {string} cachedRelativePath - The run's relative path, resolved once.
 * @param {string} [username] - The authenticated caller, checked before a claim.
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

  const savedFile = await createFileDocument(
    file,
    "run",
    uploadInfo.method,
    uploadInfo,
    username,
  );

  const isHpc = uploadInfo.method === "hpc-mv";
  const originalMd5 = file.md5?.toLowerCase();

  // Move first, save the Read second, so a failed move leaves no row claiming
  // the file arrived. Relies on readData's skipPostSave to avoid a second move.
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
    // fileForRow, not savedFile: the move may have reconciled onto a document
    // an earlier attempt left behind.
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
 * Moves read files into the datastore for a Run. MD5 validation is deferred to
 * background processing.
 *
 * Does NOT pair siblings or mark the run "complete" — lib/ingest-queue.js's
 * finaliseReadStage does both, always, once the move here (if any) has
 * finished. It has to happen there and not here: a retry may hand this
 * function only the files not already at their destination (see
 * planRawFileStage), so pairing within just this call's argument list would
 * miss a sibling that landed on an earlier attempt.
 *
 * @param {Array<object>} readFiles - Files to move. A retry may pass only the
 *   ones not already delivered, not the run's whole raw-file set.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent Run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method and files.
 * @param {string} [username] - The authenticated caller, checked before a claim.
 * @returns {Promise<Array<object>>} pairingInfo for each file this call moved,
 *   for the caller to pair and finalise.
 */
const processReadFiles = async (
  readFiles,
  runId,
  runPath,
  uploadInfo,
  username,
) => {
  if (!readFiles || readFiles.length === 0) {
    return [];
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

    // 4. Move files with limited concurrency (create docs and move files)
    const processingResults = [];
    for (let i = 0; i < readFiles.length; i += FILE_CONCURRENCY_LIMIT) {
      const batch = readFiles.slice(i, i + FILE_CONCURRENCY_LIMIT);

      // allSettled, not all: Promise.all abandons the rest of the batch, which
      // keeps moving files after the run has been marked 'error'.
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

    const duration = Date.now() - startTime;
    console.log(
      `[File Processing] Moved ${readFiles.length} read file(s) for run ${runId} in ${duration}ms.`,
    );

    return processingResults.map((r) => r.pairingInfo);
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
    throw error;
  }
};

module.exports = {
  ensureDirectoryExists,
  processAdditionalFiles,
  processReadFiles,
};
