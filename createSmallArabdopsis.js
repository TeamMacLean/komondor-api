const mongoose = require("mongoose");
const Project = require("./models/Project");
// Assuming you have the following models
const Run = require("./models/Run");
const File = require("./models/File");
const Read = require("./models/Read");
const Sample = require("./models/Sample");
const { ObjectId } = mongoose.Types;
const path = require("path");

// Your existing sRnaArabdopsisSampleObjs array and helper functions...

// report outcomes variables

let errors = "";
let successfulRunCount = 0;
let successfulReadCount = 0;
let successfulFileCount = 0;

// helper functions

function generateRandomSixDigitString() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const sRnaArabdopsisSampleObjs = [
  {
    sampleSafeName: "an_1",
    firstRunOnlyFilename: "An-1_rep1.fastq.gz",
    secondRunOnlyFilename: "An-1_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/an_1",
    idString: "66102b43e372f7554d754a79",
  },
  {
    sampleSafeName: "ct_1",
    firstRunOnlyFilename: "Ct-1_rep1.fastq.gz",
    secondRunOnlyFilename: "Ct-1_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/ct_1",
    idString: "66102d32b6a4079eae8295ab",
  },
  {
    sampleSafeName: "cvi_1",
    firstRunOnlyFilename: "Cvi-1_rep1.fastq.gz",
    secondRunOnlyFilename: "Cvi-1_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/cvi_1",
    idString: "66102d88b6a4079eae8295ac",
  },
  {
    sampleSafeName: "eri_1",
    firstRunOnlyFilename: "Eri-1_rep1.fastq.gz",
    secondRunOnlyFilename: "Eri-1_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/eri_1",
    idString: "66102deab6a4079eae8295ad",
  },
  {
    sampleSafeName: "kyo_1",
    firstRunOnlyFilename: "Kyo-1_rep1.fastq.gz",
    secondRunOnlyFilename: "Kyo-1_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/kyo_1",
    idString: "66102deab6a4079eae8295ae",
  },
  {
    sampleSafeName: "ler_0",
    firstRunOnlyFilename: "Ler-0_rep1.fastq.gz",
    secondRunOnlyFilename: "Ler-0_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/ler_0",
    idString: "66102deab6a4079eae8295af",
  },
  {
    sampleSafeName: "sha",
    firstRunOnlyFilename: "Sha_rep1.fastq.gz",
    secondRunOnlyFilename: "Sha_rep2.fastq.gz",
    path: "/maw/srna_sequencing_in_soybean/sha",
    idString: "66102deab6a4079eae8295b0",
  },
];

// Wrap your logic in an async function
async function main() {
  // Add your for-loop and logic inside this function

  // For each of these srna in soybean sample IDs:

  // for (let index = 0; index < 1; index++) {
  for (let index = 0; index < sRnaArabdopsisSampleObjs.length; index++) {
    const runNames = ["Rep1", "Rep2"];

    // for paired, have to pair 'sibling' after loop iteration

    for (let i = 0; i < runNames.length; i++) {
      // Create a run document:

      const runName = runNames[i];
      const runSafeName = runNames[i].toLowerCase();
      const runPath = path.join(
        sRnaArabdopsisSampleObjs[index].path || "",
        runSafeName || ""
      );

      const newRun = new Run({
        _id: ObjectId(),
        forceSafeName: true, // bypasses pre-validate check
        additionalFilesUploadIDs: [],
        accessions: [],
        sample: ObjectId(sRnaArabdopsisSampleObjs[index].idString),
        name: runName,
        sequencingProvider: "novogene",
        sequencingTechnology: "Illumina NextSeq 500",
        librarySource: "TRANSCRIPTOMIC",
        libraryType: "FASTQ - Single",
        librarySelection: "other",
        libraryStrategy: "miRNA - Seq",
        insertSize: "150",
        owner: "lfeng",
        group: ObjectId("5fc012bda3efcb29338b7cf0"),
        safeName: runSafeName,
        path: runPath,
        createdAt: new Date("2024-04-11T14:23:23.649Z"),
        updatedAt: new Date("2024-04-11T14:23:23.649Z"),
        __v: 0,
      });

      const newRunResult = await newRun.save();

      if (!newRunResult._id) {
        errors += `Issue creating run document ${
          i + 1
        } at Sample index ${index}.\n`;
        throw new Error(errors);
      } else {
        console.log("Created Run document: " + newRunResult._id);
        successfulRunCount++;
      }

      const fileName =
        i === 0
          ? sRnaArabdopsisSampleObjs[index].firstRunOnlyFilename
          : sRnaArabdopsisSampleObjs[index].secondRunOnlyFilename;

      const filePath = path.join(runPath, fileName);

      if (
        typeof fileName !== "string" ||
        fileName.length === 0 ||
        typeof filePath !== "string" ||
        filePath.length === 0 ||
        filePath === undefined ||
        filePath === null
      ) {
        throw new Error("Invalid file path", filePath, fileName, i, index);
      } else {
      }

      var fileDocId = generateRandomSixDigitString();

      // Create a file document:
      const newFile = new File({
        _id: ObjectId(),
        name: fileName,
        type: "run",
        originalName: fileName,
        path: filePath,
        createFileDocumentId: fileDocId,
        tempUploadPath: filePath,
        uploadName: fileName,
        uploadMethod: "admin-manual",
        createdAt: new Date("2024-04-11T14:23:23.649Z"),
        updatedAt: new Date("2024-04-11T14:23:23.649Z"),
        __v: 0,
      });

      const newFileResult = await newFile.save();

      if (!newFileResult._id) {
        errors += `Issue creating file document ${
          i + 1
        } at Sample index ${index}.\n`;
        throw new Error(errors);
      } else {
        console.log("Created File document: " + newFileResult._id);
        successfulFileCount++;
      }

      // Create a read document:

      const newRead = new Read({
        _id: ObjectId(),
        run: ObjectId(newRunResult._id),
        file: ObjectId(newFileResult._id),
        paired: false, // false for arabdopsis sRNA
        createdAt: new Date("2024-04-11T14:23:23.649Z"),
        updatedAt: new Date("2024-04-11T14:23:23.649Z"),
        __v: 0,
        skipPostSave: true,
        // sibling: ObjectId("6613e1bbe372f7554d754a84"),
      });

      const newReadResult = await newRead.save();

      if (!newReadResult._id) {
        errors += `Issue creating read document ${
          i + 1
        } at Sample index ${index}.\n`;
        throw new Error(errors);
      } else {
        console.log("Created Read document: " + newReadResult._id);
        successfulReadCount++;
      }
    } // end making multi-Runs loop
  } // end making multi-Samples loop

  // report final outcomes

  if (errors !== "") {
    console.error("Final errors: " + errors);
  }
  console.log(
    `Total Samples: ${sRnaArabdopsisSampleObjs.length}\nExpecting ${
      sRnaArabdopsisSampleObjs.length * 2
    } successful runs/files/reads:\nSuccessful runs: ${successfulRunCount}\nSuccessful reads: ${successfulReadCount}\nSuccessful files: ${successfulFileCount}`
  );
}

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/komondor", {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
    main().then(() => mongoose.disconnect());
  })
  .catch((err) => {
    console.error("Connection error", err);
    mongoose.disconnect();
  });
