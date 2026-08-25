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

const { AUDIT_PREFIX } = require("../../lib/utils/hpcAudit");

// A filename carrying a newline plus a complete, well-formed audit record that
// attributes a cross-group claim to a colleague. No "/" anywhere in it: a
// POSIX filename cannot hold one, so this is the exact shape of record an
// attacker can actually plant through this vector, and it is still a whole
// record — action, user, path and outcome all present and correctly quoted.
const INJECTED_NAME =
  `note.txt\n${AUDIT_PREFIX} action="claim" user="alice" ` +
  `path="PATIENT_R1.fastq.gz" outcome="ok"`;

// The same attack without a control character in it. safePath now refuses the
// name above outright, so it never reaches the audit sink — but a double quote
// is not a control character and is a perfectly legal POSIX filename byte, so
// this one still travels the whole way. It closes the `path="…"` field early
// and opens fields of its own, which is enough to make a line say something
// other than what happened even without a second record.
const QUOTE_INJECTED_NAME = 'note.txt" user="alice" outcome="ok';
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

  // A real file whose *name* carries a newline and a synthetic audit record.
  // POSIX permits this, HPC_TRANSFER_DIRECTORY is writable by unprivileged
  // users by design, and none of the path cleaners strip an interior newline —
  // so this is exactly what an attacker plants to forge the trail.
  fs.mkdirSync(_path.join(transferDir, "inject"), { recursive: true });
  fs.writeFileSync(_path.join(transferDir, "inject", INJECTED_NAME), "PAYLOAD");
  fs.writeFileSync(
    _path.join(transferDir, "inject", QUOTE_INJECTED_NAME),
    "QUOTED",
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

describe("GET /read-file audit trail", () => {
  // The shared inbox cannot authorise a read (BREAKING_CHANGES.md entry 32),
  // so the audit line is not decoration around the endpoint — it is the whole
  // compensating control. Nothing bound it to the call site before, and every
  // auditHpcAccess call could be deleted with the suite still green.
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  const auditLines = () =>
    logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === "string" && line.includes(AUDIT_PREFIX));

  test("emits exactly one line naming the caller and the resolved path", async () => {
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "batch1", filename: "reads.txt" });

    expect(response.status).toBe(200);

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `${AUDIT_PREFIX} action="read" user="testuser" ` +
        `path=${JSON.stringify(_path.join(transferDir, "batch1", "reads.txt"))} ` +
        `outcome="ok"`,
    );
  });

  test("names the resolved path, not the name the caller typed", async () => {
    // "/batch1/" and "batch1" address the same file; the trail has to record
    // where the read landed, because that is what an operator compares against
    // another group's directory after the fact.
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "/batch1/", filename: "/reads.txt" });

    expect(response.status).toBe(200);
    expect(auditLines()).toHaveLength(1);
    expect(auditLines()[0]).toContain(
      `path=${JSON.stringify(_path.join(transferDir, "batch1", "reads.txt"))}`,
    );
  });

  test("records a read from the transfer root itself", async () => {
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: ".", filename: "top-level.txt" });

    expect(response.status).toBe(200);
    expect(response.text).toBe("top level");
    expect(auditLines()).toHaveLength(1);
    expect(auditLines()[0]).toContain(
      `path=${JSON.stringify(_path.join(transferDir, "top-level.txt"))}`,
    );
  });

  test("does not claim a read that was refused", async () => {
    // A trail that records reads which never happened is as useless as one
    // that misses reads that did.
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "linkfarm", filename: "leak.txt" });

    expect(response.status).toBe(403);
    expect(auditLines()).toHaveLength(0);
  });

  test("does not claim a read of a file that does not exist", async () => {
    await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "batch1", filename: "nope.txt" });

    expect(auditLines()).toHaveLength(0);
  });

  test("does not claim a read of a file refused for its size", async () => {
    // The refusal happens after the file is opened, which is the point in the
    // handler most likely to grow an audit call that fires too early.
    const bigPath = _path.join(transferDir, "batch1", "audit-big.txt");
    fs.writeFileSync(bigPath, Buffer.alloc(5 * 1024 * 1024 + 1, "a"));

    try {
      const response = await request(app)
        .get("/read-file")
        .query({ targetDirectoryName: "batch1", filename: "audit-big.txt" });

      expect(response.body.error).toMatch(/too large/);
      expect(auditLines()).toHaveLength(0);
    } finally {
      fs.unlinkSync(bigPath);
    }
  });

  test("records the caller who was actually authenticated", async () => {
    // Attribution is the control; a line naming the wrong person is worse than
    // no line, because it points an investigation at a colleague.
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "batch1", filename: "reads.txt" });

    expect(response.status).toBe(200);
    expect(auditLines()[0]).toContain('user="testuser"');
    expect(auditLines()[0]).not.toContain('user="unknown"');
  });
});

