/**
 * Tests for routes/directory-files.js
 *
 * Runs against a real temporary directory so the containment checks on
 * /directory-files and /directory-files/verify-md5 are exercised properly.
 */

const request = require("supertest");
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const _path = require("path");

let mockUser = { username: "testuser", groups: [], isAdmin: false };

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  isAdmin: (req, res, next) => {
    if (req.user && req.user.isAdmin) {
      return next();
    }
    return res.status(403).send({ error: "Admin access required" });
  },
}));

const directoryFilesRouter = require("../../routes/directory-files");

let tmpRoot;
let transferDir;
const FILE_CONTENT = "ACGTACGT";
const FILE_MD5 = crypto.createHash("md5").update(FILE_CONTENT).digest("hex");
const ORIGINAL_HPC = process.env.HPC_TRANSFER_DIRECTORY;

const app = express();
app.use(express.json());
app.use("/", directoryFilesRouter);

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-dirfiles-"));
  transferDir = _path.join(tmpRoot, "transfer");
  fs.mkdirSync(_path.join(transferDir, "batch1"), { recursive: true });
  fs.writeFileSync(_path.join(transferDir, "batch1", "reads.txt"), FILE_CONTENT);
  fs.mkdirSync(_path.join(transferDir, "empty"), { recursive: true });

  fs.writeFileSync(_path.join(tmpRoot, "secret.txt"), "TOP SECRET");
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (ORIGINAL_HPC === undefined) {
    delete process.env.HPC_TRANSFER_DIRECTORY;
  } else {
    process.env.HPC_TRANSFER_DIRECTORY = ORIGINAL_HPC;
  }
});

beforeEach(() => {
  process.env.HPC_TRANSFER_DIRECTORY = transferDir;
  mockUser = { username: "testuser", groups: [], isAdmin: false };
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /directory-files", () => {
  test("lists the files in a directory", async () => {
    const response = await request(app)
      .get("/directory-files")
      .query({ targetDirectoryName: "batch1" });

    expect(response.status).toBe(200);
    expect(response.body.filesResults).toEqual(["reads.txt"]);
  });

  test("reports an empty directory", async () => {
    const response = await request(app)
      .get("/directory-files")
      .query({ targetDirectoryName: "empty" });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe("No files found in target directory");
  });

  test("reports a missing directory", async () => {
    const response = await request(app)
      .get("/directory-files")
      .query({ targetDirectoryName: "does-not-exist" });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe("Issue reading target directory");
  });

  describe("refuses to fall back to the transfer root", () => {
    // An empty or unusable directory name resolves to the root itself, which
    // would disclose every group's inbound directory to any authenticated user.
    test("rejects a missing targetDirectoryName", async () => {
      const response = await request(app).get("/directory-files");

      expect(response.body.filesResults).toBeUndefined();
      expect(response.body.error).toMatch(/Missing targetDirectoryName/);
    });

    test("rejects an empty targetDirectoryName", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "" });

      expect(response.body.filesResults).toBeUndefined();
    });

    test("rejects a targetDirectoryName of only slashes", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "///" });

      expect(response.body.filesResults).toBeUndefined();
      expect(response.body.error).toMatch(/Missing targetDirectoryName/);
    });

    test("rejects a repeated targetDirectoryName parameter", async () => {
      const response = await request(app).get(
        "/directory-files?targetDirectoryName=a&targetDirectoryName=b",
      );

      expect(response.body.filesResults).toBeUndefined();
    });

    // Names that normalise back to the root pass a plain containment check.
    test.each([["."], ["./"], ["/./"], ["a/.."], ["batch1/.."], [" . "]])(
      "rejects targetDirectoryName %p",
      async (targetDirectoryName) => {
        const response = await request(app)
          .get("/directory-files")
          .query({ targetDirectoryName });

        expect(response.body.filesResults).toBeUndefined();
        expect(response.text).not.toContain("batch1");
      },
    );
  });

  describe("path traversal is refused", () => {
    test("rejects ../ escaping the transfer directory", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: ".." });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Access denied/);
    });

    test("does not list an absolute directory outside the root", async () => {
      // The original code called path.resolve(root, name) with no containment
      // check; path.resolve discards the root when given an absolute segment,
      // so this listed the caller's chosen directory. The leading slash is now
      // stripped first, which reduces it to a harmless relative lookup inside
      // the transfer directory.
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: tmpRoot });

      expect(response.body.filesResults).toBeUndefined();
      expect(response.body.error).toBeDefined();
      expect(response.text).not.toContain("secret.txt");
    });
  });

  test("reports when HPC_TRANSFER_DIRECTORY is not configured", async () => {
    delete process.env.HPC_TRANSFER_DIRECTORY;

    const response = await request(app)
      .get("/directory-files")
      .query({ targetDirectoryName: "batch1" });

    expect(response.status).toBe(200);
    expect(response.body.error).toMatch(/not configured/);
  });
});

