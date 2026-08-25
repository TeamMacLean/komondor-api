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
      await assertRootUsable(
        "HPC_TRANSFER_DIRECTORY",
        process.env.HPC_TRANSFER_DIRECTORY,
      );
      rejectUnsafePath("relativePath", rawRelativePath);
    }

    // The staging area is shared by every group and nothing records which
    // group a subdirectory belongs to, so this claim cannot be authorised —
    // only attributed. It both links the bytes into the caller's datastore and
    // unlinks them from the inbox, so an operator needs to be able to find out
    // afterwards who took what. See lib/utils/hpcAudit.js.
    auditHpcAccess({
      action: "claim",
      user: { username },
      path: filePath,
      detail: `type=${fileType}`,
    });
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
    // row is written with skipPostSave so the model's hook does not repeat it.
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
    await savedFile.moveToFolderAndSave(relPathWithFilename);

    const additionalFile = new AdditionalFile({
      [parentType]: parentId,
      file: savedFile._id,
      MD5: file.md5?.toLowerCase(),
      skipPostSave: true, // Skip post-save hook — moved directly above
    });
    return additionalFile.save();
  });

  await Promise.all(fileProcessingPromises);
};

/**
 * Updates Read documents to link paired-end reads as siblings.
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
  const readData = {
    run: runId,
    MD5: originalMd5, // Normalized to lowercase for consistent comparison
    file: savedFile._id,
    paired: isHpc ? !!file.sibling : file.paired,
    ...(file.indexed !== undefined && { indexed: file.indexed }),
    destinationMd5: null, // Initialize - will be calculated in background
    md5Mismatch: null, // Initialize as null (not yet checked)
    skipPostSave: true, // Skip post-save hook — we move the file directly below
  };

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
  await savedFile.moveToFolderAndSave(relPathWithFilename);

  const savedRead = await new Read(readData).save();

  const duration = Date.now() - startTime;
  console.log(
    `[File Processing] File '${savedFile.originalName}' moved successfully (${duration}ms)`,
  );

  // Return necessary info for subsequent steps (pairing only - MD5 is deferred)
  return {
    pairingInfo: {
      readId: savedRead._id,
      isPaired: readData.paired,
      siblingName: isHpc ? file.sibling : null,
      fileName: savedFile.originalName,
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
      const batchResults = await Promise.all(
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
      processingResults.push(...batchResults);
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
};
