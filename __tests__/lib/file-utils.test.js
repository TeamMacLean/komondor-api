const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

// Mock all dependencies before requiring the module under test
jest.mock("../../models/File");
jest.mock("../../models/AdditionalFile");
jest.mock("../../models/Read");
jest.mock("../../models/Run");
jest.mock("../../lib/utils/md5");

const File = require("../../models/File");
const AdditionalFile = require("../../models/AdditionalFile");
const Read = require("../../models/Read");
const Run = require("../../models/Run");
const { calculateFileMd5 } = require("../../lib/utils/md5");

const {
  ensureDirectoryExists,
  processAdditionalFiles,
  processReadFiles,
} = require("../../lib/file-utils");

describe("file-utils", () => {
  const mockObjectId = new mongoose.Types.ObjectId();
  let tmpRoot;
  let hpcRoot;
  let outsideDir;
  // Where local-filesystem uploads are staged. Every module involved now reads
  // lib/utils/uploadPath.js per call rather than at load, so the tests can put
  // it in a scratch directory instead of writing into the repository's files/.
  let uploadDir;
  const ORIGINAL_UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY;

  // A tus upload id: 32 hex characters. Real uploadNames look like this, and
  // the ownership check only finds a sidecar for a name shaped this way.
  const UPLOAD_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const OWNER = "alice";

  /**
   * The document File.save() resolves to.
   *
   * processAdditionalFiles and processSingleReadFile now move the bytes
   * themselves — before the AdditionalFile/Read row exists, so the row cannot
   * outlive a failed move — which means the saved File has to carry both the
   * originalName the destination is built from and moveToFolderAndSave.
   *
   * @param {object} data - What the File constructor was handed.
   * @returns {object} A stub saved File.
   */
  const savedFileStub = (data) => ({
    _id: new mongoose.Types.ObjectId(),
    originalName: data && data.originalName,
    moveToFolderAndSave: jest.fn().mockResolvedValue(undefined),
  });

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
    // The upload roots are now resolved against the real filesystem — a path
    // that escapes them is refused — so they have to be real directories
    // rather than the plausible-looking strings these tests used before.
    tmpRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "komondor-fu-"));
    hpcRoot = path.join(tmpRoot, "hpc-transfer");
    outsideDir = path.join(tmpRoot, "outside");
    uploadDir = path.join(tmpRoot, "uploads");
    fsSync.mkdirSync(hpcRoot, { recursive: true });
    fsSync.mkdirSync(outsideDir, { recursive: true });
    fsSync.mkdirSync(uploadDir, { recursive: true });
    process.env.UPLOAD_DIRECTORY = uploadDir;

    // Set required environment variables
    process.env.DATASTORE_ROOT = "/mnt/reads";
    process.env.HPC_TRANSFER_DIRECTORY = hpcRoot;
  });

  afterEach(() => {
    fsSync.rmSync(tmpRoot, { recursive: true, force: true });
    if (ORIGINAL_UPLOAD_DIRECTORY === undefined) {
      delete process.env.UPLOAD_DIRECTORY;
    } else {
      process.env.UPLOAD_DIRECTORY = ORIGINAL_UPLOAD_DIRECTORY;
    }
  });

  describe("processAdditionalFiles", () => {
    it("should use lowercase md5 field from file object", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const expectedMd5 = "abc123def456";

      // Mock File.save()
      File.mockImplementation((data) => ({
        save: jest
          .fn()
          .mockResolvedValue({ ...savedFileStub(data), _id: mockFileId }),
      }));

      // Mock AdditionalFile.save()
      const mockAdditionalFileSave = jest.fn().mockResolvedValue({});
      AdditionalFile.mockImplementation((data) => {
        // Capture the data passed to AdditionalFile constructor
        mockAdditionalFileSave.constructorData = data;
        return { save: mockAdditionalFileSave };
      });

      // Mock fs.access to simulate directory exists
      jest.spyOn(fs, "access").mockResolvedValue(undefined);

      stageUpload();

      const additionalFiles = [
        {
          name: "test-file.txt",
          uploadName: UPLOAD_ID, // Required for local-filesystem
          md5: expectedMd5, // lowercase md5 - this is what frontend sends
          uploadMethod: "local-filesystem",
        },
      ];

      await processAdditionalFiles(
        additionalFiles,
        "sample",
        mockObjectId,
        "/test/path",
        OWNER,
      );

      // Verify AdditionalFile was created with the correct MD5 value
      expect(mockAdditionalFileSave.constructorData).toHaveProperty(
        "MD5",
        expectedMd5,
      );
    });

    it("should NOT use uppercase MD5 field (regression test for bug fix)", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const lowercaseMd5 = "correct-md5-value";

      File.mockImplementation((data) => ({
        save: jest
          .fn()
          .mockResolvedValue({ ...savedFileStub(data), _id: mockFileId }),
      }));

      const mockAdditionalFileSave = jest.fn().mockResolvedValue({});
      AdditionalFile.mockImplementation((data) => {
        mockAdditionalFileSave.constructorData = data;
        return { save: mockAdditionalFileSave };
      });

      jest.spyOn(fs, "access").mockResolvedValue(undefined);

      // File has both uppercase MD5 (wrong) and lowercase md5 (correct)
      // This simulates what could happen if someone mistakenly adds both
      stageUpload();

      const additionalFiles = [
        {
          name: "test-file.txt",
          uploadName: UPLOAD_ID, // Required for local-filesystem
          MD5: "wrong-uppercase-value", // This should be ignored
          md5: lowercaseMd5, // This should be used
          uploadMethod: "local-filesystem",
        },
      ];

      await processAdditionalFiles(
        additionalFiles,
        "sample",
        mockObjectId,
        "/test/path",
        OWNER,
      );

      // Should use lowercase md5, not uppercase MD5
      expect(mockAdditionalFileSave.constructorData.MD5).toBe(lowercaseMd5);
      expect(mockAdditionalFileSave.constructorData.MD5).not.toBe(
        "wrong-uppercase-value",
      );
    });
  });

  describe("processReadFiles", () => {
    beforeEach(() => {
      // Mock Run.findByIdAndUpdate
      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // Mock Run.findById (needed for cached relative path computation)
      Run.findById = jest.fn().mockResolvedValue({
        getRelativePath: jest.fn().mockResolvedValue("/test/run/path"),
      });

      // Mock fs.access
      jest.spyOn(fs, "access").mockResolvedValue(undefined);
    });

    it("should use lowercase md5 field for HPC uploads", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();
      const expectedMd5 = "cc255813ff94ea304d9a49acbfc7db35";

      // Mock File
      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      // Track what data is passed to Read constructor
      let readConstructorData;
      Read.mockImplementation((data) => {
        readConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue({ _id: mockReadId }),
        };
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // Mock MD5 calculation to return matching checksum
      calculateFileMd5.mockResolvedValue(expectedMd5);

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          md5: expectedMd5, // lowercase - what frontend sends
          relativePath: "WGS_Test/01.RawData",
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "hpc-mv",
        relativePath: "WGS_Test/01.RawData",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // Verify Read was created with correct MD5 from lowercase field
      expect(readConstructorData).toHaveProperty("MD5", expectedMd5);

      // Verify run status was set to 'complete' (files moved, MD5 deferred)
      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(mockObjectId, {
        $set: { status: "complete" },
      });

      // Verify MD5 calculation was NOT called (deferred to background)
      expect(calculateFileMd5).not.toHaveBeenCalled();
    });

    it("should complete successfully without MD5 verification (deferred)", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();
      const originalMd5 = "original-md5-hash";

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      Read.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({ _id: mockReadId }),
      }));
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          md5: originalMd5,
          relativePath: "WGS_Test/01.RawData",
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "hpc-mv",
        relativePath: "WGS_Test/01.RawData",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // Verify Read was NOT updated with MD5 info (deferred to background)
      expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();

      // Verify MD5 calculation was NOT performed
      expect(calculateFileMd5).not.toHaveBeenCalled();

      // Verify run status was set to 'complete' (not error)
      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(mockObjectId, {
        $set: { status: "complete" },
      });
    });

    it("should NOT use uppercase MD5 field for HPC uploads (regression test)", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();
      const correctMd5 = "correct-lowercase-md5";
      const wrongMd5 = "wrong-uppercase-md5";

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      let readConstructorData;
      Read.mockImplementation((data) => {
        readConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue({ _id: mockReadId }),
        };
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // Return matching MD5 so we can verify the correct one was used
      calculateFileMd5.mockResolvedValue(correctMd5);

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          MD5: wrongMd5, // uppercase - should be IGNORED
          md5: correctMd5, // lowercase - should be USED
          relativePath: "WGS_Test/01.RawData",
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "hpc-mv",
        relativePath: "WGS_Test/01.RawData",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // Verify the lowercase md5 was used, not uppercase MD5
      expect(readConstructorData.MD5).toBe(correctMd5);
      expect(readConstructorData.MD5).not.toBe(wrongMd5);

      // Run should be complete (MD5 verification deferred)
      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(mockObjectId, {
        $set: { status: "complete" },
      });

      // MD5 calculation should NOT happen (deferred)
      expect(calculateFileMd5).not.toHaveBeenCalled();
    });

    it("should handle undefined md5 gracefully (stored as undefined)", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      let readConstructorData;
      Read.mockImplementation((data) => {
        readConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue({ _id: mockReadId }),
        };
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // File with no md5 field at all
      const readFiles = [
        {
          name: "test_R1.fq.gz",
          // no md5 field!
          relativePath: "WGS_Test/01.RawData",
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "hpc-mv",
        relativePath: "WGS_Test/01.RawData",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // MD5 in Read should be undefined
      expect(readConstructorData.MD5).toBeUndefined();

      // MD5 verification is deferred, so no update should happen
      expect(Read.findByIdAndUpdate).not.toHaveBeenCalled();

      // MD5 calculation should NOT happen (deferred)
      expect(calculateFileMd5).not.toHaveBeenCalled();

      // Run should be complete (MD5 verification will happen in background)
      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(mockObjectId, {
        $set: { status: "complete" },
      });
    });

    it("should normalize uppercase MD5 input to lowercase", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();
      const uppercaseMd5 = "CC255813FF94EA304D9A49ACBFC7DB35";
      const lowercaseMd5 = "cc255813ff94ea304d9a49acbfc7db35";

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      let readConstructorData;
      Read.mockImplementation((data) => {
        readConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue({ _id: mockReadId }),
        };
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      // calculateFileMd5 returns lowercase
      calculateFileMd5.mockResolvedValue(lowercaseMd5);

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          md5: uppercaseMd5, // Input is UPPERCASE
          relativePath: "WGS_Test/01.RawData",
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "hpc-mv",
        relativePath: "WGS_Test/01.RawData",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // Should be normalized to lowercase
      expect(readConstructorData.MD5).toBe(lowercaseMd5);

      // Should match (both lowercase now) - run status complete
      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(mockObjectId, {
        $set: { status: "complete" },
      });
    });

    it("should use lowercase md5 for local-filesystem uploads too", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const mockReadId = new mongoose.Types.ObjectId();
      const expectedMd5 = "local-file-md5-hash";

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({
          _id: mockFileId,
          originalName: "test_R1.fq.gz",
          moveToFolderAndSave: jest.fn().mockResolvedValue({}),
        }),
      }));

      let readConstructorData;
      Read.mockImplementation((data) => {
        readConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue({ _id: mockReadId }),
        };
      });
      Read.findByIdAndUpdate = jest.fn().mockResolvedValue({});

      calculateFileMd5.mockResolvedValue(expectedMd5);

      stageUpload();

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          uploadName: UPLOAD_ID,
          md5: expectedMd5,
          paired: false,
        },
      ];

      const uploadInfo = {
        method: "local-filesystem",
      };

      await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
        OWNER,
      );

      // Should use lowercase md5 for local uploads as well
      expect(readConstructorData.MD5).toBe(expectedMd5);
    });
  });

  describe("the row is written only after the bytes have moved", () => {
    // The defect this ordering closes: the Read/AdditionalFile row used to be
    // saved BEFORE the file was moved, so a move that failed (ENOSPC, EROFS,
    // the no-clobber EEXIST) left a row asserting the file had arrived when it
    // was still sitting in staging. Everything downstream — the ingest queue's
    // completion check, MD5 verification, the frontend's file list — reads a
    // row as proof of delivery.
    let move;

    beforeEach(() => {
      move = jest.fn().mockResolvedValue(undefined);
      File.mockImplementation((data) => ({
        save: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(),
          originalName: data.originalName,
          moveToFolderAndSave: move,
        }),
      }));
      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Run.findById = jest.fn().mockResolvedValue({
        getRelativePath: jest.fn().mockResolvedValue("/test/run/path"),
      });
      jest.spyOn(fs, "access").mockResolvedValue(undefined);
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    describe("read files", () => {
      const readFile = {
        name: "reads_R1.fq",
        uploadName: UPLOAD_ID,
        paired: false,
      };

      const runReads = () =>
        processReadFiles(
          [readFile],
          mockObjectId,
          "/test/path",
          { method: "local-filesystem" },
          OWNER,
        );

      it("moves the file before it saves the Read", async () => {
        stageUpload();
        const save = jest
          .fn()
          .mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
        Read.mockImplementation(() => ({ save }));

        await runReads();

        expect(move).toHaveBeenCalled();
        expect(move.mock.invocationCallOrder[0]).toBeLessThan(
          save.mock.invocationCallOrder[0],
        );
      });

      it("writes no Read at all when the move fails", async () => {
        stageUpload();
        move.mockRejectedValue(new Error("ENOSPC: no space left on device"));
        const save = jest.fn().mockResolvedValue({});
        Read.mockImplementation(() => ({ save }));

        await expect(runReads()).rejects.toThrow(/no space left on device/);

        expect(save).not.toHaveBeenCalled();
      });

      it("marks the run errored when the move fails", async () => {
        stageUpload();
        move.mockRejectedValue(new Error("EEXIST: destination already exists"));
        Read.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({}),
        }));

        await expect(runReads()).rejects.toThrow();

        expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(
          mockObjectId,
          expect.objectContaining({
            $set: expect.objectContaining({ status: "error" }),
          }),
        );
      });

      it("skips the Read model's own post-save move", async () => {
        stageUpload();
        let readData;
        Read.mockImplementation((data) => {
          readData = data;
          return {
            save: jest
              .fn()
              .mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
          };
        });

        await runReads();

        // Without this the file would be moved a second time, from a source
        // that is no longer there.
        expect(readData.skipPostSave).toBe(true);
        expect(move).toHaveBeenCalledTimes(1);
      });
    });

    describe("additional files", () => {
      const runAdditional = () =>
        processAdditionalFiles(
          [{ name: "notes.txt", uploadName: UPLOAD_ID }],
          "sample",
          mockObjectId,
          "/test/path",
          OWNER,
        );

      it("moves the file before it saves the AdditionalFile", async () => {
        stageUpload();
        const save = jest.fn().mockResolvedValue({});
        AdditionalFile.mockImplementation(() => ({ save }));

        await runAdditional();

        expect(move).toHaveBeenCalled();
        expect(move.mock.invocationCallOrder[0]).toBeLessThan(
          save.mock.invocationCallOrder[0],
        );
      });

      it("moves it to the parent's additional/ directory", async () => {
        stageUpload();
        AdditionalFile.mockImplementation(() => ({
          save: jest.fn().mockResolvedValue({}),
        }));

        await runAdditional();

        expect(move).toHaveBeenCalledWith(
          path.join("/test/path", "additional", "notes.txt"),
        );
      });

      it("writes no AdditionalFile at all when the move fails", async () => {
        stageUpload();
        move.mockRejectedValue(new Error("EROFS: read-only file system"));
        const save = jest.fn().mockResolvedValue({});
        AdditionalFile.mockImplementation(() => ({ save }));

        await expect(runAdditional()).rejects.toThrow(/read-only file system/);

        expect(save).not.toHaveBeenCalled();
      });

      it("skips the AdditionalFile model's own post-save move", async () => {
        stageUpload();
        let additionalData;
        AdditionalFile.mockImplementation((data) => {
          additionalData = data;
          return { save: jest.fn().mockResolvedValue({}) };
        });

        await runAdditional();

        expect(additionalData.skipPostSave).toBe(true);
        expect(move).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("createFileDocument — path containment", () => {
    // Exercised through processAdditionalFiles, which is the shortest route to
    // it. Every value here arrives in a request body.
    let fileConstructorData;

    /** Runs one file through the pipeline and returns the promise. */
    const process1 = (file, username = OWNER) =>
      processAdditionalFiles(
        [file],
        "sample",
        mockObjectId,
        "/test/path",
        username,
      );

    beforeEach(() => {
      fileConstructorData = null;
      File.mockImplementation((data) => {
        fileConstructorData = data;
        return {
          save: jest.fn().mockResolvedValue(savedFileStub(data)),
        };
      });
      AdditionalFile.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));
      jest.spyOn(fs, "access").mockResolvedValue(undefined);
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    describe("hpc-mv uploads", () => {
      const hpcFile = (overrides) => ({
        name: "reads.fq",
        relativePath: "WGS_Test/01.RawData",
        uploadMethod: "hpc-mv",
        ...overrides,
      });

      test("resolves an ordinary upload inside the transfer directory", async () => {
        await process1(hpcFile());

        expect(fileConstructorData.path).toBe(
          path.join(hpcRoot, "WGS_Test", "01.RawData", "reads.fq"),
        );
      });

      test("still accepts a relativePath with a leading slash", async () => {
        // path.join() always treated it as relative, and real uploads send it
        // that way — rejecting it now would break every HPC transfer.
        await process1(hpcFile({ relativePath: "/WGS_Test/01.RawData" }));

        expect(fileConstructorData.path).toBe(
          path.join(hpcRoot, "WGS_Test", "01.RawData", "reads.fq"),
        );
      });

      test("refuses a relativePath that traverses out of the transfer directory", async () => {
        await expect(
          process1(hpcFile({ relativePath: "../../etc" })),
        ).rejects.toThrow(/'relativePath' is not a valid file path/);
      });

      test("treats an absolute relativePath as transfer-relative, not an override", async () => {
        // The leading slash is stripped rather than honoured, so the upload
        // cannot be redirected to /etc/cron.d.
        await process1(hpcFile({ relativePath: "/etc/cron.d" }));

        expect(fileConstructorData.path).toBe(
          path.join(hpcRoot, "etc", "cron.d", "reads.fq"),
        );
      });

      test("refuses a name that traverses", async () => {
        await expect(
          process1(hpcFile({ name: "../../../etc/cron.d/payload" })),
        ).rejects.toThrow(/'name' is not a valid file path/);
      });

      test("refuses an absolute name", async () => {
        await expect(
          process1(hpcFile({ name: "/etc/passwd" })),
        ).rejects.toThrow(/'name' is not a valid file path/);
      });

      test("refuses a name using Windows separators", async () => {
        await expect(
          process1(hpcFile({ name: "..\\..\\etc\\passwd" })),
        ).rejects.toThrow(/'name' is not a valid file path/);
      });

      test("refuses a NUL byte in the name", async () => {
        await expect(
          process1(hpcFile({ name: "reads.fq\0.png" })),
        ).rejects.toThrow(/'name' is not a valid file path/);
      });

      test("refuses a NUL byte in the relativePath", async () => {
        await expect(
          process1(hpcFile({ relativePath: "WGS_Test\0/01.RawData" })),
        ).rejects.toThrow(/'relativePath' is not a valid file path/);
      });

      test("refuses a relativePath that only escapes via a symlink", async () => {
        // Lexically "<hpcRoot>/escape/reads.fq" never leaves the root.
        fsSync.symlinkSync(outsideDir, path.join(hpcRoot, "escape"));

        await expect(
          process1(hpcFile({ relativePath: "escape" })),
        ).rejects.toThrow(/'relativePath' is not a valid file path/);
      });

      test("does not echo the rejected path back to the caller", async () => {
        // createFileDocument's message is stored as the Run's statusError and
        // read back by the client.
        await expect(
          process1(hpcFile({ relativePath: "../../etc" })),
        ).rejects.toThrow(
          expect.objectContaining({
            message: expect.not.stringContaining(".."),
          }),
        );
      });

      test("logs the rejected value for the operator", async () => {
        await process1(hpcFile({ relativePath: "../../etc" })).catch(() => {});

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("relativePath"),
          "../../etc",
        );
      });

      test("blames the setting, not the filename, when the transfer directory is gone", async () => {
        // An unmounted transfer directory fails containment for a reason that
        // has nothing to do with the request.
        fsSync.rmSync(hpcRoot, { recursive: true, force: true });

        await expect(process1(hpcFile())).rejects.toThrow(
          /HPC_TRANSFER_DIRECTORY .* is not an existing directory/,
        );
      });

      test("rejects when HPC_TRANSFER_DIRECTORY is not configured", async () => {
        delete process.env.HPC_TRANSFER_DIRECTORY;

        await expect(process1(hpcFile())).rejects.toThrow(
          /HPC_TRANSFER_DIRECTORY is not configured/,
        );
      });

      test("places a file with no relativePath at the transfer root", async () => {
        // path.join(root, undefined, name) used to throw a TypeError here.
        await process1(hpcFile({ relativePath: undefined }));

        expect(fileConstructorData.path).toBe(path.join(hpcRoot, "reads.fq"));
      });
    });

    describe("local-filesystem uploads", () => {
      const localFile = (overrides) => ({
        name: "reads.fq",
        uploadName: UPLOAD_ID,
        uploadMethod: "local-filesystem",
        ...overrides,
      });

      beforeEach(() => {
        stageUpload();
      });

      test("resolves an ordinary upload inside the upload directory", async () => {
        await process1(localFile());

        expect(fileConstructorData.path).toBe(path.join(uploadDir, UPLOAD_ID));
      });

      test("refuses an uploadName that traverses", async () => {
        await expect(
          process1(localFile({ uploadName: "../../../etc/passwd" })),
        ).rejects.toThrow(/'uploadName' is not a valid file path/);
      });

      test("refuses an absolute uploadName", async () => {
        await expect(
          process1(localFile({ uploadName: "/etc/passwd" })),
        ).rejects.toThrow(/'uploadName' is not a valid file path/);
      });

      test("refuses a NUL byte in the uploadName", async () => {
        await expect(
          process1(localFile({ uploadName: "uuid-reads.fq\0.png" })),
        ).rejects.toThrow(/'uploadName' is not a valid file path/);
      });

      test("refuses a traversing originalName even when the upload itself is safe", async () => {
        // originalName is what moveToFolderAndSave builds the datastore
        // destination from, so it escapes later rather than here.
        await expect(
          process1(localFile({ name: "../../../etc/cron.d/payload" })),
        ).rejects.toThrow(/'originalName' is not a valid file path/);
      });

      test("keeps the sanitised originalName on the document", async () => {
        await process1(localFile({ name: "  reads.fq  " }));

        expect(fileConstructorData.originalName).toBe("reads.fq");
      });

      test("refuses to claim an upload belonging to somebody else", async () => {
        // quota.isUploadOwner gated the tus endpoints and /upload/cancel — the
        // ones that write bytes — but not this one, which takes them away.
        // Naming Alice's upload id here linked her file into Bob's datastore
        // and unlinked it from the staging area.
        await expect(process1(localFile(), "bob")).rejects.toThrow(
          /does not belong to 'bob'/,
        );
      });

      test("does not create a File document for somebody else's upload", async () => {
        await process1(localFile(), "bob").catch(() => {});

        expect(fileConstructorData).toBeNull();
      });

      test("refuses to claim an upload with no recorded owner", async () => {
        // Every upload the old unauthenticated mount accepted looks like this.
        fsSync.rmSync(path.join(uploadDir, `${UPLOAD_ID}.json`));

        await expect(process1(localFile())).rejects.toThrow(
          /does not belong to/,
        );
      });

      test("refuses to claim an upload id that never existed", async () => {
        // Same message as somebody else's upload, so ids cannot be probed.
        await expect(
          process1(localFile({ uploadName: "f".repeat(32) })),
        ).rejects.toThrow(/does not belong to/);
      });

      test("refuses a claim by an unauthenticated caller", async () => {
        // null rather than undefined: process1 defaults an omitted argument
        // to the owner, and this is the case where nobody is authenticated.
        await expect(process1(localFile(), null)).rejects.toThrow(
          /does not belong to/,
        );
      });

      test("does not echo the recorded owner back to the caller", async () => {
        // The message is stored as the Run's statusError and read back by the
        // client, so it must not tell Bob whose upload he just guessed at.
        await expect(process1(localFile(), "bob")).rejects.toThrow(
          expect.objectContaining({
            message: expect.not.stringContaining(OWNER),
          }),
        );
      });

      test("leaves an hpc-mv upload alone, which has no staged upload to own", async () => {
        // hpc-mv files are moved into the transfer directory out of band;
        // there is no tus upload behind them to check an owner against.
        fsSync.writeFileSync(path.join(hpcRoot, "reads.fq"), "ACGT");

        await process1(
          {
            name: "reads.fq",
            relativePath: "",
            uploadMethod: "hpc-mv",
          },
          "bob",
        );

        expect(fileConstructorData.path).toBe(path.join(hpcRoot, "reads.fq"));
      });

      test("still reports genuinely missing properties", async () => {
        await expect(
          process1(localFile({ uploadName: undefined })),
        ).rejects.toThrow(/missing properties: name/);
      });
    });
  });

  describe("ensureDirectoryExists", () => {
    it("should not throw if directory exists", async () => {
      jest.spyOn(fs, "access").mockResolvedValue(undefined);

      await expect(
        ensureDirectoryExists("/existing/directory"),
      ).resolves.not.toThrow();
    });

    it("should create directory if it does not exist", async () => {
      const mkdirSpy = jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      jest.spyOn(fs, "access").mockRejectedValue({ code: "ENOENT" });

      await ensureDirectoryExists("/new/directory");

      expect(mkdirSpy).toHaveBeenCalledWith("/new/directory", {
        recursive: true,
      });
    });

    it("should throw on non-ENOENT errors", async () => {
      const permissionError = new Error("Permission denied");
      permissionError.code = "EACCES";
      jest.spyOn(fs, "access").mockRejectedValue(permissionError);

      await expect(ensureDirectoryExists("/no/access")).rejects.toThrow(
        "Permission denied",
      );
    });
  });
});
