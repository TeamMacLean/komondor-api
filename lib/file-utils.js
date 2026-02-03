const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const File = require("../models/File");
const AdditionalFile = require("../models/AdditionalFile");
const Read = require("../models/Read");
const Run = require("../models/Run");
const { calculateFileMd5 } = require("./utils/md5");

const UPLOAD_PATH = _path.join(process.cwd(), "files");

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
 * Creates a File document in the database.
 * @param {object} file - The file object from the request.
 * @param {string} fileType - The type of file ('additional' or 'run').
 * @param {string} uploadMethod - The method of upload ('hpc-mv' or 'local-filesystem').
 * @param {object} [hpcInfo] - Information for HPC uploads { relativePath }.
 * @returns {Promise<mongoose.Document>} - The saved File document.
 */
const createFileDocument = async (
  file,
  fileType,
  uploadMethod,
  hpcInfo = {},
) => {
  const originalName = file.name;
  let name, filePath;

  if (uploadMethod === "hpc-mv") {
    name = file.name;
    // Use the relativePath from the file if available, otherwise from hpcInfo
    const relativePath = file.relativePath || hpcInfo.relativePath;

    filePath = _path.join(
      process.env.HPC_TRANSFER_DIRECTORY,
      relativePath,
      file.name,
    );
  } else {
    // 'local-filesystem'
    name = file.uploadName;
    filePath = _path.join(UPLOAD_PATH, name);
  }

  if (!name || !originalName || !filePath) {
    const missing = [
      !name && "name",
      !originalName && "originalName",
      !filePath && "filePath",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Cannot create File document, missing properties: ${missing}`,
    );
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
 * @returns {Promise<void>}
 */
const processAdditionalFiles = async (
  additionalFiles,
  parentType,
  parentId,
  parentPath,
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
    );

    const additionalFile = new AdditionalFile({
      [parentType]: parentId,
      file: savedFile._id,
      MD5: file.md5?.toLowerCase(),
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
 * @returns {Promise<object>} An object containing pairing info.
 */
async function processSingleReadFile(
  file,
  runId,
  runPath,
  uploadInfo,
  cachedRelativePath,
) {
  const startTime = Date.now();

  // Create File and Read documents
  const savedFile = await createFileDocument(
    file,
    "run",
    uploadInfo.method,
    uploadInfo,
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

  const savedRead = await new Read(readData).save();

  // Move file directly using the cached relative path (avoids 2 populate queries per file)
  const rawPath = _path.join(cachedRelativePath, "raw");
  const relPathWithFilename = _path.join(rawPath, savedFile.originalName);
  await savedFile.moveToFolderAndSave(relPathWithFilename);

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
 * @returns {Promise<void>}
 */
const processReadFiles = async (readFiles, runId, runPath, uploadInfo) => {
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
