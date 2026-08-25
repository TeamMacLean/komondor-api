/**
 * Tests for lib/utils/safePath.js
 *
 * These cover the containment rules that protect /read-file, /directory-files
 * and /directory-files/verify-md5 from reading outside the HPC transfer
 * directory.
 */

const fs = require("fs");
const os = require("os");
const _path = require("path");
const {
  cleanDirectoryName,
  isWithin,
  resolveWithin,
  resolveBelow,
  safeBasename,
  resolveWithinReal,
  assertWithinReal,
} = require("../../lib/utils/safePath");

const ROOT = _path.resolve("/hpc/transfer");

describe("cleanDirectoryName", () => {
  test("strips leading slashes", () => {
    expect(cleanDirectoryName("/uploads")).toBe("uploads");
  });

  test("strips trailing slashes", () => {
    expect(cleanDirectoryName("uploads/")).toBe("uploads");
  });

  test("strips repeated leading and trailing slashes", () => {
    expect(cleanDirectoryName("///uploads///")).toBe("uploads");
  });

  test("preserves interior slashes", () => {
    expect(cleanDirectoryName("/a/b/c/")).toBe("a/b/c");
  });

  test("trims surrounding whitespace", () => {
    expect(cleanDirectoryName("  uploads  ")).toBe("uploads");
  });

  test.each([[undefined], [null], [42], [{}], [[]]])(
    "returns empty string for non-string input %p",
    (input) => {
      expect(cleanDirectoryName(input)).toBe("");
    },
  );

  describe("refuses interior control characters", () => {
    // null, not "". Both are falsy, so the callers that test for a usable name
    // are unaffected — but "" is a legitimate value meaning "the root itself"
    // (that is what "/" strips to), and resolveWithin(root, "") resolves to the
    // root and succeeds. Returning "" for a hostile name would therefore turn a
    // refusal into a silent normalisation. null is not a string, so
    // resolveWithin refuses it outright and every consumer fails closed.
    test.each([
      ["a\nb"],
      ["a\rb"],
      ['batch1\n[HPC-AUDIT] action="claim"'],
      ["a\u0000b"],
      ["a\u0001b"],
      ["a\u001bb"],
      ["a\u001fb"],
      ["a\u007fb"],
    ])("returns null for %j", (input) => {
      expect(cleanDirectoryName(input)).toBeNull();
    });

    test("a refused name is refused as a path segment, not read as the root", () => {
      // The distinction "" vs null exists for exactly this: with "" the
      // hostile input would resolve to the root and the request would succeed.
      expect(resolveWithin(ROOT, cleanDirectoryName("a\0b"))).toBeNull();
      expect(resolveWithin(ROOT, cleanDirectoryName("a\nb"))).toBeNull();
      // Contrast: "/" really does mean the root, and still does.
      expect(resolveWithin(ROOT, cleanDirectoryName("/"))).toBe(ROOT);
    });

    test("a newline at either end is still just whitespace to trim", () => {
      // trim() already reaches these, and always has. Only a control character
      // a trim cannot remove is treated as hostile, so the existing tolerance
      // for sloppy input is unchanged.
      expect(cleanDirectoryName("\nuploads\n")).toBe("uploads");
      expect(cleanDirectoryName("\r\n/uploads/\r\n")).toBe("uploads");
    });

    test("a forged audit record cannot survive the cleaner", () => {
      // The concrete attack: HPC_TRANSFER_DIRECTORY is writable by
      // unprivileged users, so one of them can create a directory whose name
      // embeds a whole second log line. hpcAudit quotes its fields, but the
      // refusal diagnostics in routes/read-file.js and routes/directory-files.js
      // interpolate the raw name into console.error and do not.
      const forged = 'batch1\n[HPC-AUDIT] action="claim" user="alice"';
      expect(cleanDirectoryName(forged)).toBeNull();
    });
  });
});

