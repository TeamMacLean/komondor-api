const fs = require("fs");
const path = require("path");

const { ArchiveMutationError, ArchiveRefusalError } = require("./errors");
const { normalizedRelativePath } = require("./inventory");

const fsp = fs.promises;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
// No `dev`: st_dev on a network mount changes across a remount or reboot, and a
// copy can span days. Inode, size and both timestamps still pin the exact file
// the manifest sealed; a replaced file gets a new inode and ctime.
const SEALED_FIELDS = ["ino", "size", "mtimeMs", "ctimeMs"];

const metadataValue = (head, name) => {
  const metadata = (head && head.Metadata) || {};
  const wanted = name.toLowerCase();
  const key = Object.keys(metadata).find(
    (candidate) => candidate.toLowerCase() === wanted,
  );
  return key ? String(metadata[key]) : null;
};

const isOwned = (head, manifest, entry, { allowPrior = false } = {}) => {
  if (!head) return false;
  const migrationId = metadataValue(head, "komondor-migration-id");
  const allowedIds = [manifest.migrationId];
  if (allowPrior) allowedIds.push(...(manifest.restartedFrom || []));
  return (
    metadataValue(head, "komondor-project-id") === String(manifest.projectId) &&
    allowedIds.map(String).includes(migrationId) &&
    metadataValue(head, "komondor-source-manifest-sha256") ===
      manifest.sourceManifestSha256 &&
    metadataValue(head, "komondor-entry-sha256") === entry.sha256
  );
};

const verifyHead = (head, manifest, entry) => {
  const errors = [];
  if (!head) errors.push("object is missing");
  if (head && Number(head.ContentLength) !== Number(entry.size)) {
    errors.push(`size is ${head.ContentLength}, expected ${entry.size}`);
  }
  if (head && head.ChecksumCRC64NVME !== entry.crc64nvme) {
    errors.push("CRC64NVME does not match");
  }
  if (head && head.ChecksumType !== "FULL_OBJECT") {
    errors.push(
      `checksum type is ${head.ChecksumType || "missing"}, expected FULL_OBJECT`,
    );
  }
  if (head && !isOwned(head, manifest, entry)) {
    errors.push("ownership metadata does not match this migration");
  }
  return { ok: errors.length === 0, errors };
};

const requireSealedStat = (stat, entry) => {
  const differences = SEALED_FIELDS.filter(
    (field) => Number(stat[field]) !== Number(entry[field]),
  );
  if (!stat.isFile() || differences.length) {
    throw new ArchiveRefusalError(
      `Source changed since manifest: ${entry.relPath}${
        differences.length ? ` (${differences.join(", ")})` : ""
      }`,
    );
  }
};

const openSealedEntry = async (sourceRoot, entry) => {
  if (normalizedRelativePath(entry.relPath) !== entry.relPath) {
    throw new ArchiveRefusalError(
      `Manifest contains an unsafe path: ${entry.relPath}`,
    );
  }
  const absolutePath = path.join(sourceRoot, ...entry.relPath.split("/"));
  let handle;
  try {
    handle = await fsp.open(absolutePath, fs.constants.O_RDONLY | O_NOFOLLOW);
    requireSealedStat(await handle.stat(), entry);
    return handle;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error instanceof ArchiveRefusalError) throw error;
    throw new ArchiveRefusalError(
      `Cannot open sealed source ${entry.relPath}: ${error.code || error.message}`,
    );
  }
};

const objectMetadata = (manifest, entry) => ({
  "komondor-project-id": String(manifest.projectId),
  "komondor-migration-id": String(manifest.migrationId),
  "komondor-source-manifest-sha256": manifest.sourceManifestSha256,
  "komondor-entry-sha256": entry.sha256,
});

