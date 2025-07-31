const File = require("../models/File");
const AdditionalFile = require("../models/AdditionalFile");
const Read = require("../models/Read");
const mongoose = require("mongoose");

const _path = require("path");
const fs = require("fs");
const UPLOAD_PATH = _path.join(process.cwd(), "files");

const createAdditionalFileDocument = async (file) => {
  return await new Promise(async (res, rej) => {
    const name = file.uploadName;
    const originalName = file.name;
    const type = file.type;

    const filePath = _path.join(UPLOAD_PATH, name);

    const savedFile = await new File({
      name,
      type,
      originalName,
      path: filePath,
      createFileDocumentId: Math.random().toString(16).substr(2, 12),
      tempUploadPath: filePath,
      uploadName: name,
    }).save();

    res(savedFile);
  });
};

const createReadFileDocument = async (file, rawFilesUploadInfo) => {
  return await new Promise(async (res, rej) => {
    const originalName = file.name;

    // contingent variables
    var filePath;
    var name;
    if (rawFilesUploadInfo.method === "hpc-mv") {
      name = file.name;
      filePath = _path.join(
        process.env.HPC_TRANSFER_DIRECTORY,
        rawFilesUploadInfo.relativePath,
        file.name
      );
    } else {
      // file system uploader

      name = file.uploadName;
      filePath = _path.join(UPLOAD_PATH, name);
    }

    if (!name || !originalName || !filePath || rawFilesUploadInfo.method) {
      console.error(
        "Issue with finding info in File mongo document creation.\nname:",
        name,
        "\noriginalName:",
        originalName,
        "\nfilePath",
        filePath,
        "\nfarFilesUPloadInfo.method(whole obj):",
        rawFilesUploadInfo
      );
      // return Promise.reject();
    }

    const savedFile = await new File({
      name,
      type: "run",
      originalName,
      path: filePath,
      createFileDocumentId: Math.random().toString(16).substr(2, 12),
      tempUploadPath: filePath,
      uploadName: name,
      uploadMethod: rawFilesUploadInfo.method,
    }).save();

    res(savedFile);
  });
};

const sortAdditionalFiles = async (
  additionalFiles,
  savedParentType,
  savedParentId,
  savedParentPath
) => {
  const relPath = _path.join(savedParentPath, "additional");
  const absDestPath = _path.join(process.env.DATASTORE_ROOT, relPath);
  const errorInMkDir = false;

  fs.promises
    .access(absDestPath)
    .then(() => {
      console.log("already has additional folder");
    })
    .catch(() => {
      console.log("creating additional folder");
      try {
        return fs.promises.mkdir(absDestPath);
      } catch (e) {
        errorInMkDir = true;
        return Promise.resolve();
      }
    })
    .finally(async () => {
      if (errorInMkDir) {
        return Promise.reject("Error in mkdir");
      }
      try {
        const filePromises = additionalFiles.map(async (file) => {
          const savedFile = await createAdditionalFileDocument(file);
          const additionalFile = await new AdditionalFile({
            [savedParentType]: savedParentId,
            file: savedFile._id,
          }).save();
          return additionalFile;
        });

        return Promise.all([filePromises]);
      } catch (e) {
        return Promise.reject(e);
      }
    });
};