describe("isWithin", () => {
  test("accepts the root itself", () => {
    expect(isWithin(ROOT, ROOT)).toBe(true);
  });

  test("accepts a nested path", () => {
    expect(isWithin(ROOT, _path.join(ROOT, "a", "b.txt"))).toBe(true);
  });

  test("rejects a parent directory", () => {
    expect(isWithin(ROOT, _path.resolve("/hpc"))).toBe(false);
  });

  test("rejects a sibling whose name merely starts with the root", () => {
    // The naive `candidate.startsWith(root)` check accepted this.
    expect(isWithin(ROOT, _path.resolve("/hpc/transfer-evil/secret"))).toBe(
      false,
    );
  });

  test("rejects non-string inputs", () => {
    expect(isWithin(ROOT, undefined)).toBe(false);
    expect(isWithin(undefined, ROOT)).toBe(false);
  });
});

describe("resolveWithin", () => {
  test("resolves an ordinary nested path", () => {
    expect(resolveWithin(ROOT, "batch1", "reads.txt")).toBe(
      _path.join(ROOT, "batch1", "reads.txt"),
    );
  });

  test("resolves the root when given no segments", () => {
    expect(resolveWithin(ROOT)).toBe(ROOT);
  });

  test("allows interior dot-dot that stays inside the root", () => {
    expect(resolveWithin(ROOT, "a/b/../c")).toBe(_path.join(ROOT, "a", "c"));
  });

  describe("rejects traversal attempts", () => {
    test("simple parent traversal", () => {
      expect(resolveWithin(ROOT, "../../etc", "passwd")).toBeNull();
    });

    test("traversal embedded in a single segment", () => {
      expect(resolveWithin(ROOT, "a/../../../etc/passwd")).toBeNull();
    });

    test("traversal to exactly one level above the root", () => {
      expect(resolveWithin(ROOT, "..")).toBeNull();
    });

    test("an absolute segment, which would otherwise discard the root", () => {
      // path.resolve("/hpc/transfer", "/etc/passwd") === "/etc/passwd"
      expect(resolveWithin(ROOT, "/etc/passwd")).toBeNull();
    });

    test("an absolute segment in a later position", () => {
      expect(resolveWithin(ROOT, "batch1", "/etc/passwd")).toBeNull();
    });

    test("an absolute segment that lands back inside the root", () => {
      // The two tests above look like they cover the isAbsolute guard, and
      // neither does: "/etc/passwd" is outside ROOT, so isWithin refuses it
      // whether or not the absolute check ran. Deleting the guard left both
      // green.
      //
      // This is the case that separates them. path.resolve discards every
      // earlier segment when it meets an absolute one, so without the guard
      // the answer is "<ROOT>/other" — inside the root, so isWithin is
      // satisfied — and "batch1" has silently vanished. A caller confined to
      // one batch directory reaches its siblings by prefixing the root it was
      // never supposed to know it was under.
      expect(resolveWithin(ROOT, "batch1", `${ROOT}/other`)).toBeNull();
    });

    test("an absolute segment naming the root itself", () => {
      // Same escape, degenerate target: without the guard this resolves to
      // ROOT, which is the whole transfer directory rather than one batch.
      expect(resolveWithin(ROOT, "batch1", ROOT)).toBeNull();
    });

    test("a segment containing a NUL byte", () => {
      expect(resolveWithin(ROOT, "batch1", "reads\0.txt")).toBeNull();
    });

    test("a sibling directory sharing the root's prefix", () => {
      expect(resolveWithin(ROOT, "../transfer-evil/secret")).toBeNull();
    });
  });

  describe("rejects unusable configuration", () => {
    test("returns null when the root is undefined", () => {
      expect(resolveWithin(undefined, "a")).toBeNull();
    });

    test("returns null when the root is empty", () => {
      expect(resolveWithin("   ", "a")).toBeNull();
    });

    test("returns null when a segment is not a string", () => {
      expect(resolveWithin(ROOT, undefined)).toBeNull();
      expect(resolveWithin(ROOT, 42)).toBeNull();
    });
  });
});

