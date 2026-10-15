const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createInventory } = require("../../../lib/s3-archive/inventory");
const {
  copyManifestEntries,
  isOwned,
  metadataValue,
  objectMetadata,
  requireSealedStat,
  verifyHead,
  verifyManifestObjects,
} = require("../../../lib/s3-archive/upload");
const { Crc64Nvme } = require("../../../lib/utils/crc64nvme");

const fsp = fs.promises;

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
  dataKeyPrefix: "archive/group/project",
  dataStorageClass: "DEEP_ARCHIVE",
  entries: [],
};

const entry = {
  relPath: "sample/reads.fastq.gz",
  disposition: "copy",
  s3Key: "archive/group/project/sample/reads.fastq.gz",
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

  test("records the storage class each payload object actually landed in", async () => {
    const aws = {
      headObject: jest
        .fn()
        .mockResolvedValue(matchingHead({ StorageClass: "DEEP_ARCHIVE" })),
      listObjectsAtOrBelow: jest.fn().mockResolvedValue([{ Key: entry.s3Key }]),
    };

    const result = await verifyManifestObjects(aws, {
      ...manifest,
      entries: [entry],
    });

    expect(result.verified).toBe(true);
    expect(result.entries[0].storageClass).toBe("DEEP_ARCHIVE");
    expect(result.storageClass).toEqual({
      expected: "DEEP_ARCHIVE",
      matches: true,
      unexpected: [],
    });
  });

  test("reports an object outside the intended class but still verifies it", async () => {
    // A complete, checksum-verified copy in the wrong class is a cost and
    // policy problem, not a reason to withhold the archive.
    const aws = {
      headObject: jest.fn().mockResolvedValue(matchingHead()),
      listObjectsAtOrBelow: jest.fn().mockResolvedValue([{ Key: entry.s3Key }]),
    };

    const result = await verifyManifestObjects(aws, {
      ...manifest,
      entries: [entry],
    });

    expect(result.verified).toBe(true);
    expect(result.storageClass).toEqual({
      expected: "DEEP_ARCHIVE",
      matches: false,
      unexpected: [
        {
          relPath: entry.relPath,
          s3Key: entry.s3Key,
          // HEAD omits StorageClass for Standard objects.
          storageClass: "STANDARD",
        },
      ],
    });
  });

  test("reports no class mismatch when the manifest recorded no intent", async () => {
    const { dataStorageClass, ...withoutIntent } = manifest;
    const aws = {
      headObject: jest.fn().mockResolvedValue(matchingHead()),
      listObjectsAtOrBelow: jest.fn().mockResolvedValue([{ Key: entry.s3Key }]),
    };

    const result = await verifyManifestObjects(aws, {
      ...withoutIntent,
      entries: [entry],
    });

    expect(result.verified).toBe(true);
    expect(result.storageClass).toEqual({
      expected: null,
      matches: true,
      unexpected: [],
    });
  });
});

