const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const fsSync = require("fs");

// The models are mocked; lib/file-utils.js deliberately is NOT. These wrappers
// exist to carry the route handler's arguments into it, and the argument that
// matters — the authenticated caller — is the only thing standing between one
// user and another user's staged upload. Mocking file-utils here would test
// that five values are passed along and prove nothing about what they do: a
// reviewer deleted `username` from both forwarded calls and the whole suite
// stayed green, because this seam had no test at all.
jest.mock("../../models/File");
jest.mock("../../models/AdditionalFile");
jest.mock("../../models/Read");
jest.mock("../../models/Run");
jest.mock("../../lib/utils/md5");
jest.mock("../../lib/utils/hpcAudit");

const File = require("../../models/File");
const AdditionalFile = require("../../models/AdditionalFile");
const Read = require("../../models/Read");
const Run = require("../../models/Run");

const {
  sortAdditionalFiles,
  sortReadFiles,
} = require("../../lib/sortAssociatedFiles");

describe("sortAssociatedFiles", () => {
  const parentId = new mongoose.Types.ObjectId();

  // A tus upload id: 32 hex characters, which is the only shape the ownership
  // check finds a sidecar for.
  const UPLOAD_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const OWNER = "alice";

  let tmpRoot;
  let uploadDir;
  let dataRoot;
  let additionalFileSave;
  let readSave;
  const ORIGINAL_UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY;

  /**
   * Writes the sidecar the tus FileStore keeps beside a staged upload, which
   * is where the claim check reads the recorded owner from.
   */
  const stageUpload = (id = UPLOAD_ID, owner = OWNER) => {
    fsSync.writeFileSync(path.join(uploadDir, id), "ACGT");
    fsSync.writeFileSync(
      path.join(uploadDir, `${id}.json`),
      JSON.stringify({
        id,
        size: 4,
        offset: 4,
        metadata: { filename: "reads.fq", owner },
      }),
    );
    return id;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tmpRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "komondor-sort-"));
    uploadDir = path.join(tmpRoot, "uploads");
    dataRoot = path.join(tmpRoot, "datastore");
    fsSync.mkdirSync(uploadDir, { recursive: true });
    fsSync.mkdirSync(dataRoot, { recursive: true });
    process.env.UPLOAD_DIRECTORY = uploadDir;
    process.env.DATASTORE_ROOT = dataRoot;

    stageUpload();

    File.mockImplementation((data) => ({
      save: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        originalName: data.originalName,
        path: data.path,
        // The bytes themselves are not the subject here; only who is allowed
        // to ask for them to be taken.
        moveToFolderAndSave: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockResolvedValue({}),
      }),
    }));

    additionalFileSave = jest.fn().mockResolvedValue({});
    AdditionalFile.mockImplementation(() => ({ save: additionalFileSave }));

    readSave = jest
      .fn()
      .mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    Read.mockImplementation(() => ({ save: readSave }));

    Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    Run.findById = jest.fn().mockResolvedValue({
      getRelativePath: jest.fn().mockResolvedValue("/group/project/run"),
    });

    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fsSync.rmSync(tmpRoot, { recursive: true, force: true });
    if (ORIGINAL_UPLOAD_DIRECTORY === undefined) {
      delete process.env.UPLOAD_DIRECTORY;
    } else {
      process.env.UPLOAD_DIRECTORY = ORIGINAL_UPLOAD_DIRECTORY;
    }
  });

  describe("sortAdditionalFiles", () => {
    const additionalFiles = () => [
      { name: "notes.txt", uploadName: UPLOAD_ID, md5: "abc123" },
    ];

    const sort = (username) =>
      sortAdditionalFiles(
        additionalFiles(),
        "sample",
        parentId,
        "/group/project/sample",
        username,
      );

    it("lets the user who staged an upload claim it", async () => {
      await expect(sort(OWNER)).resolves.toBeUndefined();

      expect(additionalFileSave).toHaveBeenCalled();
    });

    it("refuses a claim on an upload staged by somebody else", async () => {
      await expect(sort("bob")).rejects.toThrow(/does not belong to 'bob'/);

      expect(additionalFileSave).not.toHaveBeenCalled();
    });

    it("refuses a claim when no caller was carried through at all", async () => {
      // Which is what an unauthenticated route, or a dropped argument, looks
      // like from here: it fails closed rather than claiming for 'undefined'.
      await expect(sort(undefined)).rejects.toThrow(/does not belong to/);

      expect(additionalFileSave).not.toHaveBeenCalled();
    });

    it("logs the failure before re-throwing it to the route", async () => {
      await sort("bob").catch(() => {});

      expect(console.error).toHaveBeenCalledWith(
        "Error sorting additional files:",
        expect.any(Error),
      );
    });
  });

  describe("sortReadFiles", () => {
    const readFiles = () => [
      { name: "reads_R1.fq", uploadName: UPLOAD_ID, paired: false },
    ];

    const sort = (username) =>
      sortReadFiles(
        readFiles(),
        parentId,
        "/group/project/run",
        { method: "local-filesystem" },
        username,
      );

    it("lets the user who staged an upload claim it", async () => {
      await expect(sort(OWNER)).resolves.toBeUndefined();

      expect(readSave).toHaveBeenCalled();
    });

    it("refuses a claim on an upload staged by somebody else", async () => {
      await expect(sort("bob")).rejects.toThrow(/does not belong to 'bob'/);

      expect(readSave).not.toHaveBeenCalled();
    });

    it("refuses a claim when no caller was carried through at all", async () => {
      await expect(sort(undefined)).rejects.toThrow(/does not belong to/);

      expect(readSave).not.toHaveBeenCalled();
    });

    it("marks the run errored when the claim is refused", async () => {
      await sort("bob").catch(() => {});

      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(
        parentId,
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "error",
            statusError: expect.stringContaining("does not belong to"),
          }),
        }),
      );
    });

    it("logs the failure before re-throwing it to the route", async () => {
      await sort("bob").catch(() => {});

      expect(console.error).toHaveBeenCalledWith(
        "Error sorting read files:",
        expect.any(Error),
      );
    });
  });
});
