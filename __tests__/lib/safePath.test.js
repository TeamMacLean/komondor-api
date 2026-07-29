/**
 * Tests for lib/utils/safePath.js
 *
 * These cover the containment rules that protect /read-file, /directory-files
 * and /directory-files/verify-md5 from reading outside the HPC transfer
 * directory.
 */

const _path = require("path");
const {
  cleanDirectoryName,
  isWithin,
  resolveWithin,
  resolveBelow,
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
