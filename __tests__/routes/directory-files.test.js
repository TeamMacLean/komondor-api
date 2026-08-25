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

let mockUser = { username: "testuser", groups: ["group1"], isAdmin: false };

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


// The HPC read endpoints now also require membership of at least one group
// (lib/utils/hpcAudit.js). These tests are about path containment, not
// membership, so grant it by default; the refusal has its own test below.

const { AUDIT_PREFIX } = require("../../lib/utils/hpcAudit");
const directoryFilesRouter = require("../../routes/directory-files");

let tmpRoot;
let transferDir;
let outsideDir;
let linkRootStorage;
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

  // Symlinks planted inside the transfer directory. Unprivileged HPC users
  // write into this directory by design (the "hpc-mv" upload method), so they
  // can create these; every lexical containment check passes on them.
  outsideDir = _path.join(tmpRoot, "outside");
  fs.mkdirSync(_path.join(outsideDir, "inner"), { recursive: true });
  fs.writeFileSync(_path.join(outsideDir, "outside-marker.txt"), "OUTSIDE");
  fs.writeFileSync(
    _path.join(outsideDir, "inner", "deep-marker.txt"),
    FILE_CONTENT,
  );

  const linkFarm = _path.join(transferDir, "linkfarm");
  fs.mkdirSync(linkFarm, { recursive: true });
  // A link to a directory outside the root.
  fs.symlinkSync(outsideDir, _path.join(linkFarm, "outsidedir"));
  // A link to a file outside the root.
  fs.symlinkSync(
    _path.join(tmpRoot, "secret.txt"),
    _path.join(linkFarm, "leak.txt"),
  );
  // A link whose target does not exist.
  fs.symlinkSync(
    _path.join(tmpRoot, "no-such-target"),
    _path.join(linkFarm, "dangling"),
  );
  // A link to a directory that really is inside the root. assertWithinReal
  // vouches for it, so the listing now follows it (see the "symlinked
  // directories are followed" tests below) rather than refusing it as a
  // symlinked leaf.
  fs.symlinkSync(
    _path.join(transferDir, "batch1"),
    _path.join(linkFarm, "inside"),
  );
  // A link to a *file* that really is inside the root. Every containment check
  // passes on it — realpath lands under the root — so O_NOFOLLOW on the open is
  // the only thing that refuses it, and that is what this fixture exists to
  // pin. See the verify-md5 leaf-symlink test.
  fs.symlinkSync(
    _path.join(transferDir, "batch1", "reads.txt"),
    _path.join(linkFarm, "insidefile.txt"),
  );

  // An operator-configured storage root (ALLOWED_LINK_ROOTS), entirely outside
  // the transfer directory, holding a whole project directory symlinked in —
  // the "projectdir/big2.fastq" case BREAKING_CHANGES.md entry 34 documents.
  linkRootStorage = _path.join(tmpRoot, "storage-root");
  fs.mkdirSync(_path.join(linkRootStorage, "project1"), { recursive: true });
  fs.writeFileSync(
    _path.join(linkRootStorage, "project1", "big2.fastq"),
    FILE_CONTENT,
  );
  fs.symlinkSync(
    _path.join(linkRootStorage, "project1"),
    _path.join(linkFarm, "projectdir"),
  );
  // A link to a *file* landing directly inside the ALLOWED_LINK_ROOTS entry —
  // the literal "symlink -> large file on scratch storage" case the audit
  // named, as opposed to insidefile.txt above (a leaf symlink landing inside
  // the transfer directory itself). See the verify-md5 leaf-symlink tests.
  fs.symlinkSync(
    _path.join(linkRootStorage, "project1", "big2.fastq"),
    _path.join(linkFarm, "big2link.fastq"),
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
  mockUser = { username: "testuser", groups: ["group1"], isAdmin: false };
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

  describe("symlink escapes are refused", () => {
    // The containment check used to be purely lexical, so fs.readdir followed
    // any link planted in the drop directory and listed wherever it pointed.
    test("refuses a symlink to a directory outside the root", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/outsidedir" });

      expect(response.body.filesResults).toBeUndefined();
      expect(response.text).not.toContain("outside-marker.txt");
    });

    test("refuses a directory beneath a symlinked ancestor", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/outsidedir/inner" });

      expect(response.body.filesResults).toBeUndefined();
      expect(response.text).not.toContain("deep-marker.txt");
    });

    test("refuses a dangling symlink", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/dangling" });

      expect(response.body.filesResults).toBeUndefined();
    });
  });

  describe("symlinked directories are followed once assertWithinReal has vouched for them", () => {
    // fs.lstat used to refuse a symlinked leaf outright, even when its real
    // target was already proven safe. By the time dirExists is checked,
    // assertWithinReal has already validated that the target is either inside
    // the guarded root or inside a configured ALLOWED_LINK_ROOTS entry — there
    // is no containment reason left to refuse the final stat, only to follow
    // it. See BREAKING_CHANGES.md entry 34.
    const ORIGINAL_ALLOWED_LINK_ROOTS = process.env.ALLOWED_LINK_ROOTS;

    afterEach(() => {
      if (ORIGINAL_ALLOWED_LINK_ROOTS === undefined) {
        delete process.env.ALLOWED_LINK_ROOTS;
      } else {
        process.env.ALLOWED_LINK_ROOTS = ORIGINAL_ALLOWED_LINK_ROOTS;
      }
    });

    test("lists a symlinked directory whose real target is inside the guarded root", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/inside" });

      expect(response.status).toBe(200);
      expect(response.body.filesResults).toEqual(["reads.txt"]);
    });

    test("lists a symlinked project directory landing inside a configured ALLOWED_LINK_ROOTS entry", async () => {
      process.env.ALLOWED_LINK_ROOTS = linkRootStorage;

      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/projectdir" });

      expect(response.status).toBe(200);
      expect(response.body.filesResults).toEqual(["big2.fastq"]);
    });

    test("still refuses a symlinked directory outside every permitted root, even with ALLOWED_LINK_ROOTS configured", async () => {
      // Must not regress: a permitted root elsewhere does not widen containment
      // for a link that lands outside every configured root.
      process.env.ALLOWED_LINK_ROOTS = linkRootStorage;

      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/outsidedir" });

      expect(response.body.filesResults).toBeUndefined();
      expect(response.text).not.toContain("outside-marker.txt");
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

  test("flags a symlink that escapes the transfer directory", async () => {
    // The diagnostic answers "does this name resolve inside the root?", and a
    // lexical-only answer says yes for a planted symlink. A diagnostic that
    // lies about containment is how the read paths came to be trusted.
    mockUser = { username: "admin", groups: [], isAdmin: true };

    const response = await request(app)
      .get("/directory-files/debug")
      .query({ targetDirectoryName: "linkfarm/outsidedir" });

    expect(response.status).toBe(200);
    expect(response.body.withinTransferDirectory).toBe(false);
    expect(response.body.isSymbolicLink).toBe(true);
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

    test("refuses a symlinked file pointing outside the root", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "linkfarm",
          fileName: "leak.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.body.calculatedMd5).toBeUndefined();
      expect([403, 404]).toContain(response.status);
    });

    test("refuses a real file beneath a symlinked ancestor", async () => {
      // The MD5 of the file outside the root matches FILE_MD5 exactly, so a
      // "matches: true" answer here is proof the endpoint read it.
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "linkfarm/outsidedir/inner",
          fileName: "deep-marker.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.body.calculatedMd5).toBeUndefined();
      expect(response.body.matches).toBeUndefined();
      expect([403, 404]).toContain(response.status);
    });

    test("refuses a dangling symlink", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "linkfarm",
          fileName: "dangling",
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
describe("POST /directory-files/verify-md5 follows a symlinked leaf once assertWithinReal has vouched for it", () => {
  // O_NOFOLLOW used to make ELOOP on a symlinked leaf indistinguishable from
  // "file not found", even when assertWithinReal (above, in "path traversal is
  // refused") had already resolved the same leaf fully and proved its target
  // sits inside the transfer directory or a configured ALLOWED_LINK_ROOTS
  // entry. See BREAKING_CHANGES.md entry 34: the handler now reopens the
  // realpath'd target, itself with O_NOFOLLOW, instead of refusing outright —
  // a match:true answer here is proof the link was followed, since FILE_MD5
  // is the hash of the target's real content, not of the link itself.
  const ORIGINAL_ALLOWED_LINK_ROOTS = process.env.ALLOWED_LINK_ROOTS;

  afterEach(() => {
    if (ORIGINAL_ALLOWED_LINK_ROOTS === undefined) {
      delete process.env.ALLOWED_LINK_ROOTS;
    } else {
      process.env.ALLOWED_LINK_ROOTS = ORIGINAL_ALLOWED_LINK_ROOTS;
    }
  });

  test("follows a symlink to a file that really is inside the root", async () => {
    // assertWithinReal is satisfied here: the link's realpath is
    // <root>/batch1/reads.txt, comfortably under the root.
    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "linkfarm",
        fileName: "insidefile.txt",
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(200);
    expect(response.body.calculatedMd5).toBe(FILE_MD5);
    expect(response.body.matches).toBe(true);
  });

  test("follows a symlink to a file landing inside a configured ALLOWED_LINK_ROOTS entry", async () => {
    process.env.ALLOWED_LINK_ROOTS = linkRootStorage;

    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "linkfarm",
        fileName: "big2link.fastq",
        expectedMd5: FILE_MD5,
      });

    expect(response.status).toBe(200);
    expect(response.body.calculatedMd5).toBe(FILE_MD5);
    expect(response.body.matches).toBe(true);
  });

  test("still refuses a symlinked leaf outside every permitted root, even with ALLOWED_LINK_ROOTS configured", async () => {
    // Must not regress: a permitted root elsewhere does not widen containment
    // for a link that lands outside every configured root.
    process.env.ALLOWED_LINK_ROOTS = linkRootStorage;

    const response = await request(app)
      .post("/directory-files/verify-md5")
      .send({
        directoryName: "linkfarm",
        fileName: "leak.txt",
        expectedMd5: FILE_MD5,
      });

    expect(response.body.calculatedMd5).toBeUndefined();
    expect(response.body.matches).toBeUndefined();
    expect([403, 404]).toContain(response.status);
  });
});

describe("group membership is required", () => {
  // requireHpcGroupAccess reads req.user.groups from the JWT claim rather than
  // querying live membership (removed in 366f656 as disproportionate). A
  // caller LDAP handed back with groups: [] — misconfigured, or never assigned
  // to one — is otherwise indistinguishable from a properly-provisioned one.
  describe("GET /directory-files", () => {
    test("refuses a caller with no group membership and no elevated access", async () => {
      mockUser = { username: "testuser", groups: [], isAdmin: false };

      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "batch1" });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("You do not belong to any group");
      expect(response.body.filesResults).toBeUndefined();
    });

    test("passes an admin with an empty groups array", async () => {
      mockUser = { username: "admin", groups: [], isAdmin: true };

      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "batch1" });

      expect(response.status).toBe(200);
      expect(response.body.filesResults).toEqual(["reads.txt"]);
    });

    test("passes a normal user with real group membership", async () => {
      mockUser = { username: "testuser", groups: ["group1"], isAdmin: false };

      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "batch1" });

      expect(response.status).toBe(200);
      expect(response.body.filesResults).toEqual(["reads.txt"]);
    });
  });

  describe("POST /directory-files/verify-md5", () => {
    test("refuses a caller with no group membership and no elevated access", async () => {
      mockUser = { username: "testuser", groups: [], isAdmin: false };

      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "reads.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("You do not belong to any group");
      expect(response.body.calculatedMd5).toBeUndefined();
    });

    test("passes an admin with an empty groups array", async () => {
      mockUser = { username: "admin", groups: [], isAdmin: true };

      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "reads.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(200);
      expect(response.body.matches).toBe(true);
    });

    test("passes a normal user with real group membership", async () => {
      mockUser = { username: "testuser", groups: ["group1"], isAdmin: false };

      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "reads.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(200);
      expect(response.body.matches).toBe(true);
    });
  });
});

