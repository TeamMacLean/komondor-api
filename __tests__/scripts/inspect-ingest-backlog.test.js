/**
 * The deployment inspector must use the route's validator, not a copied
 * approximation. A previous implementation exited 0 for every malformed
 * shape below while POST /runs/new rejected the same payloads.
 */

const inspector = require("../../scripts/inspect-ingest-backlog");
const validation = require("../../lib/ingest-payload-validation");

const uploadId = "1".repeat(32);
const validEntry = { name: "reads.fq", uploadName: uploadId };
const localInfo = { method: "local-filesystem" };

describe("ingest backlog validation", () => {
  test("exports the exact validator used by the HTTP route", () => {
    expect(inspector.validateIngestFilesPayload).toBe(
      validation.validateIngestFilesPayload,
    );
    expect(inspector.validateRawFilesForLibraryType).toBe(
      validation.validateRawFilesForLibraryType,
    );
  });

  test.each([
    ["non-array rawFiles", { rawFiles: {}, rawFilesUploadInfo: localInfo }],
    ["missing name", { rawFiles: [{}], rawFilesUploadInfo: localInfo }],
    [
      "missing uploadName",
      { rawFiles: [{ name: "reads.fq" }], rawFilesUploadInfo: localInfo },
    ],
    [
      "non-string md5",
      {
        rawFiles: [{ ...validEntry, md5: 7 }],
        rawFilesUploadInfo: localInfo,
      },
    ],
    [
      "non-boolean paired",
      {
        rawFiles: [{ ...validEntry, paired: "yes" }],
        rawFilesUploadInfo: localInfo,
      },
    ],
    ["missing method", { rawFiles: [validEntry] }],
    [
      "invalid method",
      {
        rawFiles: [validEntry],
        rawFilesUploadInfo: { method: "teleport" },
      },
    ],
  ])("flags %s", (_, payload) => {
    expect(inspector.validateIngestFilesPayload(payload)).not.toEqual([]);
  });

  test("accepts a valid stored local-filesystem payload", () => {
    expect(
      inspector.validateIngestFilesPayload({
        rawFiles: [validEntry],
        rawFilesUploadInfo: localInfo,
      }),
    ).toEqual([]);
  });
});

describe("ingest backlog Run and LibraryType validation", () => {
  const run = { _id: "run-1", libraryType: "FASTQ - Single" };
  const unpaired = {
    value: "FASTQ - Single",
    paired: false,
    indexed: false,
  };
  const job = (rawFiles = [validEntry]) => ({
    _id: "job-1",
    runId: run._id,
    payload: { rawFiles, rawFilesUploadInfo: localInfo },
  });

  test("accepts a structurally and semantically valid stored job", () => {
    expect(inspector.validateStoredJob(job(), run, unpaired)).toEqual([]);
  });

  test("flags a job whose referenced Run no longer exists", () => {
    expect(inspector.validateStoredJob(job(), null, null)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Run run-1.*does not exist/i),
      ]),
    );
  });

  test("flags a Run whose LibraryType option was renamed or deleted", () => {
    expect(inspector.validateStoredJob(job(), run, null)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/LibraryType "FASTQ - Single".*does not exist/i),
      ]),
    );
  });

  test("matches the worker's Mongoose cast for a numeric paired flag", () => {
    expect(
      inspector.validateStoredJob(job(), run, {
        value: run.libraryType,
        paired: 1,
        indexed: 0,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/paired library requires/i),
      ]),
    );
  });

  test("matches the worker's Mongoose cast for a string indexed flag", () => {
    expect(
      inspector.validateStoredJob(job(), run, {
        value: run.libraryType,
        paired: "false",
        indexed: "true",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/requires at least one indexed/i),
      ]),
    );
  });

  test("flags duplicate exact-value LibraryType documents as ambiguous", () => {
    expect(
      inspector.validateStoredJob(job(), run, null, { libraryTypeCount: 2 }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ambiguous LibraryType.*2 option documents/i),
      ]),
    );
  });

  test("flags a paired Run whose stored reads have no sibling links", () => {
    expect(
      inspector.validateStoredJob(job(), run, {
        value: run.libraryType,
        paired: true,
        indexed: false,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/paired library requires/i),
      ]),
    );
  });

  test("reports a malformed null entry instead of crashing semantic validation", () => {
    expect(inspector.validateStoredJob(job([null]), run, unpaired)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Raw file at index 0/i)]),
    );
  });

  test("flags an indexed Run whose stored payload has no index read", () => {
    const reads = [
      {
        name: "R1.fq",
        uploadName: "1".repeat(32),
        sibling: "R2.fq",
        paired: true,
      },
      {
        name: "R2.fq",
        uploadName: "2".repeat(32),
        sibling: "R1.fq",
        paired: true,
      },
    ];

    expect(
      inspector.validateStoredJob(job(reads), run, {
        value: run.libraryType,
        paired: true,
        indexed: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/requires at least one indexed/i),
      ]),
    );
  });
});