describe("GET /read-file cannot be used to forge the audit trail", () => {
  // Executed end-to-end rather than against the formatter alone: the point of
  // the finding was that the hostile value reaches the sink from a real file on
  // a real disk through cleanDirectoryName and resolveBelow, neither of which
  // strips an interior newline.
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  const auditLines = () =>
    logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === "string" && line.includes(AUDIT_PREFIX));

  test("a newline in the filename is refused before anything is read", async () => {
    // This used to assert a 200 and `response.text === "PAYLOAD"`: the read was
    // legitimate — the file really is inside the root — and only the *record*
    // of it had to be unforgeable. safePath now refuses a control character in
    // a name outright, so the request no longer gets as far as the disk. That
    // is the stronger outcome: the value cannot reach the audit sink, the
    // unescaped console.error diagnostics, or `File.name` downstream.
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "inject", filename: INJECTED_NAME });

    // This route reports failure in the body, not the status code — consuming
    // services detect it by the presence of `error` (see the catch in
    // routes/read-file.js), so a refusal is still a 200.
    expect(response.body.error).toBeTruthy();
    expect(response.text).not.toContain("PAYLOAD");
    // The refusal message names no user input, so it cannot be split either:
    // the raw filename is interpolated into the *other* console.error refusals
    // in this route, which is half of why the control character is stopped
    // before it gets that far.
    expect(response.body.error).not.toContain("\n");

    // Nothing was read, so nothing claims a read happened — a forged record
    // cannot be planted by a request that was refused either.
    expect(auditLines().filter((line) => line.includes('action="read"'))).toHaveLength(
      0,
    );
    auditLines().forEach((line) => {
      expect(line.split("\n")).toHaveLength(1);
      expect(line).not.toContain('user="alice"');
    });
  });

  test("a quote in the filename yields one record, not a rewritten one", async () => {
    // The escaping is still what holds the line together, and this proves it
    // end-to-end rather than against the formatter alone. A double quote is a
    // legal filename byte and not a control character, so it passes every
    // cleaner and reaches the sink exactly as the newline used to.
    const response = await request(app)
      .get("/read-file")
      .query({ targetDirectoryName: "inject", filename: QUOTE_INJECTED_NAME });

    expect(response.status).toBe(200);
    expect(response.text).toBe("QUOTED");

    expect(auditLines()).toHaveLength(1);
    const line = auditLines()[0];
    expect(line.split("\n")).toHaveLength(1);
    expect(/[\u0000-\u001f]/.test(line)).toBe(false);
    // The real caller is named exactly once, and it is not the colleague the
    // injected fields blame.
    expect(line.match(/ user="/g)).toHaveLength(1);
    expect(line).toContain('user="testuser"');
    expect(line).not.toContain('user="alice"');
    expect(line).toBe(
      `${AUDIT_PREFIX} action="read" user="testuser" ` +
        `path=${JSON.stringify(_path.join(transferDir, "inject", QUOTE_INJECTED_NAME))} ` +
        `outcome="ok"`,
    );
  });
});
