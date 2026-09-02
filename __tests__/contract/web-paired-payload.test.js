/**
 * The exact paired-upload payload komondor-web serialises, run against the
 * real POST /runs/new validation.
 *
 * This exists because of the most expensive mistake in this codebase's audit
 * history. The API required `rowID` on every paired local-filesystem entry and
 * paired those reads by rowID — a contract **nothing has ever sent**:
 *
 *   - komondor-web builds a sibling map and emits `sibling` + `paired: true`
 *     for BOTH sources (components/uploads/FileProcessor.vue confirmSelection).
 *   - komondor-power emits `sibling`, derived from read_siblingFullHpcPath.
 *   - The only `rowID` in either sibling repo is commented-out web code.
 *
 * The result was a silent failure that a later "fix" turned into a loud one:
 * first every paired local upload landed UNPAIRED (siblingLinks ignored
 * `sibling` unless the method was hpc-mv), and then validation started
 * refusing the real client's ordinary payload with
 * `400 ... is paired but missing rowID`.
 *
 * Every API test of that path invented a rowID, so the whole suite agreed with
 * the code about a contract the actual client never spoke. A test that builds
 * its own fixture cannot catch this; only one pinned to what the client
 * genuinely sends can. Keep this fixture byte-shaped like the web's output —
 * if komondor-web's serialisation changes, this must change with it, and the
 * mirror test in that repo (tests/components/FileProcessor.test.js) asserts
 * the same shape from the other side.
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../lib/ingest-queue", () => ({
  enqueueRunIngest: jest.fn().mockResolvedValue({ _id: "job-1" }),
  deliveredFileNames: jest
    .fn()
    .mockResolvedValue({ raw: new Set(), additional: new Set() }),
  idempotencyKeyFor: jest.fn((runId) => `run-ingest:${String(runId)}`),
  IngestJob: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../../models/Run");
jest.mock("../../models/Sample");
jest.mock("../../lib/utils/groupAccess", () => ({
  canReadGroup: jest.fn().mockResolvedValue(true),
  canWriteGroup: jest.fn().mockResolvedValue(true),
  groupsICanRead: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../lib/utils/fullAccessUsers", () => ({
  visibleGroupIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "scientist", _id: "u1" };
    next();
  },
}));

const Run = require("../../models/Run");
const Sample = require("../../models/Sample");
const runsRouter = require("../../routes/runs");

const SAMPLE_ID = "a".repeat(24);
const GROUP_ID = "b".repeat(24);

/** The non-file metadata komondor-web sends alongside, so that the file
 *  validation is what these tests are actually exercising. */
const runMetadata = () => ({
  name: "Run 1",
  sample: SAMPLE_ID,
  group: GROUP_ID,
  owner: "scientist",
  sequencingProvider: "Provider",
  sequencingTechnology: "Illumina",
  librarySource: "GENOMIC",
  libraryType: "PAIRED",
  librarySelection: "RANDOM",
  libraryStrategy: "WGS",
});

const app = express();
app.use(express.json());
app.use(runsRouter);

/**
 * The two-file paired local-filesystem payload komondor-web emits, field for
 * field. `data` and `uploadName` come from the Uppy upload; `md5` and
 * `calculatedMd5` are null when the user typed no checksum; `sibling` is
 * reciprocal and `paired` is true. There is deliberately no rowID.
 */
const webPairedRawFiles = () => [
  {
    name: "SampleA_R1.fastq.gz",
    md5: null,
    calculatedMd5: null,
    data: {},
    uploadName: "1".repeat(32),
    sibling: "SampleA_R2.fastq.gz",
    paired: true,
  },
  {
    name: "SampleA_R2.fastq.gz",
    md5: null,
    calculatedMd5: null,
    data: {},
    uploadName: "2".repeat(32),
    sibling: "SampleA_R1.fastq.gz",
    paired: true,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  Sample.findById = jest.fn().mockResolvedValue({
    _id: SAMPLE_ID,
    group: GROUP_ID,
  });
  Run.findOne = jest.fn().mockReturnValue({
    populate: jest.fn().mockResolvedValue(null),
  });
  Run.mockImplementation(() => ({
    save: jest.fn().mockResolvedValue({ _id: "c".repeat(24), name: "Run 1" }),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the payload komondor-web actually sends", () => {
  test("a paired local-filesystem upload is accepted", async () => {
    const response = await request(app)
      .post("/runs/new")
      .send({
        ...runMetadata(),
        rawFiles: webPairedRawFiles(),
        rawFilesUploadInfo: { method: "local-filesystem" },
      });

    // Asserted as "not a validation refusal" rather than 201: this file
    // mocks the models thinly on purpose, and what is under test is whether
    // the real payload SURVIVES validation, not whether a fully-mocked Run
    // saves. A 400 here is the bug; anything past validation is not.
    expect(response.status).not.toBe(400);
  });

  test("the fixture carries no rowID, which is the whole point", () => {
    // If someone "fixes" a future failure here by adding a rowID, the test
    // stops testing the client and starts testing the invention again.
    webPairedRawFiles().forEach((file) => {
      expect(file.rowID).toBeUndefined();
      expect(file.paired).toBe(true);
      expect(typeof file.sibling).toBe("string");
    });
  });

  test("the worker pairs it, rather than landing it unpaired", () => {
    // The other half of the same bug: validation accepting the payload is
    // worthless if siblingLinks then ignores `sibling` for this method and
    // the run finishes "complete" with sibling:null on both Reads.
    // requireActual: this file mocks the queue for the HTTP tests above, and
    // the real pairing rule is exactly what needs checking here.
    const { siblingLinks } = jest.requireActual("../../lib/ingest-queue");

    const links = siblingLinks(webPairedRawFiles(), "local-filesystem");

    expect(links).toEqual(
      expect.arrayContaining([
        ["SampleA_R1.fastq.gz", "SampleA_R2.fastq.gz"],
        ["SampleA_R2.fastq.gz", "SampleA_R1.fastq.gz"],
      ]),
    );
    expect(links).toHaveLength(2);
  });

  test("an unpaired single-file upload is still accepted", async () => {
    // The web emits `paired: false` with no sibling when the user did not
    // pair the selection.
    const response = await request(app)
      .post("/runs/new")
      .send({
        ...runMetadata(),
        rawFiles: [
          {
            name: "SampleA.fastq.gz",
            md5: null,
            calculatedMd5: null,
            data: {},
            uploadName: "3".repeat(32),
            paired: false,
          },
        ],
        rawFilesUploadInfo: { method: "local-filesystem" },
      });

    expect(response.status).not.toBe(400);
  });
});
