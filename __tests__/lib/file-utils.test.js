const mongoose = require("mongoose");
const crypto = require("crypto");
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
// Mocked so the claim trail can be asserted as records rather than as a log
// line whose formatting belongs to lib/utils/hpcAudit.js.
jest.mock("../../lib/utils/hpcAudit");

const File = require("../../models/File");
const AdditionalFile = require("../../models/AdditionalFile");
const Read = require("../../models/Read");
const Run = require("../../models/Run");
const { calculateFileMd5 } = require("../../lib/utils/md5");
// The unmocked hasher, for the one test whose subject is what the *open*
// does rather than what file-utils does with the digest: adoption hashes the
// destination by path, and O_NOFOLLOW is what stops a symlink there being
// adopted as the real bytes.
const { calculateFileMd5: realCalculateFileMd5 } = jest.requireActual(
  "../../lib/utils/md5",
);
const { auditHpcAccess } = require("../../lib/utils/hpcAudit");

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

      const pairingInfo = await processReadFiles(
        readFiles,
        mockObjectId,
        "/test/run/path",
        uploadInfo,
      );

      // Verify Read was created with correct MD5 from lowercase field
      expect(readConstructorData).toHaveProperty("MD5", expectedMd5);

      // Verify run status was set to 'processing' while the move ran.
      // "complete" is no longer written here — lib/ingest-queue.js's
      // finaliseReadStage writes it, once pairing across a retry's old and
      // new reads is resolved, from the pairingInfo this call returns.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockObjectId, {
        $set: { status: "processing", md5VerificationStatus: "pending" },
      });
      expect(pairingInfo).toEqual([
        expect.objectContaining({
          readId: mockReadId,
          fileName: "test_R1.fq.gz",
        }),
      ]);

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

      // Run status was set to 'processing' (not error); "complete" is now
      // written by the caller — see the first test in this block.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockObjectId, {
        $set: { status: "processing", md5VerificationStatus: "pending" },
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

      // Run set to 'processing'; "complete" is written by the caller.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockObjectId, {
        $set: { status: "processing", md5VerificationStatus: "pending" },
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

      // Run set to 'processing'; "complete" is written by the caller.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockObjectId, {
        $set: { status: "processing", md5VerificationStatus: "pending" },
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

      // Run set to 'processing'; "complete" is written by the caller.
      expect(Run.findByIdAndUpdate).toHaveBeenCalledWith(mockObjectId, {
        $set: { status: "processing", md5VerificationStatus: "pending" },
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

      describe("skipping the AdditionalFile model's own post-save move", () => {
        // The flag was a no-op. models/AdditionalFile.js had no such schema
        // path and no such guard — only `if (!doc.wasNew) return`, and the row
        // is brand new — so Mongoose dropped the property and the legacy hook
        // moved every additional file a second time, from a staging source
        // that was no longer there, then swallowed the failure.
        //
        // The test that stood here mocked the model away entirely and asserted
        // only that the flag had been passed to the constructor, which is
        // precisely why a flag that did nothing looked like it worked. These
        // go through the real model.
        const RealAdditionalFile = jest.requireActual(
          "../../models/AdditionalFile",
        );

        /**
         * A saved row as the post-save hook sees it, with the parts of the
         * Mongoose document the hook actually touches.
         */
        const savedRow = ({ skipPostSave, move: fileMove }) => {
          const doc = {
            wasNew: true,
            skipPostSave,
            run: mockObjectId,
            file: {
              originalName: "notes.txt",
              moveToFolderAndSave: fileMove,
            },
          };
          doc.populate = jest.fn(() => doc);
          doc.execPopulate = jest.fn(() => Promise.resolve(doc));
          return doc;
        };

        beforeEach(() => {
          Run.findById = jest.fn().mockResolvedValue({
            getRelativePath: jest.fn().mockResolvedValue("/test/path"),
          });
        });

        it("is a real path on the schema, not a property Mongoose drops", () => {
          const row = new RealAdditionalFile({
            file: new mongoose.Types.ObjectId(),
            sample: mockObjectId,
            skipPostSave: true,
          });

          expect(RealAdditionalFile.schema.path("skipPostSave")).toBeDefined();
          expect(row.skipPostSave).toBe(true);
        });

        it("stops the model moving the file a second time", async () => {
          const fileMove = jest.fn().mockResolvedValue(undefined);

          await RealAdditionalFile.movePostSave(
            savedRow({ skipPostSave: true, move: fileMove }),
          );

          expect(fileMove).not.toHaveBeenCalled();
        });

        it("still lets a row written without it move its own file", async () => {
          // Guards the guard: a hook that returned unconditionally would pass
          // the test above and break every legacy caller.
          const fileMove = jest.fn().mockResolvedValue(undefined);

          await RealAdditionalFile.movePostSave(
            savedRow({ skipPostSave: false, move: fileMove }),
          );

          expect(fileMove).toHaveBeenCalledWith(
            path.join("/test/path", "additional", "notes.txt"),
          );
        });

        it("is set on every row processAdditionalFiles writes", async () => {
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

      test("refuses an uploadName that only escapes the upload directory via a symlink", async () => {
        // The hpc-mv branch has this test; this branch had none, so the
        // symlink half of its own resolveWithinReal was unwatched and the call
        // could be downgraded to the lexical resolveWithin with a green build.
        //
        // Lexically "<uploadDir>/<id>" never leaves the root — every string
        // check passes. Only realpath sees that the name is a link to a file
        // outside the staging area, which is what stops that file being
        // adopted into the datastore as though it had been uploaded.
        const escapeId = "b2c3d4e5f60718293a4b5c6d7e8f9012";
        const target = path.join(outsideDir, "secret.fq");
        fsSync.writeFileSync(target, "TOP SECRET");
        fsSync.symlinkSync(target, path.join(uploadDir, escapeId));

        await expect(
          process1(localFile({ uploadName: escapeId })),
        ).rejects.toThrow(/'uploadName' is not a valid file path/);

        // Refused as a path, before ownership is even consulted — so the
        // message cannot be turned into an oracle for who owns what.
        expect(File).not.toHaveBeenCalled();
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

  describe("the HPC claim trail", () => {
    // The trail is the only control the shared staging area has: nothing
    // records which group a subdirectory belongs to, so a claim can be
    // attributed but not authorised. It used to be written BEFORE the file was
    // taken, always with the default outcome=ok, and never at all when a claim
    // was refused — so it recorded takes that never happened and was silent
    // about exactly the attempts an operator needs to see.
    let move;

    const hpcFile = (overrides) => ({
      name: "reads.fq",
      relativePath: "WGS_Test/01.RawData",
      uploadMethod: "hpc-mv",
      ...overrides,
    });

    /** Every claim record emitted so far, oldest first. */
    const claims = () =>
      auditHpcAccess.mock.calls
        .map(([record]) => record)
        .filter((record) => record.action === "claim");

    const claim = (file = hpcFile(), username = OWNER) =>
      processAdditionalFiles(
        [file],
        "sample",
        mockObjectId,
        "/test/path",
        username,
      );

    beforeEach(() => {
      move = jest.fn().mockResolvedValue(undefined);
      File.mockImplementation((data) => ({
        save: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(),
          originalName: data.originalName,
          path: data.path,
          moveToFolderAndSave: move,
          save: jest.fn().mockResolvedValue({}),
        }),
      }));
      AdditionalFile.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));
      jest.spyOn(fs, "access").mockResolvedValue(undefined);
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    it("records nothing until the bytes have actually moved", async () => {
      let claimsAtMoveTime = null;
      move.mockImplementation(async () => {
        claimsAtMoveTime = claims().length;
      });

      await claim();

      expect(claimsAtMoveTime).toBe(0);
      expect(claims()).toEqual([
        expect.objectContaining({
          outcome: "ok",
          user: { username: OWNER },
          detail: "type=additional",
        }),
      ]);
    });

    it("records the failure, not a take, when the claim cannot be completed", async () => {
      move.mockRejectedValue(new Error("EROFS: read-only file system"));

      await expect(claim()).rejects.toThrow(/read-only file system/);

      expect(claims()).toEqual([
        expect.objectContaining({
          outcome: "failed",
          user: { username: OWNER },
        }),
      ]);
    });

    it("records a claim refused for reaching outside the staging area", async () => {
      await expect(
        claim(hpcFile({ relativePath: "../../etc" })),
      ).rejects.toThrow(/'relativePath' is not a valid file path/);

      expect(claims()).toEqual([
        expect.objectContaining({
          outcome: "refused-outside-transfer-directory",
          user: { username: OWNER },
        }),
      ]);
    });

    it("names the caller on a refusal, so an attempt can be attributed", async () => {
      await claim(hpcFile({ relativePath: "../../etc" }), "mallory").catch(
        () => {},
      );

      expect(claims()[0].user).toEqual({ username: "mallory" });
    });

    it("says nothing about a local-filesystem upload, which is not shared", async () => {
      // assertUploadClaimable already proved that upload belongs to the
      // caller, and its staging area is per-user rather than per-group.
      stageUpload();

      await claim({ name: "notes.txt", uploadName: UPLOAD_ID });

      expect(claims()).toEqual([]);
    });
  });

  describe("recovering a file an earlier attempt already moved", () => {
    // The incident: a transient DB failure between a successful move and the
    // save that follows it. The destination is occupied and every later
    // attempt failed with "destination already exists", and the API had no
    // recovery path at all. The bytes sat in the datastore with no row
    // pointing at them.
    //
    // This describe block's uploads are all hpc-mv, whose source
    // moveToFolderAndSave now deliberately KEEPS on a successful move rather
    // than unlinking it (see models/File.js's `keepSource`,
    // BREAKING_CHANGES.md entry 35). The fixture below COPIES the staged
    // source to the destination — an independent inode — exactly as the real
    // move does now (fs.copyFile, not a hard link). This matters: an inode-
    // based reconcile would pass a hard-link fixture but fail the real copy,
    // so the fixture must copy or it would not catch that regression.
    let dataRoot;
    let stagedSource;
    let destination;
    let move;
    let ourFile;
    let readSave;
    let readData;

    const REL_DESTINATION = path.join("/test/run/path", "raw", "reads.fq");

    const hpcRead = (overrides) => ({
      name: "reads.fq",
      relativePath: "WGS_Test/01.RawData",
      ...overrides,
    });

    const ingest = (file = hpcRead()) =>
      processReadFiles(
        [file],
        mockObjectId,
        "/test/path",
        { method: "hpc-mv" },
        OWNER,
      );

    beforeEach(() => {
      dataRoot = path.join(tmpRoot, "datastore");
      destination = path.join(dataRoot, "test/run/path/raw/reads.fq");
      fsSync.mkdirSync(path.dirname(destination), { recursive: true });
      process.env.DATASTORE_ROOT = dataRoot;

      stagedSource = path.join(hpcRoot, "WGS_Test/01.RawData/reads.fq");
      fsSync.mkdirSync(path.dirname(stagedSource), { recursive: true });
      fsSync.writeFileSync(stagedSource, "ACGT");

      // What production did: the bytes copied to the destination, and the
      // save that followed did not. moveToFolderAndSave rejects with the
      // source still in place and the destination an INDEPENDENT copy (a
      // different inode) — exactly what an hpc-mv move does now.
      move = jest.fn().mockImplementation(async () => {
        fsSync.copyFileSync(stagedSource, destination);
        throw new Error("MongoNetworkError: connection timed out");
      });

      File.mockImplementation((data) => {
        ourFile = {
          _id: new mongoose.Types.ObjectId(),
          originalName: data.originalName,
          path: data.path,
          moveToFolderAndSave: move,
          save: jest.fn().mockImplementation(() => Promise.resolve(ourFile)),
        };
        return { save: jest.fn().mockResolvedValue(ourFile) };
      });
      File.findOne = jest.fn().mockResolvedValue(null);
      File.deleteOne = jest.fn().mockResolvedValue({});
      Read.exists = jest.fn().mockResolvedValue(false);
      AdditionalFile.exists = jest.fn().mockResolvedValue(false);

      readData = null;
      readSave = jest
        .fn()
        .mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      Read.mockImplementation((data) => {
        readData = data;
        return { save: readSave };
      });

      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Run.findById = jest.fn().mockResolvedValue({
        getRelativePath: jest.fn().mockResolvedValue("/test/run/path"),
      });
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    it("reconciles the document onto bytes its own failed save left behind", async () => {
      await ingest();

      expect(ourFile.path).toBe(REL_DESTINATION);
      expect(ourFile.save).toHaveBeenCalled();
      expect(readData.file).toBe(ourFile._id);
      expect(fsSync.existsSync(destination)).toBe(true);
    });

    it("resolves instead of stalling the run permanently", async () => {
      // processReadFiles itself no longer marks "complete" — see its module
      // doc comment — but the fixture's point still holds at this layer: the
      // recovery lets the call resolve, rather than reject over a save
      // failure that already happened, which is what used to leave the run
      // stuck at 'processing' forever with nothing left that would retry it.
      await expect(ingest()).resolves.toEqual([
        expect.objectContaining({ fileName: "reads.fq" }),
      ]);

      expect(Run.findByIdAndUpdate).not.toHaveBeenCalledWith(
        mockObjectId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: "error" }),
        }),
      );
    });

    it("adopts the unclaimed document an earlier attempt left at the destination", async () => {
      // The retry's view of the same incident: attempt one's File row already
      // points at the destination, and no Read or AdditionalFile references it.
      const orphan = {
        _id: new mongoose.Types.ObjectId(),
        originalName: "reads.fq",
        path: REL_DESTINATION,
      };
      File.findOne = jest.fn().mockResolvedValue(orphan);

      await ingest();

      expect(readData.file).toBe(orphan._id);
      // This attempt's duplicate points at a source that is gone, and File's
      // unique {name, path, createFileDocumentId} index would refuse the next
      // attempt's identical document if it were left behind.
      expect(File.deleteOne).toHaveBeenCalledWith({ _id: ourFile._id });
    });

    it("refuses to adopt a file a Read already claims", async () => {
      File.findOne = jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        originalName: "reads.fq",
      });
      Read.exists = jest.fn().mockResolvedValue(true);

      await expect(ingest()).rejects.toThrow(/connection timed out/);

      expect(readSave).not.toHaveBeenCalled();
      expect(File.deleteOne).not.toHaveBeenCalled();
    });

    it("refuses to adopt a file an AdditionalFile already claims", async () => {
      File.findOne = jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        originalName: "reads.fq",
      });
      AdditionalFile.exists = jest.fn().mockResolvedValue(true);

      await expect(ingest()).rejects.toThrow(/connection timed out/);

      expect(readSave).not.toHaveBeenCalled();
    });

    it("refuses to adopt while the staged source is still sitting there", async () => {
      // Nothing was moved by anybody: the destination belongs to something
      // else, and the upload can simply be retried.
      move = jest
        .fn()
        .mockRejectedValue(
          new Error(
            `Failed to move ${stagedSource} to ${destination}: destination already exists`,
          ),
        );
      fsSync.writeFileSync(destination, "SOMEBODY ELSE");

      await expect(ingest()).rejects.toThrow(/destination already exists/);

      expect(readSave).not.toHaveBeenCalled();
      expect(fsSync.readFileSync(destination, "utf8")).toBe("SOMEBODY ELSE");
    });

    it("refuses to adopt a file whose MD5 is not the one the request declared", async () => {
      calculateFileMd5.mockResolvedValue("f".repeat(32));

      await expect(ingest(hpcRead({ md5: "a".repeat(32) }))).rejects.toThrow(
        /connection timed out/,
      );

      expect(readSave).not.toHaveBeenCalled();
    });

    it("adopts a file whose MD5 is the one the request declared", async () => {
      calculateFileMd5.mockResolvedValue("A".repeat(32));

      await ingest(hpcRead({ md5: "a".repeat(32) }));

      expect(readData.file).toBe(ourFile._id);
    });

    describe("no MD5 declared: content, not just size, decides adoption", () => {
      // Reproduces the exact scenario a re-audit found by execution: the
      // retained hpc-mv source is a live file a scientist can still touch.
      // Correcting a bad upload by re-scp-ing a same-size but DIFFERENT file
      // under the same staging name, between the failed save and the retry,
      // must not have the retry silently adopt the stale destination bytes.
      //
      // The shared `move` mock unconditionally re-copies stagedSource onto
      // destination before throwing, which is not what a real RETRY does:
      // moveToFolderAndSave's copyFile uses COPYFILE_EXCL, so it fails EEXIST
      // the instant destination already exists, without touching its bytes.
      // These two tests need that real semantic — the whole point is that
      // destination and stagedSource can genuinely disagree — so `move` is
      // overridden locally to leave an existing destination alone.
      beforeEach(() => {
        calculateFileMd5.mockImplementation(realCalculateFileMd5);
        move.mockImplementation(async () => {
          if (fsSync.existsSync(destination)) {
            throw new Error(
              `Failed to move x to ${destination}: destination already exists`,
            );
          }
          fsSync.copyFileSync(stagedSource, destination);
          throw new Error("MongoNetworkError: connection timed out");
        });
      });

      it("refuses to adopt a same-size destination whose content does not match the retained source", async () => {
        fsSync.writeFileSync(destination, "AAAA"); // the earlier, now-stale attempt
        fsSync.writeFileSync(stagedSource, "BBBB"); // corrected in place, same size

        await expect(ingest(hpcRead())).rejects.toThrow(
          /destination already exists/,
        );

        expect(readSave).not.toHaveBeenCalled();
        // The stale destination is untouched, not silently accepted.
        expect(fsSync.readFileSync(destination, "utf8")).toBe("AAAA");
      });

      it("adopts a same-size destination whose content genuinely matches the retained source", async () => {
        fsSync.writeFileSync(destination, "ACGT");
        fsSync.writeFileSync(stagedSource, "ACGT");

        await ingest(hpcRead());

        expect(readData.file).toBe(ourFile._id);
      });
    });

    it("does not adopt a destination that is a symlink rather than the real bytes", async () => {
      // A symlink planted at the destination name, pointing at somebody
      // else's file elsewhere in DATASTORE_ROOT, must never be adopted as
      // this claim's own bytes — even though a declared MD5 matching what
      // the link resolves to would otherwise look like proof.
      //
      // Nothing moved anybody's bytes here: the destination was never this
      // attempt's own hard link, so condition 2's same-inode check refuses
      // it before the MD5 comparison is ever reached — an earlier and
      // stronger refusal than before (an inode match is a filesystem-level
      // guarantee of identical bytes; an MD5 match is not). The staged
      // source is left untouched, exactly as a real hpc-mv failure at the
      // link step leaves it (see "refuses to adopt while the staged source
      // is still sitting there", above) — moveToFolderAndSave never got far
      // enough to touch it.
      //
      // Containment does not stop this on its own. The link's target is
      // another group's file inside the same DATASTORE_ROOT, so
      // resolveWithinReal realpaths it to a location still under the root
      // and returns the destination — and fs.stat() follows the link, so
      // the isFile() check passes too.
      const theirs = path.join(dataRoot, "other-group", "their-reads.fq");
      fsSync.mkdirSync(path.dirname(theirs), { recursive: true });
      fsSync.writeFileSync(theirs, "SOMEBODY ELSE'S SEQUENCE DATA");
      const theirMd5 = crypto
        .createHash("md5")
        .update("SOMEBODY ELSE'S SEQUENCE DATA")
        .digest("hex");

      // The move fails at the link step (the destination name is already
      // occupied — by the symlink below, not by this attempt's own output).
      fsSync.symlinkSync(theirs, destination);
      move = jest.fn().mockImplementation(async () => {
        throw new Error(
          `Failed to move ${stagedSource} to ${destination}: destination already exists`,
        );
      });

      calculateFileMd5.mockImplementation(realCalculateFileMd5);

      // The declared MD5 is genuinely the digest of the bytes behind the
      // link — if condition 2 did not refuse first, a hasher that follows
      // the link would report a match and adopt it.
      await expect(ingest(hpcRead({ md5: theirMd5 }))).rejects.toThrow(
        /destination already exists/,
      );

      expect(readSave).not.toHaveBeenCalled();
      // Refused on the inode mismatch, before MD5 (or O_NOFOLLOW in
      // lib/utils/md5.js) ever entered into it.
      expect(calculateFileMd5).not.toHaveBeenCalled();
      // Nothing was repointed at the link.
      expect(File.deleteOne).not.toHaveBeenCalled();
    });

    it("does not adopt when the destination holds nothing at all", async () => {
      // The ordinary "your file is not in staging" mistake must still fail.
      move = jest
        .fn()
        .mockRejectedValue(
          new Error(`Failed to move ${stagedSource} to ${destination}: ENOENT`),
        );
      fsSync.rmSync(stagedSource);

      await expect(ingest()).rejects.toThrow(/ENOENT/);

      expect(readSave).not.toHaveBeenCalled();
    });
  });

  describe("recovering a local-filesystem file an earlier attempt already moved", () => {
    // The same incident as the hpc-mv block above, but for a local-filesystem
    // claim, whose source moveToFolderAndSave DOES unlink on a successful
    // move (only hpc-mv keeps its source — see BREAKING_CHANGES.md entry 35).
    // adoptAlreadyMovedFile's condition 2 takes a different branch for this
    // case (source-gone, not same-inode) — this is the only test exercising
    // that branch since the hpc-mv block above moved off it.
    let dataRoot;
    let destination;
    let move;
    let ourFile;
    let readSave;
    let readData;

    const REL_DESTINATION = path.join("/test/run/path", "raw", "reads.fq");

    beforeEach(() => {
      dataRoot = path.join(tmpRoot, "datastore-lf");
      destination = path.join(dataRoot, "test/run/path/raw/reads.fq");
      fsSync.mkdirSync(path.dirname(destination), { recursive: true });
      process.env.DATASTORE_ROOT = dataRoot;

      stageUpload();

      // What production did: the bytes moved (and the source, staged in
      // UPLOAD_DIRECTORY, was unlinked — unlike hpc-mv, a local-filesystem
      // move really does consume it), and the save that followed did not.
      move = jest.fn().mockImplementation(async function () {
        fsSync.renameSync(this.path, destination);
        throw new Error("MongoNetworkError: connection timed out");
      });

      File.mockImplementation((data) => {
        ourFile = {
          _id: new mongoose.Types.ObjectId(),
          originalName: data.originalName,
          path: data.path,
          moveToFolderAndSave: move,
          save: jest.fn().mockImplementation(() => Promise.resolve(ourFile)),
        };
        return { save: jest.fn().mockResolvedValue(ourFile) };
      });
      File.findOne = jest.fn().mockResolvedValue(null);
      File.deleteOne = jest.fn().mockResolvedValue({});
      Read.exists = jest.fn().mockResolvedValue(false);
      AdditionalFile.exists = jest.fn().mockResolvedValue(false);

      readData = null;
      readSave = jest
        .fn()
        .mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      Read.mockImplementation((data) => {
        readData = data;
        return { save: readSave };
      });

      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Run.findById = jest.fn().mockResolvedValue({
        getRelativePath: jest.fn().mockResolvedValue("/test/run/path"),
      });
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    const ingest = () =>
      processReadFiles(
        [{ name: "reads.fq", uploadName: UPLOAD_ID, paired: false }],
        mockObjectId,
        "/test/path",
        { method: "local-filesystem" },
        OWNER,
      );

    it("reconciles the document onto bytes its own failed save left behind", async () => {
      await ingest();

      expect(ourFile.path).toBe(REL_DESTINATION);
      expect(readData.file).toBe(ourFile._id);
    });

    it("refuses to adopt while the staged source is still sitting there", async () => {
      // Nothing was moved by anybody: the destination belongs to something
      // else, and the upload can simply be retried.
      move = jest
        .fn()
        .mockRejectedValue(new Error("destination already exists"));
      fsSync.writeFileSync(destination, "SOMEBODY ELSE");

      await expect(ingest()).rejects.toThrow(/destination already exists/);

      expect(readSave).not.toHaveBeenCalled();
      expect(fsSync.readFileSync(destination, "utf8")).toBe("SOMEBODY ELSE");
    });
  });

  describe("a failing batch does not abandon its siblings", () => {
    // Promise.all rejects on the first failure and leaves the other moves
    // running unsupervised: a multi-gigabyte read could land in the datastore
    // long after the job row said the attempt had failed, which is itself what
    // creates the permanent "destination already exists" stall next time.
    const SECOND_UPLOAD_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

    let moves;
    let readSave;

    const runTwo = () =>
      processReadFiles(
        [
          { name: "a.fq", uploadName: UPLOAD_ID, paired: false },
          { name: "b.fq", uploadName: SECOND_UPLOAD_ID, paired: false },
        ],
        mockObjectId,
        "/test/path",
        { method: "local-filesystem" },
        OWNER,
      );

    beforeEach(() => {
      stageUpload();
      stageUpload(SECOND_UPLOAD_ID);

      moves = {};
      File.mockImplementation((data) => ({
        save: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(),
          originalName: data.originalName,
          path: data.path,
          moveToFolderAndSave: moves[data.originalName],
          save: jest.fn().mockResolvedValue({}),
        }),
      }));
      readSave = jest
        .fn()
        .mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      Read.mockImplementation(() => ({ save: readSave }));
      Run.findByIdAndUpdate = jest.fn().mockResolvedValue({});
      Run.findById = jest.fn().mockResolvedValue({
        getRelativePath: jest.fn().mockResolvedValue("/test/run/path"),
      });
      jest.spyOn(fs, "access").mockResolvedValue(undefined);
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    it("waits for the slow sibling of a failed move to finish first", async () => {
      let slowFinished = false;
      moves["a.fq"] = jest
        .fn()
        .mockRejectedValue(new Error("ENOSPC: no space left on device"));
      moves["b.fq"] = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              slowFinished = true;
              resolve();
            }, 20);
          }),
      );

      await expect(runTwo()).rejects.toThrow(/ENOSPC/);

      expect(slowFinished).toBe(true);
      // And its row was written before the job was marked failed, rather than
      // arriving after the run already said 'error'.
      expect(readSave.mock.invocationCallOrder[0]).toBeLessThan(
        Run.findByIdAndUpdate.mock.invocationCallOrder[1],
      );
    });

    it("waits for the slow sibling of a failed additional file too", async () => {
      let slowFinished = false;
      moves["a.txt"] = jest
        .fn()
        .mockRejectedValue(new Error("ENOSPC: no space left on device"));
      moves["b.txt"] = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              slowFinished = true;
              resolve();
            }, 20);
          }),
      );
      AdditionalFile.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await expect(
        processAdditionalFiles(
          [
            { name: "a.txt", uploadName: UPLOAD_ID },
            { name: "b.txt", uploadName: SECOND_UPLOAD_ID },
          ],
          "sample",
          mockObjectId,
          "/test/path",
          OWNER,
        ),
      ).rejects.toThrow(/ENOSPC/);

      expect(slowFinished).toBe(true);
    });

    it("reports every file that failed, not just the first", async () => {
      moves["a.fq"] = jest
        .fn()
        .mockRejectedValue(new Error("ENOSPC: no space left on device"));
      moves["b.fq"] = jest
        .fn()
        .mockRejectedValue(new Error("EROFS: read-only file system"));

      const error = await runTwo().catch((thrown) => thrown);

      expect(error.message).toContain("2 of 2");
      expect(error.message).toContain("ENOSPC");
      expect(error.message).toContain("EROFS");
    });

    it("stores the aggregate on the run, not one arbitrary failure", async () => {
      moves["a.fq"] = jest
        .fn()
        .mockRejectedValue(new Error("ENOSPC: no space left on device"));
      moves["b.fq"] = jest
        .fn()
        .mockRejectedValue(new Error("EROFS: read-only file system"));

      await runTwo().catch(() => {});

      expect(Run.findByIdAndUpdate).toHaveBeenLastCalledWith(
        mockObjectId,
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "error",
            statusError: expect.stringContaining("EROFS"),
          }),
        }),
      );
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