// TODO refactor with shared code of sortAdditioanlFiles
const sortReadFiles = async (readFiles, runId, runPath, rawFilesUploadInfo) => {
  const relPath = _path.join(runPath, "raw");
  const absDestPath = _path.join(process.env.DATASTORE_ROOT, relPath);
  let errorInMkDir = false; // Changed to 'let'

  try {
    await fs.promises.access(absDestPath);
    console.log("already has raw folder");
  } catch (e) {
    console.log("creating raw folder");
    try {
      await fs.promises.mkdir(absDestPath, { recursive: true });
      console.log(`Ensured 'raw' directory exists at: ${absDestPath}`);
    } catch (mkdirError) {
      errorInMkDir = true;
      console.error("Error creating raw directory:", mkdirError);
    }
  }

  if (errorInMkDir) {
    return Promise.reject("Error in mkdir");
  }

  try {
    /** STEP 0: Initialise variable needed in steps 1 + 3 */
    const pairedEntriesToUpdate = [];

    /** STEP 1: Create promises to create File + Read documents */
    const filePromises = readFiles.map(async (file) => {
      const savedFile = await createReadFileDocument(file, rawFilesUploadInfo);

      const readMD5 =
        rawFilesUploadInfo.method === "hpc-mv" ? file.MD5 : file.md5;
      const readPaired =
        rawFilesUploadInfo.method === "hpc-mv"
          ? !!file.sibling // Use sibling information for paired status in hpc-mv
          : file.paired;

      // Prepare data for the Read document, conditionally adding 'indexed'
      const readData = {
        run: runId,
        md5: readMD5,
        file: savedFile._id,
        paired: readPaired,
        // Conditionally add 'indexed' if it exists and is not undefined
        ...(file.indexed !== undefined && { indexed: file.indexed }),
      };

      // Log values before saving
      console.log(`Saving Read document for file: ${file.name}`);
      console.log(`  - MD5: ${readMD5}`);
      console.log(`  - paired: ${readPaired}`);
      if (readData.indexed !== undefined) {
        console.log(`  - indexed: ${readData.indexed}`);
      }

      const readFile = await new Read(readData).save();

      if (file.paired) {
        // Note: file.paired logic might need review for hpc-mv
        if (rawFilesUploadInfo.method === "hpc-mv") {
          pairedEntriesToUpdate.push({
            id: readFile._id,
            indexValue: pairedEntriesToUpdate.length, // Potentially problematic if order changes
            siblingName: file.sibling,
          });
        } else {
          pairedEntriesToUpdate.push({
            id: readFile._id,
            rowId: file.rowID, // Assuming file.rowID is available for non-hpc-mv methods
            indexValue: pairedEntriesToUpdate.length,
          });
        }
      }
      return readFile;
    });

    /** STEP 2: Execute creating File + Read documents */
    await Promise.all(filePromises); // Store result if needed, but not used here

    var updateSiblingsPromises;
    if (rawFilesUploadInfo.method === "hpc-mv") {
      /** Create promises to update Read documents */
      updateSiblingsPromises = pairedEntriesToUpdate.map(
        async (completeEntry) => {
          // Ensure siblingName is present for hpc-mv
          if (!completeEntry.siblingName) {
            console.warn(
              `Missing siblingName for read entry ID: ${completeEntry.id} in hpc-mv method.`
            );
            return Promise.resolve(); // Skip if no sibling name
          }
          const siblingFindInfo = { name: completeEntry.siblingName };
          try {
            const siblings = await Read.find(siblingFindInfo);
            if (!siblings || siblings.length === 0) {
              throw new Error(
                `Sibling file "${completeEntry.siblingName}" not found for read entry ID: ${completeEntry.id}`
              );
            }
            const findInfo = { _id: mongoose.Types.ObjectId(completeEntry.id) };
            const updateInfo = {
              sibling: mongoose.Types.ObjectId(siblings[0]._id),
            };
            await Read.updateOne(findInfo, updateInfo);
            return Promise.resolve();
          } catch (e) {
            console.error(
              `Error updating sibling for read ID ${completeEntry.id}:`,
              e
            );
            return Promise.reject(e); // Propagate error
          }
        }
      );
    } else {
      /** Update each paired=true entry with siblingID for non-hpc-mv methods */
      // This part assumes 'file.paired' is true AND 'file.rowID' is available
      // and that pairedEntriesToUpdate accurately reflects these.
      // Consider if file.indexed needs to influence pairing logic here too.

      const entriesWithSiblingId = pairedEntriesToUpdate.map(
        (entry, entryIndex) => {
          var siblingTarget = pairedEntriesToUpdate.find(
            (comparisonEntry, comparisonIndex) => {
              if (entryIndex === comparisonIndex) return false;
              // This assumes rowId comparison is sufficient for pairing.
              // If 'indexed' status should affect pairing, more logic is needed.
              if (entry.rowId === comparisonEntry.rowId) return true;
              return false;
            }
          );
          return {
            ...entry,
            siblingId: siblingTarget ? siblingTarget.id : null,
          };
        }
      );

      /** Create promises to update Read documents */
      updateSiblingsPromises = entriesWithSiblingId.map(
        async (completeEntry) => {
          const findInfo = { _id: mongoose.Types.ObjectId(completeEntry.id) };
          // Ensure siblingId is valid before creating updateInfo
          if (!completeEntry.siblingId) {
            console.warn(
              `No valid siblingId found for read entry ID: ${completeEntry.id}. Skipping sibling update.`
            );
            return Promise.resolve();
          }
          const updateInfo = {
            sibling: mongoose.Types.ObjectId(completeEntry.siblingId),
          };
          try {
            await Read.updateOne(findInfo, updateInfo);
            return Promise.resolve();
          } catch (e) {
            console.error(
              `Error updating sibling for read ID ${completeEntry.id}:`,
              e
            );
            return Promise.reject(e);
          }
        }
      );
    }

    /** STEP 5: Execute updating Read documents */
    await Promise.all(updateSiblingsPromises);

    return Promise.resolve(); // Indicate overall success
  } catch (e) {
    console.error("Error in sortReadFiles:", e);
    return Promise.reject(e); // Propagate any errors
  }
};

module.exports = {
  sortAdditionalFiles,
  sortReadFiles,
};