// Decision record §7.1. After file A completes, file B is interrupted or its
// credentials expire. Nothing may record a successful copy; a resume must then
// reuse A on manifest identity, send B again from byte zero and verify.
describe("interrupted copy and resume", () => {
  const dataKeyPrefix = "komondor/group/project";
  const fileA = { relPath: "a/reads.fastq", content: "A".repeat(1024) };
  const fileB = { relPath: "b/reads.fastq", content: "B".repeat(2048) };
  let root;

  beforeEach(async () => {
    root = await fsp.realpath(
      await fsp.mkdtemp(path.join(os.tmpdir(), "komondor-s3-resume-")),
    );
    for (const file of [fileA, fileB]) {
      await fsp.mkdir(path.join(root, path.dirname(file.relPath)), {
        recursive: true,
      });
      await fsp.writeFile(path.join(root, file.relPath), file.content);
    }
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const sealManifest = async () => {
    const inventory = await createInventory(root);
    return {
      projectId: "project-1",
      migrationId: "migration-2",
      restartedFrom: [],
      sourceManifestSha256: "sealed-source-digest",
      dataKeyPrefix,
      dataStorageClass: "DEEP_ARCHIVE",
      entries: inventory.entries.map((item) => ({
        ...item,
        s3Key:
          item.disposition === "copy"
            ? `${dataKeyPrefix}/${item.relPath}`
            : null,
      })),
    };
  };

  const keyOf = (manifest, relPath) =>
    manifest.entries.find((item) => item.relPath === relPath).s3Key;

  const expiredToken = (key) =>
    Object.assign(
      new Error(
        `AWS upload failed for ${key} (exit 1): An error occurred (ExpiredToken) when calling the UploadPart operation: The provided token has expired.`,
      ),
      { name: "AwsCliError" },
    );

  // A fake S3 whose uploader behaves like `aws s3 cp -`: one stream read from
  // byte zero, no checkpoint, and an initiated multipart upload left behind
  // when the transfer dies. `plan` is keyed by S3 key and may be mutated
  // between passes to model renewed credentials or a restored network.
  const createFakeS3 = (plan = {}) => {
    const objects = new Map();
    const uploads = [];
    const attempts = [];
    let nextUploadId = 0;
    let credentialsExpired = false;
    const requireCredentials = async (key) => {
      if (credentialsExpired) throw expiredToken(key);
    };
    const world = {
      objects,
      uploads,
      attempts,
      plan,
      renewCredentials: () => {
        credentialsExpired = false;
      },
    };
    world.aws = {
      headObject: jest.fn(async (key) => {
        await requireCredentials(key);
        return objects.get(key) || null;
      }),
      listObjectsAtOrBelow: jest.fn(async (prefix) => {
        await requireCredentials(prefix);
        return [...objects.keys()]
          .filter((key) => key === prefix || key.startsWith(`${prefix}/`))
          .sort()
          .map((Key) => ({ Key }));
      }),
      listMultipartUploads: jest.fn(async (prefix) => {
        await requireCredentials(prefix);
        return uploads
          .filter(
            (upload) =>
              upload.Key === prefix || upload.Key.startsWith(`${prefix}/`),
          )
          .map((upload) => ({ ...upload }));
      }),
      abortMultipartUpload: jest.fn(async (key, uploadId) => {
        await requireCredentials(key);
        const index = uploads.findIndex(
          (upload) => upload.Key === key && upload.UploadId === uploadId,
        );
        if (index < 0) throw new Error(`No such multipart upload: ${uploadId}`);
        uploads.splice(index, 1);
      }),
      uploadHandle: jest.fn(async (handle, { key, size, metadata }) => {
        const behaviour = plan[key] || {};
        nextUploadId += 1;
        const uploadId = `upload-${nextUploadId}`;
        uploads.push({ Key: key, UploadId: uploadId });
        const attempt = { key, uploadId, bytes: 0, expectedSize: size };
        attempts.push(attempt);
        const limit =
          behaviour.bytes === undefined
            ? Number.POSITIVE_INFINITY
            : behaviour.bytes;
        const sha256 = crypto.createHash("sha256");
        const crc64 = new Crc64Nvme();
        // Read to the end, as the real wrapper does, but account for only the
        // bytes this attempt managed to send: destroying the stream early
        // would close the caller's file handle.
        const stream = handle.createReadStream({ autoClose: false, start: 0 });
        for await (const chunk of stream) {
          const sent = chunk.subarray(0, Math.max(0, limit - attempt.bytes));
          attempt.bytes += sent.length;
          sha256.update(sent);
          crc64.update(sent);
        }
        if (behaviour.outcome === "failed") {
          if (behaviour.credentialsExpire) credentialsExpired = true;
          throw expiredToken(key);
        }
        uploads.splice(
          uploads.findIndex((upload) => upload.UploadId === uploadId),
          1,
        );
        objects.set(key, {
          ContentLength: attempt.bytes,
          ChecksumCRC64NVME: crc64.toBase64(),
          ChecksumType: "FULL_OBJECT",
          StorageClass: "DEEP_ARCHIVE",
          Metadata: { ...metadata },
        });
        return {
          bytes: attempt.bytes,
          sha256: sha256.digest("hex"),
          crc64nvme: crc64.toBase64(),
        };
      }),
    };
    return world;
  };

  test("an interrupted file B aborts its own parts and verifies nothing", async () => {
    const manifest = await sealManifest();
    const keyA = keyOf(manifest, fileA.relPath);
    const keyB = keyOf(manifest, fileB.relPath);
    const world = createFakeS3({
      [keyB]: { outcome: "failed", bytes: 512 },
    });

    await expect(
      copyManifestEntries(world.aws, root, manifest),
    ).rejects.toThrow(/ExpiredToken/);

    // A was streamed whole; B died after 512 of its 2048 bytes.
    expect(world.attempts.map(({ key, bytes }) => ({ key, bytes }))).toEqual([
      { key: keyA, bytes: fileA.content.length },
      { key: keyB, bytes: 512 },
    ]);
    expect([...world.objects.keys()]).toEqual([keyA]);
    // Credentials still work here, so B's own abandoned upload is aborted
    // immediately rather than waiting for the seven-day lifecycle rule.
    expect(world.aws.abortMultipartUpload).toHaveBeenCalledWith(
      keyB,
      "upload-2",
    );
    expect(world.uploads).toEqual([]);

    // Nothing about this half-copied project may read as verified.
    const verification = await verifyManifestObjects(world.aws, manifest);
    expect(verification.verified).toBe(false);
    expect(verification.keySet.missingKeys).toEqual([keyB]);
    expect(
      verification.entries.find((entry) => entry.s3Key === keyB),
    ).toMatchObject({
      verified: false,
      error: expect.stringMatching(/missing/),
    });
  });

  test("expired credentials leave the abandoned parts to the lifecycle rule", async () => {
    const manifest = await sealManifest();
    const keyA = keyOf(manifest, fileA.relPath);
    const keyB = keyOf(manifest, fileB.relPath);
    const world = createFakeS3({
      [keyB]: { outcome: "failed", bytes: 512, credentialsExpire: true },
    });

    await expect(
      copyManifestEntries(world.aws, root, manifest),
    ).rejects.toThrow(/ExpiredToken/);

    expect([...world.objects.keys()]).toEqual([keyA]);
    // The cleanup listing needs the same dead credentials, so it cannot run
    // and must not turn the real failure into a different error.
    expect(world.aws.abortMultipartUpload).not.toHaveBeenCalled();
    expect(world.uploads).toEqual([{ Key: keyB, UploadId: "upload-2" }]);
  });

  test("resume reuses file A and restarts file B once its parts are gone", async () => {
    const manifest = await sealManifest();
    const keyA = keyOf(manifest, fileA.relPath);
    const keyB = keyOf(manifest, fileB.relPath);
    const world = createFakeS3({
      [keyB]: { outcome: "failed", bytes: 512 },
    });
    await expect(
      copyManifestEntries(world.aws, root, manifest),
    ).rejects.toThrow();
    // B's parts were aborted during the failure, so this resume does not
    // depend on waiting a week for the incomplete-upload rule.
    expect(world.uploads).toEqual([]);

    delete world.plan[keyB];
    const results = await copyManifestEntries(world.aws, root, manifest);

    // A is skipped on manifest identity; only B is sent again.
    expect(results).toEqual([
      { relPath: fileA.relPath, action: "verified-existing" },
      { relPath: fileB.relPath, action: "uploaded" },
    ]);
    expect(
      world.attempts.filter((attempt) => attempt.key === keyA),
    ).toHaveLength(1);
    const restarted = world.attempts.at(-1);
    expect(restarted).toEqual({
      key: keyB,
      uploadId: "upload-3",
      // Byte zero to the sealed size: no checkpoint, no partial remainder.
      bytes: fileB.content.length,
      expectedSize: fileB.content.length,
    });

    const verification = await verifyManifestObjects(world.aws, manifest);
    expect(verification.verified).toBe(true);
    expect(verification.keySet).toEqual({
      matches: true,
      missingKeys: [],
      extraKeys: [],
    });
    expect(verification.entries.map((entry) => entry.contentLength)).toEqual([
      fileA.content.length,
      fileB.content.length,
    ]);
  });

  test("resume restarts file B while its abandoned parts are still listed", async () => {
    const manifest = await sealManifest();
    const keyB = keyOf(manifest, fileB.relPath);
    const world = createFakeS3({
      [keyB]: { outcome: "failed", bytes: 512, credentialsExpire: true },
    });
    await expect(
      copyManifestEntries(world.aws, root, manifest),
    ).rejects.toThrow();
    expect(world.uploads).toEqual([{ Key: keyB, UploadId: "upload-2" }]);

    world.renewCredentials();
    delete world.plan[keyB];
    const results = await copyManifestEntries(world.aws, root, manifest);

    expect(results.map((result) => result.action)).toEqual([
      "verified-existing",
      "uploaded",
    ]);
    // A new upload carries B; the stale one is left for the lifecycle rule
    // and is never adopted or aborted as if it were this attempt's own.
    expect(world.attempts.at(-1)).toMatchObject({
      key: keyB,
      uploadId: "upload-3",
      bytes: fileB.content.length,
    });
    expect(world.aws.abortMultipartUpload).not.toHaveBeenCalled();
    expect(world.uploads).toEqual([{ Key: keyB, UploadId: "upload-2" }]);
    expect((await verifyManifestObjects(world.aws, manifest)).verified).toBe(
      true,
    );
  });

  test("refuses an upload that streamed less than the sealed size", async () => {
    const manifest = await sealManifest();
    const keyB = keyOf(manifest, fileB.relPath);
    // A transfer that sent only part of the file, as a resume from a stored
    // offset would: the object exists but is not the sealed file.
    const world = createFakeS3({ [keyB]: { bytes: 1024 } });

    await expect(
      copyManifestEntries(world.aws, root, manifest),
    ).rejects.toThrow(/do not match the sealed manifest/);

    const verification = await verifyManifestObjects(world.aws, manifest);
    expect(verification.verified).toBe(false);
    expect(
      verification.entries.find((entry) => entry.s3Key === keyB),
    ).toMatchObject({
      verified: false,
      error: expect.stringMatching(/size is 1024, expected 2048/),
    });
  });
});
