const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs").promises;

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

  beforeEach(() => {
    jest.clearAllMocks();
    // Set required environment variables
    process.env.DATASTORE_ROOT = "/mnt/reads";
    process.env.HPC_TRANSFER_DIRECTORY = "/mnt/tempWebUploadToSequences";
  });

  describe("processAdditionalFiles", () => {
    it("should use lowercase md5 field from file object", async () => {
      const mockFileId = new mongoose.Types.ObjectId();
      const expectedMd5 = "abc123def456";

      // Mock File.save()
      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({ _id: mockFileId }),
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

      const additionalFiles = [
        {
          name: "test-file.txt",
          uploadName: "uuid-test-file.txt", // Required for local-filesystem
          md5: expectedMd5, // lowercase md5 - this is what frontend sends
          uploadMethod: "local-filesystem",
        },
      ];

      await processAdditionalFiles(
        additionalFiles,
        "sample",
        mockObjectId,
        "/test/path",
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

      File.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({ _id: mockFileId }),
      }));

      const mockAdditionalFileSave = jest.fn().mockResolvedValue({});
      AdditionalFile.mockImplementation((data) => {
        mockAdditionalFileSave.constructorData = data;
        return { save: mockAdditionalFileSave };
      });

      jest.spyOn(fs, "access").mockResolvedValue(undefined);

      // File has both uppercase MD5 (wrong) and lowercase md5 (correct)
      // This simulates what could happen if someone mistakenly adds both
      const additionalFiles = [
        {
          name: "test-file.txt",
          uploadName: "uuid-test-file.txt", // Required for local-filesystem
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

      const readFiles = [
        {
          name: "test_R1.fq.gz",
          uploadName: "uuid-test_R1.fq.gz",
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
      );

      // Should use lowercase md5 for local uploads as well
      expect(readConstructorData.MD5).toBe(expectedMd5);
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
