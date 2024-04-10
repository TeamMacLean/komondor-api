const mongoose = require("mongoose");
const Project = require("./models/Project");
// Assuming you have the following models
const Run = require("./models/Run");
const File = require("./models/File");
const Read = require("./models/Read");
const Sample = require("./models/Sample");
const { ObjectId } = mongoose.Types;
const path = require("path");

// Your existing sRnaSoybeanSampleObjs array and helper functions...

// report outcomes variables

let errors = "";
let successfulRunCount = 0;
let successfulReadCount = 0;
let successfulFileCount = 0;

// helper functions

function generateRandomSixDigitString() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const sRnaSoybeanSampleObjs = [
  {
    path: "/maw/srna_sequencing_in_soybean/ev",
    firstRunOnlyFilename: "Raw.ev_1.fq.gz",
    secondRunOnlyFilename: "Raw.ev_2.fq.gz",
    idString: "6615273392eb39be25529860",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/in0_5h",
    firstRunOnlyFilename: "Raw.in_0_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.in_0_5h_2.fq.gz",
    idString: "6615273392eb39be25529861",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/in12h",
    firstRunOnlyFilename: "Raw.in_12h_1.fq.gz",
    secondRunOnlyFilename: "Raw.in_12h_2.fq.gz",
    idString: "6615273392eb39be25529862",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/in1_5h",
    firstRunOnlyFilename: "Raw.in_1_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.in_1_5h_2.fq.gz",
    idString: "6615273392eb39be25529863",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/in3h",
    firstRunOnlyFilename: "Raw.in_3h_1.fq.gz",
    secondRunOnlyFilename: "Raw.in_3h_2.fq.gz",
    idString: "6615273392eb39be25529864",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/in6h",
    firstRunOnlyFilename: "Raw.in_6h_1.fq.gz",
    secondRunOnlyFilename: "Raw.in_6h_2.fq.gz",
    idString: "6615273392eb39be25529865",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/no0h",
    firstRunOnlyFilename: "Raw.no_0h_1.fq.gz",
    secondRunOnlyFilename: "Raw.no_0h_2.fq.gz",
    idString: "6615273392eb39be25529866",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe1507",
    firstRunOnlyFilename: "Raw.oe1507_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe1507_2.fq.gz",
    idString: "6615273392eb39be25529867",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe1508",
    firstRunOnlyFilename: "Raw.oe1508_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe1508_2.fq.gz",
    idString: "6615273392eb39be25529868",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe1510",
    firstRunOnlyFilename: "Raw.oe1510_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe1510_2.fq.gz",
    idString: "6615273392eb39be25529869",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe1515",
    firstRunOnlyFilename: "Raw.oe1515_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe1515_2.fq.gz",
    idString: "6615273392eb39be2552986a",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe2109",
    firstRunOnlyFilename: "Raw.oe2109_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe2109_2.fq.gz",
    idString: "6615273392eb39be2552986b",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/oe2118",
    firstRunOnlyFilename: "Raw.oe2118_1.fq.gz",
    secondRunOnlyFilename: "Raw.oe2118_2.fq.gz",
    idString: "6615273392eb39be2552986c",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/p0_5h",
    firstRunOnlyFilename: "Raw.p_0_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.p_0_5h_2.fq.gz",
    idString: "6615273392eb39be2552986d",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/p12h",
    firstRunOnlyFilename: "Raw.p_12h_1.fq.gz",
    secondRunOnlyFilename: "Raw.p_12h_2.fq.gz",
    idString: "6615273392eb39be2552986e",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/p1_5h",
    firstRunOnlyFilename: "Raw.p_1_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.p_1_5h_2.fq.gz",
    idString: "6615273392eb39be2552986f",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/p3h",
    firstRunOnlyFilename: "Raw.p_3h_1.fq.gz",
    secondRunOnlyFilename: "Raw.p_3h_2.fq.gz",
    idString: "6615273392eb39be25529870",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/p6h",
    firstRunOnlyFilename: "Raw.p_6h_1.fq.gz",
    secondRunOnlyFilename: "Raw.p_6h_2.fq.gz",
    idString: "6615273392eb39be25529871",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/psr2",
    firstRunOnlyFilename: "Raw.psr2_1.fq.gz",
    secondRunOnlyFilename: "Raw.psr2_2.fq.gz",
    idString: "6615273392eb39be25529872",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/psr2m",
    firstRunOnlyFilename: "Raw.psr2m_1.fq.gz",
    secondRunOnlyFilename: "Raw.psr2m_2.fq.gz",
    idString: "6615273392eb39be25529873",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm1507",
    firstRunOnlyFilename: "Raw.sttm1507_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm1507_2.fq.gz",
    idString: "6615273392eb39be25529874",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm1508",
    firstRunOnlyFilename: "Raw.sttm1508_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm1508_2.fq.gz",
    idString: "6615273392eb39be25529875",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm1510",
    firstRunOnlyFilename: "Raw.sttm1510_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm1510_2.fq.gz",
    idString: "6615273392eb39be25529876",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm1515",
    firstRunOnlyFilename: "Raw.sttm1515_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm1515_2.fq.gz",
    idString: "6615273392eb39be25529877",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm2109",
    firstRunOnlyFilename: "Raw.sttm2109_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm2109_2.fq.gz",
    idString: "6615273392eb39be25529878",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/sttm2118",
    firstRunOnlyFilename: "Raw.sttm2118_1.fq.gz",
    secondRunOnlyFilename: "Raw.sttm2118_2.fq.gz",
    idString: "6615273392eb39be25529879",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/w0_5h",
    firstRunOnlyFilename: "Raw.w_0_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.w_0_5h_2.fq.gz",
    idString: "6615273392eb39be2552987a",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/w12h",
    firstRunOnlyFilename: "Raw.w_12h_1.fq.gz",
    secondRunOnlyFilename: "Raw.w_12h_2.fq.gz",
    idString: "661527d792eb39be25529880",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/w1_5h",
    firstRunOnlyFilename: "Raw.w_1_5h_1.fq.gz",
    secondRunOnlyFilename: "Raw.w_1_5h_2.fq.gz",
    idString: "661527d792eb39be25529881",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/w3h",
    firstRunOnlyFilename: "Raw.w_3h_1.fq.gz",
    secondRunOnlyFilename: "Raw.w_3h_2.fq.gz",
    idString: "661527d792eb39be25529882",
  },
  {
    path: "/maw/srna_sequencing_in_soybean/w6h",
    firstRunOnlyFilename: "Raw.w_6h_1.fq.gz",
    secondRunOnlyFilename: "Raw.w_6h_2.fq.gz",
    idString: "661527d792eb39be25529883",
  },
];

