/**
 * Tests for routes/read-file.js
 *
 * Exercises the endpoint against a real temporary directory tree so the path
 * containment checks are verified against real filesystem behaviour rather
 * than a mock.
 */

const request = require("supertest");
const express = require("express");
const fs = require("fs");
const os = require("os");
const _path = require("path");

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "testuser", groups: [] };
    next();
  },
  isAdmin: (req, res, next) => next(),
}));


// The HPC read endpoints now also require membership of at least one group
// (lib/utils/hpcAudit.js). These tests are about path containment, not
// membership, so grant it by default; the refusal has its own test below.
jest.mock("../../lib/utils/groupAccess", () => ({
  groupsICanRead: jest.fn().mockResolvedValue([{ _id: "group-1" }]),
}));
const { groupsICanRead } = require("../../lib/utils/groupAccess");

const readFileRouter = require("../../routes/read-file");

let tmpRoot;
let transferDir;
let secretPath;
let outsideDir;
let linkFarm;
const ORIGINAL_HPC = process.env.HPC_TRANSFER_DIRECTORY;

const app = express();
app.use(express.json());
app.use("/", readFileRouter);

beforeAll(() => {
  // tmpRoot/
  //   transfer/            <- HPC_TRANSFER_DIRECTORY
  //     batch1/reads.txt
  //   secret.txt           <- must never be readable
  tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-readfile-"));
  transferDir = _path.join(tmpRoot, "transfer");
  fs.mkdirSync(_path.join(transferDir, "batch1"), { recursive: true });
  fs.writeFileSync(
    _path.join(transferDir, "batch1", "reads.txt"),
    "ACGT contents",
  );
  fs.writeFileSync(_path.join(transferDir, "top-level.txt"), "top level");

  secretPath = _path.join(tmpRoot, "secret.txt");
  fs.writeFileSync(secretPath, "TOP SECRET");

  // A sibling whose name shares the transfer directory's prefix.
  fs.mkdirSync(_path.join(tmpRoot, "transfer-evil"), { recursive: true });
  fs.writeFileSync(_path.join(tmpRoot, "transfer-evil", "evil.txt"), "EVIL");

  // Symlinks planted inside the transfer directory. This is the real threat
  // model: the transfer directory is the drop box unprivileged lab users write
  // into for the "hpc-mv" upload method, so anyone with a shell on the HPC box
  // can create these. Every lexical containment check passes on them.
  outsideDir = _path.join(tmpRoot, "outside");
  fs.mkdirSync(_path.join(outsideDir, "inner"), { recursive: true });
  fs.writeFileSync(_path.join(outsideDir, "outside.txt"), "OUTSIDE PAYLOAD");
  fs.writeFileSync(_path.join(outsideDir, "inner", "deep.txt"), "DEEP PAYLOAD");

  linkFarm = _path.join(transferDir, "linkfarm");
  fs.mkdirSync(linkFarm, { recursive: true });
  // A link to a file outside the root.
  fs.symlinkSync(secretPath, _path.join(linkFarm, "leak.txt"));
  // A link to a directory outside the root.
  fs.symlinkSync(outsideDir, _path.join(linkFarm, "outsidedir"));
  // A link whose target does not exist.
  fs.symlinkSync(
    _path.join(tmpRoot, "no-such-target.txt"),
    _path.join(linkFarm, "dangling.txt"),
  );
  // A link to a file that really is inside the root: still a symlink at the
  // leaf, so the read must not follow it either.
  fs.symlinkSync(
    _path.join(transferDir, "batch1", "reads.txt"),
    _path.join(linkFarm, "inside.txt"),
  );
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
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /read-file", () => {
  describe("successful reads", () => {
    test("returns the contents of a file in a subdirectory", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "reads.txt" });

      expect(response.status).toBe(200);
      expect(response.text).toBe("ACGT contents");
    });

    test("tolerates leading and trailing slashes in the directory name", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "/batch1/", filename: "reads.txt" });

      expect(response.status).toBe(200);
      expect(response.text).toBe("ACGT contents");
    });

    test("tolerates a leading slash on the filename", async () => {
      // path.join treated a leading slash as a plain separator, so callers
      // that pass "/reads.txt" worked before and must keep working.
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "/reads.txt" });

      expect(response.status).toBe(200);
      expect(response.text).toBe("ACGT contents");
    });
  });

  describe("path traversal is refused", () => {
    test("rejects ../ escaping the transfer directory", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "..", filename: "secret.txt" });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Access denied/);
      expect(response.text).not.toContain("TOP SECRET");
    });

    test("rejects traversal embedded in the filename", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "../../secret.txt" });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("TOP SECRET");
    });

    test("does not read an absolute filename pointing outside the root", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: secretPath });

      expect(response.text).not.toContain("TOP SECRET");
      expect(response.body.error).toBeDefined();
    });

    test("rejects a sibling directory sharing the root's prefix", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({
          targetDirectoryName: "../transfer-evil",
          filename: "evil.txt",
        });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("EVIL");
    });
  });

  describe("symlink escapes are refused", () => {
    // The containment check used to be purely lexical, so fs.stat and
    // fs.readFile happily followed any link planted in the drop directory and
    // the endpoint returned whatever it pointed at.
    test("refuses a symlink to a file outside the root", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "linkfarm", filename: "leak.txt" });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("TOP SECRET");
    });

    test("refuses a symlink to a directory outside the root", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "linkfarm", filename: "outsidedir" });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("OUTSIDE PAYLOAD");
    });

    test("refuses a real file beneath a symlinked ancestor", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({
          targetDirectoryName: "linkfarm",
          filename: "outsidedir/inner/deep.txt",
        });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("DEEP PAYLOAD");
    });

    test("refuses a symlinked ancestor supplied as the directory name", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({
          targetDirectoryName: "linkfarm/outsidedir",
          filename: "outside.txt",
        });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain("OUTSIDE PAYLOAD");
    });

    test("refuses a dangling symlink", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "linkfarm", filename: "dangling.txt" });

      expect(response.status).toBe(403);
    });

    test("does not follow a symlink at the leaf even when it stays inside the root", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "linkfarm", filename: "inside.txt" });

      expect(response.text).not.toContain("ACGT contents");
      expect(response.body.error).toBeDefined();
    });
  });

  describe("input validation", () => {
    test("reports a missing filename", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1" });

      expect(response.status).toBe(200);
      expect(response.body.error).toMatch(/Missing targetDirectoryName or filename/);
    });

    test("reports a missing targetDirectoryName", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ filename: "reads.txt" });

      expect(response.status).toBe(200);
      expect(response.body.error).toMatch(/Missing targetDirectoryName or filename/);
    });

    test("reports repeated parameters supplied as arrays", async () => {
      const response = await request(app).get(
        "/read-file?targetDirectoryName=a&targetDirectoryName=b&filename=reads.txt",
      );

      expect(response.status).toBe(200);
      expect(response.body.error).toMatch(/must be strings/);
    });

    test("reports a missing file", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "nope.txt" });

      expect(response.status).toBe(200);
      expect(response.body.error).toBe("File does not exist");
    });

    test("reports when the path is a directory rather than a file", async () => {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: ".", filename: "batch1" });

      expect(response.status).toBe(200);
      expect(response.body.error).toBe("Requested path is not a file");
    });

    test("reports when HPC_TRANSFER_DIRECTORY is not configured", async () => {
      delete process.env.HPC_TRANSFER_DIRECTORY;

      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "reads.txt" });

      expect(response.status).toBe(200);
      expect(response.body.error).toMatch(/not configured/);
    });
  });

  describe("size limit", () => {
    test("refuses a file larger than the read limit", async () => {
      const bigName = "big.txt";
      const bigPath = _path.join(transferDir, "batch1", bigName);
      // One byte over the 5 MB limit.
      fs.writeFileSync(bigPath, Buffer.alloc(5 * 1024 * 1024 + 1, "a"));

      try {
        const response = await request(app)
          .get("/read-file")
          .query({ targetDirectoryName: "batch1", filename: bigName });

        expect(response.status).toBe(200);
        expect(response.body.error).toMatch(/too large/);
      } finally {
        fs.unlinkSync(bigPath);
      }
    });
  });
});

describe("GET /read-file group membership", () => {
  afterEach(() => {
    groupsICanRead.mockResolvedValue([{ _id: "group-1" }]);
  });

  test("refuses a caller who belongs to no group", async () => {
    // The staging area is a shared inbox with no group<->directory mapping, so
    // this is the only membership question it can answer. Before it existed,
    // isAuthenticated alone let a groupless principal enumerate every group's
    // inbound files. See BREAKING_CHANGES.md entry 32.
    groupsICanRead.mockResolvedValue([]);

    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "batch1", filename: "readme.txt" });

    expect(response.status).toBe(403);
  });

  test("fails closed when the group lookup errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    groupsICanRead.mockRejectedValue(new Error("mongo down"));

    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "batch1", filename: "readme.txt" });

    expect(response.status).toBe(500);
  });
});
