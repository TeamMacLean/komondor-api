/**
 * Tests for routes/_utils.js — the shared error responder and directory reader.
 */

const fs = require("fs");
const os = require("os");
const _path = require("path");

const mongoose = require("mongoose");

const {
  handleError,
  getActualFiles,
  generateRequestId,
  getAdditionalFilesStatus,
  compareFilesToDirectory,
} = require("../../routes/_utils");

/** Builds a minimal Express response double. */
const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
};

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("generateRequestId", () => {
  test("produces a non-empty string", () => {
    expect(typeof generateRequestId()).toBe("string");
    expect(generateRequestId().length).toBeGreaterThan(0);
  });

  test("produces distinct values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe("handleError", () => {
  test("defaults to 500", () => {
    const res = makeRes();
    handleError(res, new Error("boom"));
    expect(res.statusCode).toBe(500);
  });

  test("uses the supplied status code", () => {
    const res = makeRes();
    handleError(res, new Error("nope"), 404);
    expect(res.statusCode).toBe(404);
  });

  test("uses the error message when no custom message is given", () => {
    const res = makeRes();
    handleError(res, new Error("boom"), 400);
    expect(res.body.error).toBe("boom");
  });

  test("prefers a custom client message", () => {
    const res = makeRes();
    handleError(res, new Error("E11000 duplicate key"), 400, "Name is taken.");
    expect(res.body.error).toBe("Name is taken.");
  });

  test("always includes the underlying detail", () => {
    const res = makeRes();
    handleError(res, new Error("E11000 duplicate key"), 400, "Name is taken.");
    expect(res.body.detail).toBe("E11000 duplicate key");
  });

  test("includes a request id", () => {
    const res = makeRes();
    handleError(res, new Error("boom"));
    expect(res.body.requestId).toBeDefined();
  });

  test("echoes a supplied request id so logs and responses correlate", () => {
    const res = makeRes();
    handleError(res, new Error("boom"), 500, "Failed.", "req-123");
    expect(res.body.requestId).toBe("req-123");
  });

  test("hides the custom message for 500s in production but keeps the detail", () => {
    process.env.NODE_ENV = "production";
    const res = makeRes();
    handleError(res, new Error("connection refused"), 500, "Failed to save.");

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("An internal server error occurred.");
    expect(res.body.detail).toBe("connection refused");
  });

  test("keeps client-error messages intact in production", () => {
    process.env.NODE_ENV = "production";
    const res = makeRes();
    handleError(res, new Error("bad id"), 400, "Project ID not provided.");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Project ID not provided.");
  });

  test("logs validation errors when present", () => {
    const res = makeRes();
    const error = new Error("validation failed");
    error.errors = { name: { message: "required" } };

    handleError(res, error, 400);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Validation errors"),
      expect.any(String),
    );
  });
});

describe("getActualFiles", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-utils-"));
    fs.writeFileSync(_path.join(tmpDir, "reads.txt"), "a");
    fs.writeFileSync(_path.join(tmpDir, ".DS_Store"), "junk");
    fs.writeFileSync(_path.join(tmpDir, ".hidden"), "junk");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("lists visible files", async () => {
    await expect(getActualFiles(tmpDir)).resolves.toEqual(["reads.txt"]);
  });

  test("filters out dotfiles", async () => {
    const files = await getActualFiles(tmpDir);
    expect(files).not.toContain(".DS_Store");
    expect(files).not.toContain(".hidden");
  });

  test("returns an empty array for a missing directory", async () => {
    const missing = _path.join(tmpDir, "does-not-exist");
    await expect(getActualFiles(missing)).resolves.toEqual([]);
  });

  test("rethrows errors other than ENOENT", async () => {
    // A file is not a directory: readdir reports ENOTDIR.
    const filePath = _path.join(tmpDir, "reads.txt");
    await expect(getActualFiles(filePath)).rejects.toThrow();
  });

  test("ignores subdirectories", async () => {
    // A directory reported as a file shows up as an untracked stray.
    fs.mkdirSync(_path.join(tmpDir, "nested"), { recursive: true });

    await expect(getActualFiles(tmpDir)).resolves.not.toContain("nested");
  });

  test("ignores partially copied files", async () => {
    // An interrupted transfer is not a stray file, and reporting it as one
    // would send someone looking for a database record that never existed.
    fs.writeFileSync(
      _path.join(tmpDir, "big.bam.part-651f9c0a1b2c3d4e5f6a7b8c"),
      "partial",
    );

    const files = await getActualFiles(tmpDir);

    expect(files).toEqual(["reads.txt"]);
  });
});

