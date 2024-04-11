const mongoose = require("mongoose");
const Project = require("./models/Project");
// Assuming you have the following models
const Run = require("./models/Run");
const File = require("./models/File");
const Read = require("./models/Read");
const Sample = require("./models/Sample");
const { ObjectId } = mongoose.Types;
const path = require("path");

// Your existing rnaSoybeanSampleObjs array and helper functions...

// report outcomes variables

let errors = "";
let successfulRunCount = 0;
let successfulReadCount = 0;
let successfulFileCount = 0;

// helper functions

function generateRandomSixDigitString() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const rnaSoybeanSampleObjs = [
  {
    path: "/maw/rna_sequencing_in_soybean/ev",
    firstRunPairedFilenames: ["ev_1_1.fq.gz", "ev_1_2.fq.gz"],
    secondRunPairedFilenames: ["ev_2_1.fq.gz", "ev_2_2.fq.gz"],
    idString: "661528b992eb39be25529884",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/in0_5h",
    firstRunPairedFilenames: ["in_0_5h_1_1.fq.gz", "in_0_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["in_0_5h_2_1.fq.gz", "in_0_5h_2_2.fq.gz"],
    idString: "661528b992eb39be25529885",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/in12h",
    firstRunPairedFilenames: ["in_12h_1_1.fq.gz", "in_12h_1_2.fq.gz"],
    secondRunPairedFilenames: ["in_12h_2_1.fq.gz", "in_12h_2_2.fq.gz"],
    idString: "661528b992eb39be25529886",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/in1_5h",
    firstRunPairedFilenames: ["in_1_5h_1_1.fq.gz", "in_1_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["in_1_5h_2_1.fq.gz", "in_1_5h_2_2.fq.gz"],
    idString: "661528b992eb39be25529887",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/in3h",
    firstRunPairedFilenames: ["in_3h_1_1.fq.gz", "in_3h_1_2.fq.gz"],
    secondRunPairedFilenames: ["in_3h_2_1.fq.gz", "in_3h_2_2.fq.gz"],
    idString: "661528b992eb39be25529888",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/in6h",
    firstRunPairedFilenames: ["in_6h_1_1.fq.gz", "in_6h_1_2.fq.gz"],
    secondRunPairedFilenames: ["in_6h_2_1.fq.gz", "in_6h_2_2.fq.gz"],
    idString: "661528b992eb39be25529889",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/no0h",
    firstRunPairedFilenames: ["no_0h_1_1.fq.gz", "no_0h_1_2.fq.gz"],
    secondRunPairedFilenames: ["no_0h_2_1.fq.gz", "no_0h_2_2.fq.gz"],
    idString: "661528b992eb39be2552988a",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe1507",
    firstRunPairedFilenames: ["oe1507_1_1.fq.gz", "oe1507_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe1507_2_1.fq.gz", "oe1507_2_2.fq.gz"],
    idString: "661528b992eb39be2552988b",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe1508",
    firstRunPairedFilenames: ["oe1508_1_1.fq.gz", "oe1508_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe1508_2_1.fq.gz", "oe1508_2_2.fq.gz"],
    idString: "661528b992eb39be2552988c",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe1510",
    firstRunPairedFilenames: ["oe1510_1_1.fq.gz", "oe1510_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe1510_2_1.fq.gz", "oe1510_2_2.fq.gz"],
    idString: "661528b992eb39be2552988d",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe1515",
    firstRunPairedFilenames: ["oe1515_1_1.fq.gz", "oe1515_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe1515_2_1.fq.gz", "oe1515_2_2.fq.gz"],
    idString: "661528b992eb39be2552988e",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe2109",
    firstRunPairedFilenames: ["oe2109_1_1.fq.gz", "oe2109_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe2109_2_1.fq.gz", "oe2109_2_2.fq.gz"],
    idString: "661528b992eb39be2552988f",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/oe2118",
    firstRunPairedFilenames: ["oe2118_1_1.fq.gz", "oe2118_1_2.fq.gz"],
    secondRunPairedFilenames: ["oe2118_2_1.fq.gz", "oe2118_2_2.fq.gz"],
    idString: "661528b992eb39be25529890",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/p0_5h",
    firstRunPairedFilenames: ["p_0_5h_1_1.fq.gz", "p_0_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["p_0_5h_2_1.fq.gz", "p_0_5h_2_2.fq.gz"],
    idString: "661528b992eb39be25529891",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/p12h",
    firstRunPairedFilenames: ["p_12h_1_1.fq.gz", "p_12h_1_2.fq.gz"],
    secondRunPairedFilenames: ["p_12h_2_1.fq.gz", "p_12h_2_2.fq.gz"],
    idString: "661528b992eb39be25529892",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/p1_5h",
    firstRunPairedFilenames: ["p_1_5h_1_1.fq.gz", "p_1_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["p_1_5h_2_1.fq.gz", "p_1_5h_2_2.fq.gz"],
    idString: "661528b992eb39be25529893",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/p3h",
    firstRunPairedFilenames: ["p_3h_1_1.fq.gz", "p_3h_1_2.fq.gz"],
    secondRunPairedFilenames: ["p_3h_2_1.fq.gz", "p_3h_2_2.fq.gz"],
    idString: "661528b992eb39be25529894",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/p6h",
    firstRunPairedFilenames: ["p_6h_1_1.fq.gz", "p_6h_1_2.fq.gz"],
    secondRunPairedFilenames: ["p_6h_2_1.fq.gz", "p_6h_2_2.fq.gz"],
    idString: "661528b992eb39be25529895",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/psr2",
    firstRunPairedFilenames: ["psr2_1_1.fq.gz", "psr2_1_2.fq.gz"],
    secondRunPairedFilenames: ["psr2_2_1.fq.gz", "psr2_2_2.fq.gz"],
    idString: "661528b992eb39be25529896",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/psr2m",
    firstRunPairedFilenames: ["psr2m_1_1.fq.gz", "psr2m_1_2.fq.gz"],
    secondRunPairedFilenames: ["psr2m_2_1.fq.gz", "psr2m_2_2.fq.gz"],
    idString: "661528b992eb39be25529897",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm1507",
    firstRunPairedFilenames: ["sttm1507_1_1.fq.gz", "sttm1507_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm1507_2_1.fq.gz", "sttm1507_2_2.fq.gz"],
    idString: "661528b992eb39be25529898",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm1508",
    firstRunPairedFilenames: ["sttm1508_1_1.fq.gz", "sttm1508_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm1508_2_1.fq.gz", "sttm1508_2_2.fq.gz"],
    idString: "661528b992eb39be25529899",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm1510",
    firstRunPairedFilenames: ["sttm1510_1_1.fq.gz", "sttm1510_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm1510_2_1.fq.gz", "sttm1510_2_2.fq.gz"],
    idString: "661528b992eb39be2552989a",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm1515",
    firstRunPairedFilenames: ["sttm1515_1_1.fq.gz", "sttm1515_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm1515_2_1.fq.gz", "sttm1515_2_2.fq.gz"],
    idString: "661528b992eb39be2552989b",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm2109",
    firstRunPairedFilenames: ["sttm2109_1_1.fq.gz", "sttm2109_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm2109_2_1.fq.gz", "sttm2109_2_2.fq.gz"],
    idString: "661528b992eb39be2552989c",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/sttm2118",
    firstRunPairedFilenames: ["sttm2118_1_1.fq.gz", "sttm2118_1_2.fq.gz"],
    secondRunPairedFilenames: ["sttm2118_2_1.fq.gz", "sttm2118_2_2.fq.gz"],
    idString: "661528b992eb39be2552989d",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/w0_5h",
    firstRunPairedFilenames: ["w_0_5h_1_1.fq.gz", "w_0_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["w_0_5h_2_1.fq.gz", "w_0_5h_2_2.fq.gz"],
    idString: "661528b992eb39be2552989e",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/w12h",
    firstRunPairedFilenames: ["w_12h_1_1.fq.gz", "w_12h_1_2.fq.gz"],
    secondRunPairedFilenames: ["w_12h_2_1.fq.gz", "w_12h_2_2.fq.gz"],
    idString: "661528b992eb39be2552989f",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/w1_5h",
    firstRunPairedFilenames: ["w_1_5h_1_1.fq.gz", "w_1_5h_1_2.fq.gz"],
    secondRunPairedFilenames: ["w_1_5h_2_1.fq.gz", "w_1_5h_2_2.fq.gz"],
    idString: "661528b992eb39be255298a0",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/w3h",
    firstRunPairedFilenames: ["w_3h_1_1.fq.gz", "w_3h_1_2.fq.gz"],
    secondRunPairedFilenames: ["w_3h_2_1.fq.gz", "w_3h_2_2.fq.gz"],
    idString: "661528b992eb39be255298a1",
  },
  {
    path: "/maw/rna_sequencing_in_soybean/w6h",
    firstRunPairedFilenames: ["w_6h_1_1.fq.gz", "w_6h_1_2.fq.gz"],
    secondRunPairedFilenames: ["w_6h_2_1.fq.gz", "w_6h_2_2.fq.gz"],
    idString: "661528b992eb39be255298a2",
  },
];

const keyNamesForPairedFiles = [
  "firstRunPairedFilenames",
  "secondRunPairedFilenames",
];

// Wrap your logic in an async function
async function main() {
  // Add your for-loop and logic inside this function

  // For each of these srna in soybean sample IDs:

  // for (let samples_index = 0; samples_index < 1; samples_index++) {
  for (let samples_index = 0; samples_index < rnaSoybeanSampleObjs.length; samples_index++) {
    const runNames = ["Rep1", "Rep2"];

    // for paired, have to pair 'sibling' after loop iteration

    for (let runNames_index = 0; runNames_index < runNames.length; runNames_index++) {
      // Create a run document:

      const runName = runNames[runNames_index];
      const runSafeName = runNames[runNames_index].toLowerCase();
      const runPath = path.join(
        rnaSoybeanSampleObjs[samples_index].path || "",
        runSafeName || ""
      );

      const newRun = new Run({
        _id: ObjectId(),
        forceSafeName: true, // bypasses pre-validate check
        additionalFilesUploadIDs: [],
        accessions: [],
        sample: ObjectId(rnaSoybeanSampleObjs[samples_index].idString),
        name: runName,
        sequencingProvider: "novogene",
        sequencingTechnology: "Illumina NextSeq 6000",
        librarySource: "TRANSCRIPTOMIC",
        libraryType: "FASTQ - Paired",
        librarySelection: "cDNA",
        libraryStrategy: "RNA - Seq",
        insertSize: "150",
        owner: "lfeng",
        group: ObjectId("5fc012bda3efcb29338b7cf0"),
        safeName: runSafeName,
        path: runPath,
        createdAt: new Date("2024-04-10T13:23:23.649Z"),
        updatedAt: new Date("2024-04-10T13:23:23.649Z"),
        __v: 0,
      });

      const newRunResult = await newRun.save();

      if (!newRunResult._id) {
        errors += `Issue creating run document ${
          i + 1
        } at Sample samples_index ${samples_index}.\n`;
        throw new Error(errors);
      } else {
        console.log("Created Run document: " + newRunResult._id);
        successfulRunCount++;
      }

      keyNamesForPairedFiles.forEach((keyName, paired_filenames_index) => {

        var fileName = '';

        if (runNames_index === 0){
          if (paired_filenames_index === 0) {
            fileName = rnaSoybeanSampleObjs[samples_index].firstRunPairedFilenames[0];
          } else {
            fileName = rnaSoybeanSampleObjs[samples_index].firstRunPairedFilenames[1];
          }
        } else { // runNames_index === 1
          if (paired_filenames_index === 0) {
            fileName = rnaSoybeanSampleObjs[samples_index].secondRunPairedFilenames[0];
          } else {
            fileName = rnaSoybeanSampleObjs[samples_index].secondRunPairedFilenames[1];
          }
        }

        const filePath = path.join(runPath, fileName);

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
          createdAt: new Date("2024-04-10T13:23:23.683Z"),
          updatedAt: new Date("2024-04-10T13:23:25.626Z"),
          __v: 0,
        });

        const newFileResult = await newFile.save();

        if (!newFileResult._id) {
          errors += `Issue creating file document with paired_filenames_index of ${
            paired_filenames_index
          } and runNames_index of ${
            runNames_index
          } and samples_index of ${
            samples_index
          }.\n`;
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
          paired: true, // true for soybean rna
          createdAt: new Date("2024-04-10T12:23:23.687Z"),
          updatedAt: new Date("2024-04-10T12:23:23.714Z"),
          __v: 0,
          skipPostSave: true,
          // sibling: ObjectId("6613e1bbe372f7554d754a84"),
        });

        const newReadResult = await newRead.save();

        if (!newReadResult._id) {
          errors += `Issue creating Read document with paired_filenames_index of ${
            paired_filenames_index
          } and runNames_index of ${
            runNames_index
          } and samples_index of ${
            samples_index
          }.\n`;
          throw new Error(errors);
        } else {
          console.log("Created Read document: " + newReadResult._id);
          successfulReadCount++;
        }  
      
      }); // end making multi-Files and multi-Reads loop
    } // end making multi-Runs loop
  } // end making multi-Samples loop

  // report final outcomes

  if (errors !== "") {
    console.error("Final errors: " + errors);
  }
  console.log(
    `Total Samples: ${rnaSoybeanSampleObjs.length}\nExpecting ${
      rnaSoybeanSampleObjs.length * 2
    } successful runs/files/reads:\nSuccessful runs: ${successfulRunCount}\nSuccessful reads: ${successfulReadCount}\nSuccessful files: ${successfulFileCount}`
  );
}

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/komondor", {
    useNewUrlParser: true,
    useCreatesamples_index: true,
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