describe("GET /directory-files/debug", () => {
  test("is refused for a non-admin user", async () => {
    const response = await request(app)
      .get("/directory-files/debug")
      .query({ targetDirectoryName: "batch1" });

    expect(response.status).toBe(403);
    // The response must not disclose server paths.
    expect(response.body.HPC_TRANSFER_DIRECTORY).toBeUndefined();
    expect(response.body.cwd).toBeUndefined();
  });

  test("returns diagnostics for an admin user", async () => {
    mockUser = { username: "admin", groups: [], isAdmin: true };

    const response = await request(app)
      .get("/directory-files/debug")
      .query({ targetDirectoryName: "batch1" });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
    expect(response.body.isDirectory).toBe(true);
    expect(response.body.withinTransferDirectory).toBe(true);
  });

  test("flags a path outside the transfer directory for an admin", async () => {
    mockUser = { username: "admin", groups: [], isAdmin: true };

    const response = await request(app)
      .get("/directory-files/debug")
      .query({ targetDirectoryName: "../.." });

    expect(response.status).toBe(200);
    expect(response.body.withinTransferDirectory).toBe(false);
    expect(response.body.dirRoot).toBeNull();
  });
});

describe("POST /directory-files/verify-md5", () => {
  test("reports a matching checksum", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: "reads.txt",
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(200);
    expect(response.body.matches).toBe(true);
    expect(response.body.calculatedMd5).toBe(FILE_MD5);
  });

  test("normalises the expected checksum before comparing", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: "reads.txt",
        expectedMd5: `  ${FILE_MD5.toUpperCase()}  `,
      });

    expect(response.status).toBe(200);
    expect(response.body.matches).toBe(true);
  });

  test("reports a mismatching checksum", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: "reads.txt",
        expectedMd5: "0".repeat(32),
      });

    expect(response.status).toBe(200);
    expect(response.body.matches).toBe(false);
  });

  test("rejects a missing field", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({ directoryName: "batch1", fileName: "reads.txt" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required fields/);
  });

  test("rejects a non-string expectedMd5", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: "reads.txt",
        expectedMd5: { evil: true },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/must be strings/);
  });

  test("rejects a non-string directoryName rather than resolving to the root", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: { evil: true },
        fileName: "reads.txt",
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(400);
    expect(response.body.calculatedMd5).toBeUndefined();
  });

  test("rejects a non-string fileName", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: { evil: true },
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(400);
  });

  test("returns 404 for a missing file", async () => {
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "batch1",
        fileName: "nope.txt",
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(404);
  });

  describe("path traversal is refused", () => {
    test("rejects traversal in the directory name", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "..",
          fileName: "secret.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(403);
    });

    test("rejects traversal in the file name", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "../../secret.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(403);
    });

    test("rejects a directoryName that normalises back to the root", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: ".",
          fileName: "batch1",
          expectedMd5: FILE_MD5,
        });

      expect(response.body.calculatedMd5).toBeUndefined();
      expect([403, 404]).toContain(response.status);
    });

    test("rejects a sibling directory sharing the root's prefix", async () => {
      // The previous `startsWith(hpcRoot)` check accepted "<root>-evil".
      fs.mkdirSync(`${transferDir}-evil`, { recursive: true });
      fs.writeFileSync(_path.join(`${transferDir}-evil`, "evil.txt"), "EVIL");

      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "../transfer-evil",
          fileName: "evil.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(403);
    });
  });
});