describe("getAdditionalFilesStatus", () => {
  /** An AdditionalFile with its file ref populated, as the routes fetch it. */
  const populated = (originalName) => ({
    _id: new mongoose.Types.ObjectId(),
    file: { originalName },
  });

  describe("when the database and disk agree", () => {
    test("reports OK", () => {
      const result = getAdditionalFilesStatus(
        [populated("a.pdf"), populated("b.csv")],
        ["a.pdf", "b.csv"],
      );

      expect(result).toMatchObject({ status: "OK", missing: [], extra: [] });
    });

    test("reports OK when both sides are empty", () => {
      expect(getAdditionalFilesStatus([], [])).toMatchObject({ status: "OK" });
    });

    test("ignores the order files are listed in", () => {
      const result = getAdditionalFilesStatus(
        [populated("a.pdf"), populated("b.csv")],
        ["b.csv", "a.pdf"],
      );

      expect(result.status).toBe("OK");
    });
  });

  describe("when files are missing or untracked", () => {
    test("reports a file that is absent from disk", () => {
      const result = getAdditionalFilesStatus(
        [populated("a.pdf"), populated("gone.csv")],
        ["a.pdf"],
      );

      expect(result).toMatchObject({
        status: "MISMATCH",
        missing: ["gone.csv"],
        extra: [],
      });
    });

    test("reports a file on disk with no record", () => {
      const result = getAdditionalFilesStatus(
        [populated("a.pdf")],
        ["a.pdf", "stray.txt"],
      );

      expect(result).toMatchObject({
        status: "WARNING",
        missing: [],
        extra: ["stray.txt"],
      });
    });

    test("reports both sides when a file has been renamed", () => {
      const result = getAdditionalFilesStatus(
        [populated("old-name.pdf")],
        ["new-name.pdf"],
      );

      expect(result).toMatchObject({
        status: "MISMATCH",
        missing: ["old-name.pdf"],
        extra: ["new-name.pdf"],
      });
      expect(result.message).toMatch(/renamed/);
    });

    test("counts duplicates rather than matching by presence", () => {
      // Two records, one copy on disk: set membership called this complete.
      const result = getAdditionalFilesStatus(
        [populated("report.pdf"), populated("report.pdf")],
        ["report.pdf"],
      );

      expect(result).toMatchObject({
        status: "MISMATCH",
        missing: ["report.pdf"],
      });
    });

    test("treats differently normalised filenames as the same file", () => {
      // macOS and Linux encode the accent differently; a byte comparison
      // reports the file as both missing and untracked.
      const result = getAdditionalFilesStatus(
        [populated("résumé.pdf".normalize("NFC"))],
        ["résumé.pdf".normalize("NFD")],
      );

      expect(result.status).toBe("OK");
    });
  });

  describe("when a record's filename cannot be resolved", () => {
    test("reports an unpopulated file reference instead of dropping it", () => {
      // An unpopulated ref is an ObjectId — truthy, but with no originalName.
      // Dropping it emptied the database side, so every real file on disk was
      // reported as untracked.
      const result = getAdditionalFilesStatus(
        [{ _id: new mongoose.Types.ObjectId(), file: new mongoose.Types.ObjectId() }],
        ["a.pdf"],
      );

      expect(result.unresolved).toHaveLength(1);
      expect(result.status).toBe("MISMATCH");
    });

    test("reports a record whose file document has been deleted", () => {
      // Otherwise a broken record looks like a stray file on disk.
      const result = getAdditionalFilesStatus(
        [{ _id: new mongoose.Types.ObjectId(), file: null }],
        [],
      );

      expect(result.unresolved).toHaveLength(1);
      expect(result.message).toMatch(/no readable filename/);
    });

    test("does not count an unresolved record as a file on disk", () => {
      const result = getAdditionalFilesStatus(
        [populated("a.pdf"), { _id: new mongoose.Types.ObjectId(), file: null }],
        ["a.pdf"],
      );

      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
    });
  });

  describe("input shapes", () => {
    test("accepts a bare file document", () => {
      const result = getAdditionalFilesStatus(
        [{ originalName: "a.pdf" }],
        ["a.pdf"],
      );

      expect(result.status).toBe("OK");
    });

    test("accepts plain filename strings", () => {
      expect(getAdditionalFilesStatus(["a.pdf"], ["a.pdf"]).status).toBe("OK");
    });

    test("tolerates a virtual that was never populated", () => {
      // An unpopulated virtual is undefined, and throwing here turned a
      // working GET into a 500.
      expect(() => getAdditionalFilesStatus(undefined, ["a.pdf"])).not.toThrow();
      expect(getAdditionalFilesStatus(undefined, ["a.pdf"]).extra).toEqual([
        "a.pdf",
      ]);
    });

    test("tolerates a missing directory listing", () => {
      expect(() => getAdditionalFilesStatus([populated("a.pdf")])).not.toThrow();
    });
  });
});

describe("compareFilesToDirectory", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-compare-"));
    fs.writeFileSync(_path.join(tmpDir, "a.pdf"), "a");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns the listing alongside the status", async () => {
    const result = await compareFilesToDirectory(
      [{ originalName: "a.pdf" }],
      tmpDir,
    );

    expect(result.actualFiles).toEqual(["a.pdf"]);
    expect(result.status.status).toBe("OK");
  });

  test("treats a missing directory as no files", async () => {
    const result = await compareFilesToDirectory(
      [{ originalName: "a.pdf" }],
      _path.join(tmpDir, "does-not-exist"),
    );

    expect(result.status.status).toBe("MISMATCH");
    expect(result.status.missing).toEqual(["a.pdf"]);
  });

  test("degrades to UNKNOWN rather than failing the request", async () => {
    // These checks were added to endpoints that previously did no filesystem
    // work; an unreachable datastore must not turn a working GET into a 500.
    const notADirectory = _path.join(tmpDir, "a.pdf");

    const result = await compareFilesToDirectory([], notADirectory);

    expect(result.status.status).toBe("UNKNOWN");
    expect(result.actualFiles).toEqual([]);
  });
});
