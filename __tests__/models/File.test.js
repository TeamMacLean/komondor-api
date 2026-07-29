/**
 * Tests for File.moveToFolderAndSave — the path every uploaded read file takes
 * into the datastore.
 *
 * These run against real files in a temporary directory. The cross-device
 * branch is reached by forcing fs.rename to fail, which is what happens in
 * production when the upload staging area and the datastore are separate
 * mounts.
 */

// File.js destructures createWriteStream at module load, so it must be
// swappable at the module boundary rather than via a later spy.
let mockWriteStreamFactory = null;

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    createWriteStream: (...args) =>
      mockWriteStreamFactory
        ? mockWriteStreamFactory(...args)
        : actual.createWriteStream(...args),
  };
});

const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const _path = require("path");
const { Writable } = require("stream");

const File = require("../../models/File");

let tmpRoot;
let datastoreRoot;
let stagingDir;
const ORIGINAL_DATASTORE = process.env.DATASTORE_ROOT;

/** Builds an unsaved File document with a stubbed save(). */
const makeFile = (sourcePath) => {
  const doc = new File({
    name: "reads.fq",
    type: "run",
    uploadName: "reads.fq",
    originalName: "reads.fq",
    path: sourcePath,
  });
  doc.save = jest.fn().mockImplementation(() => Promise.resolve(doc));
  return doc;
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-file-"));
  datastoreRoot = _path.join(tmpRoot, "datastore");
  stagingDir = _path.join(tmpRoot, "staging");
  fs.mkdirSync(datastoreRoot, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  process.env.DATASTORE_ROOT = datastoreRoot;

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  mockWriteStreamFactory = null;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (ORIGINAL_DATASTORE === undefined) {
    delete process.env.DATASTORE_ROOT;
  } else {
    process.env.DATASTORE_ROOT = ORIGINAL_DATASTORE;
  }
});

afterAll(async () => {
  const mongoose = require("mongoose");
  await mongoose.connection.close();
});

describe("moveToFolderAndSave — same filesystem (rename)", () => {
  test("moves the file to the destination", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
  });

  test("removes the source file", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    expect(fs.existsSync(source)).toBe(false);
  });

  test("creates missing intermediate directories", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("a", "b", "c", "reads.fq"));

    expect(fs.existsSync(_path.join(datastoreRoot, "a", "b", "c", "reads.fq"))).toBe(
      true,
    );
  });

  test("records the relative path and saves", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);
    const relPath = _path.join("group", "raw", "reads.fq");

    await doc.moveToFolderAndSave(relPath);

    expect(doc.path).toBe(relPath);
    expect(doc.save).toHaveBeenCalled();
  });
});

describe("moveToFolderAndSave — cross-device (copy fallback)", () => {
  /** Forces the rename to fail the way a cross-mount move does. */
  const forceCrossDevice = () => {
    const realRename = fsp.rename;
    jest.spyOn(fsp, "rename").mockImplementation(() => {
      const err = new Error("EXDEV: cross-device link not permitted");
      err.code = "EXDEV";
      return Promise.reject(err);
    });
    return realRename;
  };

  test("copies the file when rename fails", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
  });

  test("removes the source only after the copy succeeds", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    expect(fs.existsSync(source)).toBe(false);
  });

  test("preserves file contents byte-for-byte", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    const payload = Buffer.from(
      Array.from({ length: 100000 }, (_, i) => i % 256),
    );
    fs.writeFileSync(source, payload);
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest).equals(payload)).toBe(true);
  });

  describe("when the copy fails part-way", () => {
    const REL_PATH = _path.join("group", "raw", "reads.fq");
    let source;
    let dest;

    /**
     * Simulates a copy that has already written some bytes and then fails —
     * a full disk, or the mount dropping mid-transfer.
     *
     * The bytes already on disk are staged directly so the assertion is
     * deterministic rather than racing the stream.
     */
    const forceCopyFailure = () => {
      forceCrossDevice();
      mockWriteStreamFactory = (destPath) => {
        fs.mkdirSync(_path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, "ACGT"); // bytes written before the failure
        return new Writable({
          write(chunk, encoding, callback) {
            callback(new Error("ENOSPC: no space left on device"));
          },
        });
      };
    };

    beforeEach(() => {
      source = _path.join(stagingDir, "reads.fq");
      dest = _path.join(datastoreRoot, REL_PATH);
      fs.writeFileSync(source, "ACGTACGT");
      forceCopyFailure();
    });

    test("rejects rather than reporting success", async () => {
      const doc = makeFile(source);

      await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(/ENOSPC/);
    });

    test("keeps the source file", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.existsSync(source)).toBe(true);
      expect(fs.readFileSync(source, "utf8")).toBe("ACGTACGT");
    });

    test("does not leave a truncated file at the destination", async () => {
      // A partial file left behind is indistinguishable from a complete read
      // to everything downstream.
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.existsSync(dest)).toBe(false);
    });

    test("does not save the document", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(doc.save).not.toHaveBeenCalled();
    });

    test("leaves the document's path pointing at the source", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(doc.path).toBe(source);
    });
  });
});

describe("moveToFolderAndSave — configuration and input guards", () => {
  test("rejects when DATASTORE_ROOT is not configured", async () => {
    delete process.env.DATASTORE_ROOT;
    const doc = makeFile(_path.join(stagingDir, "reads.fq"));

    await expect(doc.moveToFolderAndSave("group/raw/reads.fq")).rejects.toThrow(
      /DATASTORE_ROOT is not configured/,
    );
  });

  test("rejects when the document has no source path", async () => {
    const doc = makeFile(undefined);

    await expect(doc.moveToFolderAndSave("group/raw/reads.fq")).rejects.toThrow(
      /no source path/,
    );
  });

  test("rejects when the source file does not exist", async () => {
    const doc = makeFile(_path.join(stagingDir, "missing.fq"));

    await expect(
      doc.moveToFolderAndSave("group/raw/reads.fq"),
    ).rejects.toThrow();
    expect(doc.save).not.toHaveBeenCalled();
  });
});
