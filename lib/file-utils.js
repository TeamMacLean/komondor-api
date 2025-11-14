const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const File = require("../models/File");
const AdditionalFile = require("../models/AdditionalFile");
const Read = require("../models/Read");
const Run = require("../models/Run");
const { calculateFileMd5 } = require("./utils/md5");

const UPLOAD_PATH = _path.join(process.cwd(), "files");

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
    filePath = _path.join(
      process.env.HPC_TRANSFER_DIRECTORY,
      hpcInfo.relativePath,
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
    // Assuming all additional files are from 'local-filesystem' for now.
    const savedFile = await createFileDocument(
      file,
      "additional",
      "local-filesystem",
    );

    const additionalFile = new AdditionalFile({
      [parentType]: parentId,
      file: savedFile._id,
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
    updatePromises = pairedReads.map(async (read) => {
      // Find the sibling's File document by its original name
      const siblingFile = await File.findOne({
        originalName: read.siblingName,
        uploadMethod: "hpc-mv",
      });
      if (!siblingFile) {
        throw new Error(
          `Could not find sibling File document for: ${read.siblingName}`,
        );
      }
      const siblingRead = await Read.findOne({ file: siblingFile._id });
      if (!siblingRead) {
        throw new Error(
          `Could not find sibling Read document for file ID: ${siblingFile._id}`,
        );
      }
      return Read.updateOne(
        { _id: read.readId },
        { $set: { sibling: siblingRead._id } },
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
 * Creates DB documents for a single read file, moves it, validates its checksum,
 * and updates the DB with the results.
 * @param {object} file - The file object from the request.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent run.
 * @param {string} runPath - The relative path of the Run.
 * @param {object} uploadInfo - Information about the upload method.
 * @returns {Promise<object>} An object containing mismatch status and pairing info.
 */
async function processSingleReadFile(file, runId, runPath, uploadInfo) {
  // Create File and Read documents
  const savedFile = await createFileDocument(
    file,
    "run",
    uploadInfo.method,
    uploadInfo,
  );

  const isHpc = uploadInfo.method === "hpc-mv";
  const originalMd5 = isHpc ? file.MD5 : file.md5;
  const readData = {
    run: runId,
    md5: originalMd5,
    file: savedFile._id,
    paired: isHpc ? !!file.sibling : file.paired,
    ...(file.indexed !== undefined && { indexed: file.indexed }),
    destinationMd5: null, // Initialize
    md5Mismatch: false, // Initialize
  };
  // .save() triggers the pre-save hook in Read.js which moves the file
  const savedRead = await new Read(readData).save();

  // The file is now moved, so we can calculate its destination checksum
  const destinationPath = _path.join(
    process.env.DATASTORE_ROOT,
    runPath,
    "raw",
    savedFile.originalName,
  );
  const destinationMd5 = await calculateFileMd5(destinationPath);

  // Compare checksums and update the Read document
  const mismatch = originalMd5 !== destinationMd5;
  await Read.findByIdAndUpdate(savedRead._id, {
    $set: {
      destinationMd5: destinationMd5,
      md5Mismatch: mismatch,
    },
  });

  // Return necessary info for subsequent steps (pairing and final status check)
  return {
    mismatch,
    pairingInfo: {
      readId: savedRead._id,
      isPaired: readData.paired,
      siblingName: isHpc ? file.sibling : null,
      rowId: isHpc ? null : file.rowID,
    },
  };
}

/**
 * Processes and saves read files for a given Run, including MD5 validation.
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
    // 1. Set the initial status of the run to 'pending'
    await Run.findByIdAndUpdate(runId, { $set: { status: "pending" } });

    // 2. Ensure the destination directory exists
    const destinationDir = _path.join(
      process.env.DATASTORE_ROOT,
      runPath,
      "raw",
    );
    await ensureDirectoryExists(destinationDir);

    // 3. Process all files in parallel (create docs, move, checksum)
    const processingResults = await Promise.all(
      readFiles.map((file) =>
        processSingleReadFile(file, runId, runPath, uploadInfo),
      ),
    );

    // 4. Link any paired-end reads
    const pairingInfo = processingResults.map((r) => r.pairingInfo);
    await linkPairedReads(pairingInfo, uploadInfo.method);

    // 5. Determine the final run status based on checksum results
    const hasMismatch = processingResults.some((r) => r.mismatch);
    const finalStatus = hasMismatch ? "error" : "complete";

    // 6. Update the run with the final status
    await Run.findByIdAndUpdate(runId, { $set: { status: finalStatus } });
  } catch (error) {
    console.error(
      `Critical error during read file processing for run ${runId}:`,
      error,
    );
    // Attempt to mark the run as 'error' if any step fails
    try {
      await Run.findByIdAndUpdate(runId, { $set: { status: "error" } });
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