describe("resolveBelow", () => {
  test("resolves an ordinary nested path", () => {
    expect(resolveBelow(ROOT, "batch1", "reads.txt")).toBe(
      _path.join(ROOT, "batch1", "reads.txt"),
    );
  });

  test("allows interior dot-dot that still lands below the root", () => {
    expect(resolveBelow(ROOT, "a/b/../c")).toBe(_path.join(ROOT, "a", "c"));
  });

  describe("refuses names that normalise back to the root", () => {
    // These all resolve to the root itself. resolveWithin accepts them, which
    // would expose the whole transfer directory listing.
    test.each([["."], ["./"], ["a/.."], ["batch1/.."], ["./a/../."], [""]])(
      "returns null for %p",
      (segment) => {
        expect(resolveBelow(ROOT, segment)).toBeNull();
      },
    );

    test("returns null when given no segments at all", () => {
      expect(resolveBelow(ROOT)).toBeNull();
    });
  });

  test("still refuses paths outside the root", () => {
    expect(resolveBelow(ROOT, "../../etc/passwd")).toBeNull();
    expect(resolveBelow(ROOT, "/etc/passwd")).toBeNull();
  });
});

describe("safeBasename", () => {
  test("returns an ordinary filename unchanged", () => {
    expect(safeBasename("reads_R1.fq.gz")).toBe("reads_R1.fq.gz");
  });

  test("trims surrounding whitespace", () => {
    expect(safeBasename("  reads.fq  ")).toBe("reads.fq");
  });

  test("keeps dots inside the name", () => {
    expect(safeBasename("sample.2.fq.gz")).toBe("sample.2.fq.gz");
  });

  test("keeps a leading dot", () => {
    expect(safeBasename(".hidden.fq")).toBe(".hidden.fq");
  });

  describe("refuses anything carrying a directory component", () => {
    test.each([
      ["../../etc/passwd"],
      ["../reads.fq"],
      ["a/b.fq"],
      ["/etc/passwd"],
      ["reads.fq/"],
      ["./reads.fq"],
    ])("returns null for %p", (name) => {
      expect(safeBasename(name)).toBeNull();
    });

    test("refuses Windows separators on a POSIX host", () => {
      // path.basename() on POSIX treats this as one long filename, so the
      // backslashes would otherwise survive into the datastore.
      expect(safeBasename("..\\..\\etc\\passwd")).toBeNull();
      expect(safeBasename("dir\\reads.fq")).toBeNull();
    });
  });

  describe("refuses unusable values", () => {
    test.each([[undefined], [null], [42], [{}], [[]], [""], ["   "]])(
      "returns null for %p",
      (name) => {
        expect(safeBasename(name)).toBeNull();
      },
    );

    test.each([["."], [".."]])("returns null for %p", (name) => {
      expect(safeBasename(name)).toBeNull();
    });

    test("returns null for a name containing a NUL byte", () => {
      expect(safeBasename("reads\0.fq")).toBeNull();
    });

    describe("refuses interior control characters", () => {
      // A NUL truncates the path at the syscall boundary; a newline splits any
      // single-line record the name is interpolated into — including
      // `File.name` as it is rendered downstream, and the unescaped
      // console.error refusals in routes/read-file.js and
      // routes/directory-files.js. Neither is ever a legitimate filename, so
      // both are refused here rather than escaped at each sink.
      test.each([
        ["reads\n.fq"],
        ["reads\r.fq"],
        ['reads\n[HPC-AUDIT] action="claim".fq'],
        ["reads\u0001.fq"],
        ["reads\u001b[31m.fq"],
        ["reads\u001f.fq"],
        ["reads\u007f.fq"],
      ])("returns null for %j", (name) => {
        expect(safeBasename(name)).toBeNull();
      });

      test("a newline at either end is still just whitespace to trim", () => {
        expect(safeBasename("\nreads.fq\n")).toBe("reads.fq");
      });
    });
  });
});

