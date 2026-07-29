/**
 * Tests for routes/_utils.js — the shared error responder and directory reader.
 */

const fs = require("fs");
const os = require("os");
const _path = require("path");

const {
  handleError,
  getActualFiles,
  generateRequestId,
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
});
