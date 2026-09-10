const {
  isOwned,
  metadataValue,
  objectMetadata,
  requireSealedStat,
  verifyHead,
  verifyManifestObjects,
} = require("../../../lib/s3-archive/upload");

describe("sealed source identity", () => {
  const sealed = {
    relPath: "sample/reads.fastq.gz",
    dev: 41,
    ino: 7001,
    size: 42,
    mtimeMs: 1700000000000,
    ctimeMs: 1700000000500,
  };
  const stat = (overrides = {}) => ({
    isFile: () => true,
    ...sealed,
    ...overrides,
  });

  test("accepts the same file after a remount changed its device number", () => {
    expect(() => requireSealedStat(stat({ dev: 42 }), sealed)).not.toThrow();
  });

  test("refuses a replaced inode, changed size or changed timestamps", () => {
    expect(() => requireSealedStat(stat({ ino: 7002 }), sealed)).toThrow(/ino/);
    expect(() => requireSealedStat(stat({ size: 43 }), sealed)).toThrow(/size/);
    expect(() => requireSealedStat(stat({ ctimeMs: 1 }), sealed)).toThrow(
      /ctimeMs/,
    );
    expect(() =>
      requireSealedStat(stat({ isFile: () => false }), sealed),
    ).toThrow(/Source changed/);
  });
});

const manifest = {
  projectId: "project-1",
  migrationId: "migration-2",
  restartedFrom: ["migration-1"],
  sourceManifestSha256: "source-manifest-digest",
  dataKeyPrefix: "archive/data/group/project",
  entries: [],
};

const entry = {
  relPath: "sample/reads.fastq.gz",
  disposition: "copy",
  s3Key: "archive/data/group/project/sample/reads.fastq.gz",
  size: 42,
  sha256: "entry-digest",
  crc64nvme: "crc64-base64",
};

const matchingHead = (overrides = {}) => ({
  ContentLength: 42,
  ChecksumCRC64NVME: "crc64-base64",
  ChecksumType: "FULL_OBJECT",
  Metadata: {
    "komondor-project-id": "project-1",
    "komondor-migration-id": "migration-2",
    "komondor-source-manifest-sha256": "source-manifest-digest",
    "komondor-entry-sha256": "entry-digest",
  },
  ...overrides,
});

describe("uploaded-object ownership", () => {
  test("reads metadata names case-insensitively", () => {
    expect(
      metadataValue(
        { Metadata: { "Komondor-Project-Id": "p1" } },
        "komondor-project-id",
      ),
    ).toBe("p1");
    expect(metadataValue(null, "komondor-project-id")).toBeNull();
  });

  test("requires all migration ownership metadata", () => {
    expect(isOwned(matchingHead(), manifest, entry)).toBe(true);
    expect(
      isOwned(
        matchingHead({
          Metadata: {
            ...matchingHead().Metadata,
            "komondor-project-id": "other",
          },
        }),
        manifest,
        entry,
      ),
    ).toBe(false);
  });

  test("recognises a prior migration only when restart reuse is explicitly allowed", () => {
    const priorHead = matchingHead({
      Metadata: {
        ...matchingHead().Metadata,
        "komondor-migration-id": "migration-1",
      },
    });

    expect(isOwned(priorHead, manifest, entry)).toBe(false);
    expect(isOwned(priorHead, manifest, entry, { allowPrior: true })).toBe(
      true,
    );
  });

  test("verifies size, full-object CRC64 and current migration ownership", () => {
    expect(verifyHead(matchingHead(), manifest, entry)).toEqual({
      ok: true,
      errors: [],
    });

    const result = verifyHead(
      matchingHead({
        ContentLength: 41,
        ChecksumCRC64NVME: "wrong",
        ChecksumType: "COMPOSITE",
      }),
      manifest,
      entry,
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/size/),
        expect.stringMatching(/CRC64NVME/),
        expect.stringMatching(/FULL_OBJECT/),
      ]),
    );
  });

  test("builds the metadata written with each data object", () => {
    expect(objectMetadata(manifest, entry)).toEqual({
      "komondor-project-id": "project-1",
      "komondor-migration-id": "migration-2",
      "komondor-source-manifest-sha256": "source-manifest-digest",
      "komondor-entry-sha256": "entry-digest",
    });
  });

  test("requires both verified HEAD results and an exact prefix key set", async () => {
    const copyEntry = { ...entry };
    const skippedEntry = {
      relPath: "link",
      disposition: "skip",
      s3Key: null,
    };
    const aws = {
      headObject: jest.fn().mockResolvedValue(matchingHead()),
      listObjectsAtOrBelow: jest
        .fn()
        .mockResolvedValue([
          { Key: copyEntry.s3Key },
          { Key: `${manifest.dataKeyPrefix}/unexpected` },
        ]),
    };

    const result = await verifyManifestObjects(aws, {
      ...manifest,
      entries: [copyEntry, skippedEntry],
    });

    expect(result.verified).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.keySet).toEqual({
      matches: false,
      missingKeys: [],
      extraKeys: [`${manifest.dataKeyPrefix}/unexpected`],
    });
  });
});