describe("resolveWithinReal / assertWithinReal", () => {
  // These need a real filesystem: the whole point is what the symlinks on disk
  // say, not what the strings do.
  let tmpRoot;
  let realRoot;
  let outsideDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-safepath-"));
    realRoot = _path.join(tmpRoot, "root");
    outsideDir = _path.join(tmpRoot, "outside");
    fs.mkdirSync(_path.join(realRoot, "batch1"), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(_path.join(outsideDir, "secret.txt"), "SECRET");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("resolveWithinReal", () => {
    test("resolves an ordinary nested path", async () => {
      await expect(
        resolveWithinReal(realRoot, "batch1", "reads.fq"),
      ).resolves.toBe(_path.join(realRoot, "batch1", "reads.fq"));
    });

    test("returns the lexical path, not the realpath", async () => {
      // On macOS the tmpdir is itself behind a symlink (/var -> /private/var).
      // Callers must get back the path they asked about, or they write
      // somewhere the document does not name.
      const resolved = await resolveWithinReal(realRoot, "reads.fq");

      expect(resolved).toBe(_path.join(realRoot, "reads.fq"));
    });

    test("still refuses lexical traversal", async () => {
      await expect(
        resolveWithinReal(realRoot, "../outside/secret.txt"),
      ).resolves.toBeNull();
    });

    test("still refuses an absolute segment", async () => {
      await expect(
        resolveWithinReal(realRoot, "/etc/passwd"),
      ).resolves.toBeNull();
    });

    test("still refuses a NUL byte", async () => {
      await expect(
        resolveWithinReal(realRoot, "reads\0.fq"),
      ).resolves.toBeNull();
    });

    test("refuses a symlinked directory inside the root that points outside", async () => {
      // The lexical check is perfectly happy with "<root>/escape/secret.txt".
      fs.symlinkSync(outsideDir, _path.join(realRoot, "escape"));

      await expect(
        resolveWithinReal(realRoot, "escape", "secret.txt"),
      ).resolves.toBeNull();
    });

    test("refuses a symlinked file inside the root that points outside", async () => {
      fs.symlinkSync(
        _path.join(outsideDir, "secret.txt"),
        _path.join(realRoot, "secret.txt"),
      );

      await expect(
        resolveWithinReal(realRoot, "secret.txt"),
      ).resolves.toBeNull();
    });

    test("refuses a dangling symlink, which a later create would follow", async () => {
      fs.symlinkSync(
        _path.join(outsideDir, "not-there-yet.fq"),
        _path.join(realRoot, "pending.fq"),
      );

      await expect(
        resolveWithinReal(realRoot, "pending.fq"),
      ).resolves.toBeNull();
    });

    test("accepts a symlink that stays inside the root", async () => {
      fs.symlinkSync(
        _path.join(realRoot, "batch1"),
        _path.join(realRoot, "current"),
      );

      await expect(
        resolveWithinReal(realRoot, "current", "reads.fq"),
      ).resolves.toBe(_path.join(realRoot, "current", "reads.fq"));
    });

    test("accepts a destination whose directories do not exist yet", async () => {
      await expect(
        resolveWithinReal(realRoot, "new", "nested", "reads.fq"),
      ).resolves.toBe(_path.join(realRoot, "new", "nested", "reads.fq"));
    });

    test("returns null when the root does not exist", async () => {
      await expect(
        resolveWithinReal(_path.join(tmpRoot, "no-such-root"), "reads.fq"),
      ).resolves.toBeNull();
    });

    test("returns null when the root is not configured", async () => {
      await expect(resolveWithinReal(undefined, "reads.fq")).resolves.toBeNull();
    });
  });

  describe("assertWithinReal", () => {
    test("accepts a path inside the root", async () => {
      await expect(
        assertWithinReal(realRoot, _path.join(realRoot, "batch1", "reads.fq")),
      ).resolves.toBe(true);
    });

    test("accepts the root itself", async () => {
      await expect(assertWithinReal(realRoot, realRoot)).resolves.toBe(true);
    });

    test("rejects a path outside the root", async () => {
      await expect(
        assertWithinReal(realRoot, _path.join(outsideDir, "secret.txt")),
      ).resolves.toBe(false);
    });

    test("rejects a sibling whose name starts with the root", async () => {
      const sibling = `${realRoot}-evil`;
      fs.mkdirSync(sibling);

      await expect(
        assertWithinReal(realRoot, _path.join(sibling, "secret.txt")),
      ).resolves.toBe(false);
    });

    test("rejects a path that only reaches inside via a symlink out", async () => {
      fs.symlinkSync(outsideDir, _path.join(realRoot, "escape"));

      await expect(
        assertWithinReal(realRoot, _path.join(realRoot, "escape", "secret.txt")),
      ).resolves.toBe(false);
    });

    test("rejects unusable inputs", async () => {
      await expect(assertWithinReal(realRoot, undefined)).resolves.toBe(false);
      await expect(assertWithinReal(realRoot, "")).resolves.toBe(false);
      await expect(assertWithinReal(undefined, realRoot)).resolves.toBe(false);
      await expect(
        assertWithinReal(realRoot, `${realRoot}/reads\0.fq`),
      ).resolves.toBe(false);
    });
  });
});

describe("symlinks into a configured storage root", () => {
  // Symlinking a big file, or a whole project directory, into the staging area
  // instead of copying terabytes is ordinary practice on a cluster. Refusing
  // every link that leaves the root broke that workflow.
  let root;
  let scratch;
  let elsewhere;
  const ORIGINAL = process.env.ALLOWED_LINK_ROOTS;

  beforeAll(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-links-root-")),
    );
    scratch = fs.realpathSync(
      fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-links-scratch-")),
    );
    elsewhere = fs.realpathSync(
      fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-links-other-")),
    );

    fs.mkdirSync(_path.join(root, "realdata"));
    fs.writeFileSync(_path.join(root, "realdata", "in.fq"), "a");
    fs.writeFileSync(_path.join(scratch, "big.fq"), "b");
    fs.writeFileSync(_path.join(elsewhere, "secrets.txt"), "c");

    fs.symlinkSync(
      _path.join(root, "realdata", "in.fq"),
      _path.join(root, "link_inside.fq"),
    );
    fs.symlinkSync(_path.join(scratch, "big.fq"), _path.join(root, "link_scratch.fq"));
    fs.symlinkSync(scratch, _path.join(root, "projectdir"));
    fs.symlinkSync(
      _path.join(elsewhere, "secrets.txt"),
      _path.join(root, "link_elsewhere.txt"),
    );
  });

  afterAll(() => {
    [root, scratch, elsewhere].forEach((d) =>
      fs.rmSync(d, { recursive: true, force: true }),
    );
    if (ORIGINAL === undefined) {
      delete process.env.ALLOWED_LINK_ROOTS;
    } else {
      process.env.ALLOWED_LINK_ROOTS = ORIGINAL;
    }
  });

  describe("with no configured roots", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_LINK_ROOTS;
    });

    test("accepts a link that stays inside the root", async () => {
      await expect(resolveWithinReal(root, "link_inside.fq")).resolves.not.toBeNull();
    });

    test("refuses a link that leaves the root", async () => {
      await expect(resolveWithinReal(root, "link_scratch.fq")).resolves.toBeNull();
    });
  });

  describe("with a configured root", () => {
    beforeEach(() => {
      process.env.ALLOWED_LINK_ROOTS = scratch;
    });

    test("accepts a link to a file in that root", async () => {
      await expect(resolveWithinReal(root, "link_scratch.fq")).resolves.not.toBeNull();
    });

    test("accepts a file reached through a symlinked directory in that root", async () => {
      await expect(
        resolveWithinReal(root, "projectdir/big.fq"),
      ).resolves.not.toBeNull();
    });

    test("still refuses a link to anywhere else", async () => {
      await expect(
        resolveWithinReal(root, "link_elsewhere.txt"),
      ).resolves.toBeNull();
    });

    test("still refuses lexical traversal out of the root", async () => {
      await expect(resolveWithinReal(root, "../../etc/passwd")).resolves.toBeNull();
    });

    test("matches a configured root that is itself reached through a symlink", async () => {
      // The root is realpath'd before comparing. Without that, "/scratch" ->
      // "/mnt/scratch" would never match and would fail silently as a refusal.
      const alias = _path.join(elsewhere, "scratch-alias");
      fs.symlinkSync(scratch, alias);
      process.env.ALLOWED_LINK_ROOTS = alias;

      await expect(
        resolveWithinReal(root, "link_scratch.fq"),
      ).resolves.not.toBeNull();
    });

    test("ignores a relative entry in the configured list", async () => {
      process.env.ALLOWED_LINK_ROOTS = "relative/path";
      await expect(resolveWithinReal(root, "link_scratch.fq")).resolves.toBeNull();
    });
  });
});
