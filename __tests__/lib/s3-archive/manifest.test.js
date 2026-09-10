const {
  parseAndVerifyManifest,
  serializeManifest,
  sha256Bytes,
  sortValue,
} = require("../../../lib/s3-archive/manifest");

describe("archive manifests", () => {
  test("serializes object keys recursively in deterministic order", () => {
    const manifest = {
      z: 3,
      entries: [{ z: "last", a: "first" }],
      a: { second: 2, first: 1, omitted: undefined },
    };

    expect(serializeManifest(manifest).toString("utf8")).toBe(
      [
        "{",
        '  "a": {',
        '    "first": 1,',
        '    "second": 2',
        "  },",
        '  "entries": [',
        "    {",
        '      "a": "first",',
        '      "z": "last"',
        "    }",
        "  ],",
        '  "z": 3',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("equivalent objects produce identical bytes and digest", () => {
    const left = { projectId: "p1", nested: { b: 2, a: 1 } };
    const right = { nested: { a: 1, b: 2 }, projectId: "p1" };
    const leftBytes = serializeManifest(left);
    const rightBytes = serializeManifest(right);

    expect(rightBytes.equals(leftBytes)).toBe(true);
    expect(sha256Bytes(rightBytes)).toBe(sha256Bytes(leftBytes));
  });

  test("verifies the digest before parsing a manifest", () => {
    const bytes = serializeManifest({ kind: "source", projectId: "p1" });
    const digest = sha256Bytes(bytes);

    expect(parseAndVerifyManifest(bytes, digest)).toEqual({
      manifest: { kind: "source", projectId: "p1" },
      sha256: digest,
    });
    expect(() => parseAndVerifyManifest(bytes, "0".repeat(64))).toThrow(
      expect.objectContaining({ code: "MANIFEST_DIGEST_MISMATCH" }),
    );
  });

  test("preserves array order while sorting objects within it", () => {
    expect(
      sortValue([
        { b: 2, a: 1 },
        { d: 4, c: 3 },
      ]),
    ).toEqual([
      { a: 1, b: 2 },
      { c: 3, d: 4 },
    ]);
  });
});
