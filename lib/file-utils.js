const mongoose = require("mongoose");
const _path = require("path");
const fs = require("fs").promises;
const File = require("../models/File");
const AdditionalFile = require("../models/AdditionalFile");
const Read = require("../models/Read");

const UPLOAD_PATH = _path.join(process.cwd(), "files");

/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The absolute path to the directory.
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
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
const createFileDocument = async (file, fileType, uploadMethod, hpcInfo = {}) => {
  const originalName = file.name;
  let name, filePath;

  if (uploadMethod === 'hpc-mv') {
    name = file.name;
    filePath = _path.join(
      process.env.HPC_TRANSFER_DIRECTORY,
      hpcInfo.relativePath,
      file.name
    );
  } else { // 'local-filesystem'
    name = file.uploadName;
    filePath = _path.join(UPLOAD_PATH, name);
  }

  if (!name || !originalName || !filePath) {
    const missing = [!name && 'name', !originalName && 'originalName', !filePath && 'filePath'].filter(Boolean).join(', ');
    throw new Error(`Cannot create File document, missing properties: ${missing}`);
  }

  const savedFile = new File({
    name,
    type: fileType,
    originalName,
    path: filePath,
    tempUploadPath: uploadMethod === 'local-filesystem' ? filePath : undefined,
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
const processAdditionalFiles = async (additionalFiles, parentType, parentId, parentPath) => {
  if (!additionalFiles || additionalFiles.length === 0) {
    return;
  }

  const destinationDir = _path.join(process.env.DATASTORE_ROOT, parentPath, 'additional');
  await ensureDirectoryExists(destinationDir);

  const fileProcessingPromises = additionalFiles.map(async (file) => {
    // Assuming all additional files are from 'local-filesystem' for now.
    const savedFile = await createFileDocument(file, 'additional', 'local-filesystem');

    const additionalFile = new AdditionalFile({
      [parentType]: parentId,
      file: savedFile._id,
    });
    return additionalFile.save();
  });

  await Promise.all(fileProcessingPromises);
};


/**
 * Creates Read and associated File documents for a run.
 * @param {Array<object>} readFiles - Array of file objects from the request.
 * @param {mongoose.Types.ObjectId} runId - The ID of the parent run.
 * @param {object} uploadInfo - Information about the upload method.
 * @returns {Promise<Array<object>>} - A list of created Read documents and pairing info.
 */
const createReadDocuments = async (readFiles, runId, uploadInfo) => {
  const readDocumentPromises = readFiles.map(async (file) => {
    const savedFile = await createFileDocument(file, 'run', uploadInfo.method, uploadInfo);

    const isHpc = uploadInfo.method === 'hpc-mv';
    const readData = {
      run: runId,
      md5: isHpc ? file.MD5 : file.md5,
      file: savedFile._id,
      paired: isHpc ? !!file.sibling : file.paired,
      ...(file.indexed !== undefined && { indexed: file.indexed }),
    };

    const savedRead = await new Read(readData).save();

    // Return info needed for pairing
    return {
      readId: savedRead._id,
      isPaired: readData.paired,
      siblingName: isHpc ? file.sibling : null,
      rowId: isHpc ? null : file.rowID,
    };
  });

  return Promise.all(readDocumentPromises);
};

/**
 * Updates Read documents to link paired-end reads as siblings.
 * @param {Array<object>} readPairingInfo - Information about the created Read documents.
 * @param {string} uploadMethod - The upload method used.
 */
const linkPairedReads = async (readPairingInfo, uploadMethod) => {
  const pairedReads = readPairingInfo.filter(r => r.isPaired);
  if (pairedReads.length === 0) {
    return;
  }

  let updatePromises;

  if (uploadMethod === 'hpc-mv') {
    updatePromises = pairedReads.map(async (read) => {
      // Find the sibling's File document by its original name
      const siblingFile = await File.findOne({ originalName: read.siblingName, uploadMethod: 'hpc-mv' });
      if (!siblingFile) {
        throw new Error(`Could not find sibling File document for: ${read.siblingName}`);
      }
      const siblingRead = await Read.findOne({ file: siblingFile._id });
      if (!siblingRead) {
        throw new Error(`Could not find sibling Read document for file ID: ${siblingFile._id}`);
      }
      return Read.updateOne({ _id: read.readId }, { $set: { sibling: siblingRead._id } });
    });
  } else { // 'local-filesystem'
    const readsByRowId = pairedReads.reduce((acc, read) => {
      acc[read.rowId] = acc[read.rowId] || [];
      acc[read.rowId].push(read);
      return acc;
    }, {});

    updatePromises = Object.values(readsByRowId).flatMap(pair => {
      if (pair.length !== 2) {
        console.error(`Expected 2 reads for rowId ${pair[0]?.rowId}, but found ${pair.length}. Skipping pairing.`);
        return [];
      }
      const [read1, read2] = pair;
      return [
        Read.updateOne({ _id: read1.readId }, { $set: { sibling: read2.readId } }),
        Read.updateOne({ _id: read2.readId }, { $set: { sibling: read1.readId } }),
      ];
    });
  }

  await Promise.all(updatePromises);
};


/**
 * Processes and saves read files for a given Run.
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

  const destinationDir = _path.join(process.env.DATASTORE_ROOT, runPath, 'raw');
  await ensureDirectoryExists(destinationDir);

  const readPairingInfo = await createReadDocuments(readFiles, runId, uploadInfo);

  await linkPairedReads(readPairingInfo, uploadInfo.method);
};


module.exports = {
  processAdditionalFiles,
  processReadFiles,
};