// Wrap your logic in an async function
async function main() {
  // Add your for-loop and logic inside this function

  // For each of these srna in soybean sample IDs:

  for (let index = 0; index < sRnaSoybeanSampleObjs.length; index++) {
    const runNames = ["Rep1", "Rep2"];

    // for paired, have to pair 'sibling' after loop iteration

    for (let i = 0; i < runNames.length; i++) {
      // Create a run document:

      console.log("Sample object:", sRnaSoybeanSampleObjs[index]);
      console.log("Path:", sRnaSoybeanSampleObjs[index]?.path);
      console.log("runSafeName:", runSafeName);

      const runName = runNames[i];
      const runSafeName = runNames[i].toLowerCase();
      const runPath = path.join(
        sRnaSoybeanSampleObjs[index]?.path ?? "",
        runSafeName ?? ""
      );

      console.log(
        "JERRY:",
        "runName",
        runName,
        "runPath",
        runPath,
        "runSafeName",
        runSafeName
      );

      const newRunResult = await new Run({
        _id: ObjectId(),
        forceSafeName: false,
        additionalFilesUploadIDs: [],
        accessions: [],
        sample: ObjectId(sRnaSoybeanSampleObjs[index].idString),
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
        createdAt: new Date("2024-04-09T12:23:23.649Z"),
        updatedAt: new Date("2024-04-09T12:23:23.649Z"),
        __v: 0,
      }).save();

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
          ? sRnaSoybeanSampleObjs[index].firstRunOnlyFilename
          : sRnaSoybeanSampleObjs[index].secondRunOnlyFilename;

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
      const newFileResult = await new File(
        {
          _id: ObjectId(),
          name: fileName,
          type: "run",
          originalName: fileName,
          path: filePath,
          createFileDocumentId: fileDocId,
          tempUploadPath: filePath,
          uploadName: fileName,
          uploadMethod: "admin-manual",
          createdAt: new Date("2024-04-08T12:23:23.683Z"),
          updatedAt: new Date("2024-04-08T12:23:25.626Z"),
          __v: 0,
        }.save()
      );

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

      const newReadResult = await new Read({
        _id: ObjectId(),
        run: ObjectId(newRunResult._id),
        file: ObjectId(newFileResult._id),
        paired: false, // false for soybean sRNA
        createdAt: new Date("2024-04-08T12:23:23.687Z"),
        updatedAt: new Date("2024-04-08T12:23:23.714Z"),
        __v: 0,
        // sibling: ObjectId("6613e1bbe372f7554d754a84"),
      }).save();

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
    `Total Samples: ${sRnaSoybeanSampleObjs.length}\nExpecting ${
      sRnaSoybeanSampleObjs.length * 2
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