const uploadOne = async (aws, sourceRoot, manifest, entry) => {
  const handle = await openSealedEntry(sourceRoot, entry);
  try {
    const existing = await aws.headObject(entry.s3Key);
    if (existing) {
      const checked = verifyHead(existing, manifest, entry);
      if (checked.ok) return { action: "verified-existing", head: existing };
      if (!isOwned(existing, manifest, entry, { allowPrior: true })) {
        throw new ArchiveRefusalError(
          `Refusing to overwrite foreign object ${entry.s3Key}: ${checked.errors.join("; ")}`,
        );
      }
    }

    const beforeUploads = new Set(
      (await aws.listMultipartUploads(entry.s3Key))
        .filter((upload) => upload.Key === entry.s3Key)
        .map((upload) => upload.UploadId),
    );

    let streamed;
    try {
      streamed = await aws.uploadHandle(handle, {
        key: entry.s3Key,
        size: entry.size,
        metadata: objectMetadata(manifest, entry),
      });
    } catch (error) {
      const afterUploads = await aws
        .listMultipartUploads(entry.s3Key)
        .catch(() => []);
      await Promise.all(
        afterUploads
          .filter(
            (upload) =>
              upload.Key === entry.s3Key && !beforeUploads.has(upload.UploadId),
          )
          .map((upload) =>
            aws
              .abortMultipartUpload(upload.Key, upload.UploadId)
              .catch(() => null),
          ),
      );
      throw error;
    }

    if (
      streamed.bytes !== entry.size ||
      streamed.sha256 !== entry.sha256 ||
      streamed.crc64nvme !== entry.crc64nvme
    ) {
      throw new ArchiveMutationError(
        `Bytes streamed for ${entry.relPath} do not match the sealed manifest`,
      );
    }
    requireSealedStat(await handle.stat(), entry);
    const head = await aws.headObject(entry.s3Key);
    const checked = verifyHead(head, manifest, entry);
    if (!checked.ok) {
      throw new ArchiveMutationError(
        `Uploaded object did not verify (${entry.s3Key}): ${checked.errors.join("; ")}`,
      );
    }
    return { action: "uploaded", head };
  } finally {
    await handle.close();
  }
};

const copyManifestEntries = async (
  aws,
  sourceRoot,
  manifest,
  { onProgress = () => {} } = {},
) => {
  const entries = manifest.entries.filter(
    (entry) => entry.disposition === "copy",
  );
  const results = [];
  const startedAt = Date.now();
  let lastReportAt = startedAt;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const result = await uploadOne(aws, sourceRoot, manifest, entry);
    results.push({ relPath: entry.relPath, action: result.action });
    const now = Date.now();
    if (
      (index + 1) % 25 === 0 ||
      now - lastReportAt >= 60_000 ||
      index + 1 === entries.length
    ) {
      await onProgress({
        completed: index + 1,
        total: entries.length,
        entry,
        startedAt,
      });
      lastReportAt = now;
    }
  }
  return results;
};

const verifyManifestObjects = async (aws, manifest) => {
  const entries = manifest.entries.filter(
    (entry) => entry.disposition === "copy",
  );
  const results = [];
  for (const entry of entries) {
    const headAt = new Date().toISOString();
    try {
      const head = await aws.headObject(entry.s3Key);
      const checked = verifyHead(head, manifest, entry);
      results.push({
        relPath: entry.relPath,
        s3Key: entry.s3Key,
        verified: checked.ok,
        contentLength: head ? Number(head.ContentLength) : null,
        checksumCRC64NVME: head ? head.ChecksumCRC64NVME || null : null,
        checksumType: head ? head.ChecksumType || null : null,
        storageClass: head ? head.StorageClass || "STANDARD" : null,
        metadataMigrationId: head
          ? metadataValue(head, "komondor-migration-id")
          : null,
        headAt,
        error: checked.ok ? null : checked.errors.join("; "),
      });
    } catch (error) {
      results.push({
        relPath: entry.relPath,
        s3Key: entry.s3Key,
        verified: false,
        headAt,
        error: error.message,
      });
    }
  }

  const listed = await aws.listObjectsAtOrBelow(manifest.dataKeyPrefix);
  const expectedKeys = new Set(entries.map((entry) => entry.s3Key));
  const actualKeys = new Set(listed.map((object) => object.Key));
  const missingKeys = [...expectedKeys]
    .filter((key) => !actualKeys.has(key))
    .sort();
  const extraKeys = [...actualKeys]
    .filter((key) => !expectedKeys.has(key))
    .sort();
  return {
    verified:
      results.every((entry) => entry.verified) &&
      !missingKeys.length &&
      !extraKeys.length,
    entries: results,
    keySet: {
      matches: !missingKeys.length && !extraKeys.length,
      missingKeys,
      extraKeys,
    },
  };
};

module.exports = {
  copyManifestEntries,
  isOwned,
  metadataValue,
  objectMetadata,
  openSealedEntry,
  requireSealedStat,
  uploadOne,
  verifyHead,
  verifyManifestObjects,
};