describe("HPC staging endpoints leave an audit trail", () => {
  // The shared inbox cannot authorise any of these reads
  // (BREAKING_CHANGES.md entry 32), so the audit line is the compensating
  // control rather than a nicety. Nothing bound it to these call sites before:
  // every auditHpcAccess call could be deleted with the suite still green.
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  const auditLines = () =>
    logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === "string" && line.includes(AUDIT_PREFIX));

  describe("GET /directory-files", () => {
    test("emits exactly one line naming the caller and the resolved directory", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "batch1" });

      expect(response.status).toBe(200);

      const lines = auditLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        `${AUDIT_PREFIX} action="list" user="testuser" ` +
          `path=${JSON.stringify(_path.join(transferDir, "batch1"))} ` +
          `outcome="ok" detail="files=1"`,
      );
    });

    test("does not claim a listing that was refused", async () => {
      const response = await request(app)
        .get("/directory-files")
        .query({ targetDirectoryName: "linkfarm/outsidedir" });

      expect(response.body.filesResults).toBeUndefined();
      expect(auditLines()).toHaveLength(0);
    });
  });

  describe("POST /directory-files/verify-md5", () => {
    test("emits exactly one line naming the caller and the resolved file", async () => {
      // This endpoint reads every byte of any file in any group's staging
      // directory and emitted nothing at all, though this module's own header
      // promises a line for "md5".
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "reads.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.status).toBe(200);

      const lines = auditLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('action="md5"');
      expect(lines[0]).toContain('user="testuser"');
      expect(lines[0]).toContain(
        `path=${JSON.stringify(_path.join(transferDir, "batch1", "reads.txt"))}`,
      );
      expect(lines[0]).toMatch(/detail="requestId=[^"]+"/);
    });

    test("records the read even when the checksum does not match", async () => {
      // The record is of the *read*, not of the verdict: a caller hashing
      // another group's file learns its checksum whatever answer comes back.
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "reads.txt",
          expectedMd5: "0".repeat(32),
        });

      expect(response.body.matches).toBe(false);
      expect(auditLines()).toHaveLength(1);
    });

    test("does not claim a read that was refused for path containment", async () => {
      const response = await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "linkfarm",
          fileName: "leak.txt",
          expectedMd5: FILE_MD5,
        });

      expect(response.body.calculatedMd5).toBeUndefined();
      expect(auditLines()).toHaveLength(0);
    });

    test("does not claim a read of a file that does not exist", async () => {
      await request(app)
        .post("/directory-files/verify-md5")
        .send({
          directoryName: "batch1",
          fileName: "nope.txt",
          expectedMd5: FILE_MD5,
        });

      expect(auditLines()).toHaveLength(0);
    });
  });
});
