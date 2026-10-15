const path = require("path");

const S3_URI = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.+?))?\/?$/;

// Groups sit at the archive root so that S3 mirrors the hierarchy below
// DATASTORE_ROOT exactly. These two names are therefore reserved: a group
// called either of them would collide with the archive's own prefixes.
// An underscore is only a convention, so the collision is refused explicitly
// rather than assumed impossible.
const CONTROL_SEGMENT = "_control";
const SMOKE_SEGMENT = "_smoke";
const RESERVED_TOP_LEVEL_SEGMENTS = Object.freeze([
  CONTROL_SEGMENT,
  SMOKE_SEGMENT,
]);

// Payload objects are written straight into the cold class: retrieval is rare
// and deliberate, so there is no Standard grace period and no transition rule.
const DEFAULT_DATA_STORAGE_CLASS = "DEEP_ARCHIVE";
const DATA_STORAGE_CLASSES = Object.freeze([
  "DEEP_ARCHIVE",
  "GLACIER",
  "GLACIER_IR",
  "INTELLIGENT_TIERING",
  "ONEZONE_IA",
  "STANDARD",
  "STANDARD_IA",
]);
// Status, resume, deletion approval and audit all read control objects, so they
// must never need a restore.
const CONTROL_STORAGE_CLASS = "STANDARD";

const parseS3Uri = (uri) => {
  if (typeof uri !== "string") {
    throw new Error("AWS_ARCHIVE_S3_ROOT is not set");
  }
  const value = uri.trim();
  if (value.endsWith("/")) {
    throw new Error("AWS_ARCHIVE_S3_ROOT must not have a trailing slash");
  }
  const match = S3_URI.exec(value);
  if (!match || (match[2] || "").startsWith("/")) {
    throw new Error(
      "AWS_ARCHIVE_S3_ROOT must look like s3://bucket or s3://bucket/base-prefix",
    );
  }
  return { bucket: match[1], prefix: (match[2] || "").replace(/\/+$/, "") };
};

const joinKey = (...parts) =>
  parts
    .filter((part) => typeof part === "string" && part.length > 0)
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");

const s3Uri = (bucket, key) => `s3://${bucket}/${key}`;

const stripLeadingSlash = (value) => String(value || "").replace(/^\/+/, "");

/**
 * Returns the reserved segment a datastore-relative path would occupy, or null.
 * The check is on the first segment only: that is the group, and the only level
 * that shares a namespace with the archive's own prefixes.
 */
const reservedTopLevelSegment = (relativePath) => {
  const [first] = String(relativePath || "")
    .split("/")
    .filter(Boolean);
  return first && RESERVED_TOP_LEVEL_SEGMENTS.includes(first) ? first : null;
};

const loadArchiveConfig = (env = process.env) => {
  const root = parseS3Uri(env.AWS_ARCHIVE_S3_ROOT);
  const expectedAccountId = String(
    env.AWS_ARCHIVE_EXPECTED_ACCOUNT_ID || "",
  ).trim();
  if (!/^\d{12}$/.test(expectedAccountId)) {
    throw new Error("AWS_ARCHIVE_EXPECTED_ACCOUNT_ID must contain 12 digits");
  }
  if (!env.DATASTORE_ROOT || !path.isAbsolute(env.DATASTORE_ROOT)) {
    throw new Error("DATASTORE_ROOT must be an absolute path");
  }

  const dataStorageClass = String(
    env.AWS_ARCHIVE_STORAGE_CLASS || DEFAULT_DATA_STORAGE_CLASS,
  )
    .trim()
    .toUpperCase();
  if (!DATA_STORAGE_CLASSES.includes(dataStorageClass)) {
    throw new Error(
      `AWS_ARCHIVE_STORAGE_CLASS must be one of ${DATA_STORAGE_CLASSES.join(", ")}`,
    );
  }

  const sseArgs = [];
  const s3ApiSseArgs = [];
  if (env.AWS_ARCHIVE_SSE) {
    if (!["AES256", "aws:kms"].includes(env.AWS_ARCHIVE_SSE)) {
      throw new Error("AWS_ARCHIVE_SSE must be AES256 or aws:kms");
    }
    sseArgs.push("--sse", env.AWS_ARCHIVE_SSE);
    s3ApiSseArgs.push("--server-side-encryption", env.AWS_ARCHIVE_SSE);
  }
  if (env.AWS_ARCHIVE_SSE_KMS_KEY_ID) {
    if (env.AWS_ARCHIVE_SSE !== "aws:kms") {
      throw new Error(
        "AWS_ARCHIVE_SSE_KMS_KEY_ID requires AWS_ARCHIVE_SSE=aws:kms",
      );
    }
    sseArgs.push("--sse-kms-key-id", env.AWS_ARCHIVE_SSE_KMS_KEY_ID);
    s3ApiSseArgs.push("--ssekms-key-id", env.AWS_ARCHIVE_SSE_KMS_KEY_ID);
  }

  return {
    bucket: root.bucket,
    basePrefix: root.prefix,
    expectedAccountId,
    datastoreRoot: path.resolve(env.DATASTORE_ROOT),
    readyUrl:
      env.KOMONDOR_READY_URL || `http://127.0.0.1:${env.PORT || "3000"}/ready`,
    sseArgs,
    s3ApiSseArgs,
    dataStorageClass,
    controlStorageClass: CONTROL_STORAGE_CLASS,
    storageClassArgs: ["--storage-class", dataStorageClass],
    controlStorageClassArgs: ["--storage-class", CONTROL_STORAGE_CLASS],
    dataPrefixFor(relativeProjectRoot) {
      // Fail closed: a key must never be built under a reserved prefix, even
      // if an earlier caller skipped its own check.
      const reserved = reservedTopLevelSegment(relativeProjectRoot);
      if (reserved) {
        throw new Error(
          `Project path starts with the reserved archive prefix "${reserved}": ${relativeProjectRoot}`,
        );
      }
      return joinKey(root.prefix, relativeProjectRoot);
    },
    controlPrefixFor(projectId, migrationId) {
      return joinKey(
        root.prefix,
        CONTROL_SEGMENT,
        "projects",
        String(projectId),
        String(migrationId),
      );
    },
    controlProjectPrefixFor(projectId) {
      return joinKey(
        root.prefix,
        CONTROL_SEGMENT,
        "projects",
        String(projectId),
      );
    },
  };
};

module.exports = {
  CONTROL_SEGMENT,
  CONTROL_STORAGE_CLASS,
  DATA_STORAGE_CLASSES,
  DEFAULT_DATA_STORAGE_CLASS,
  RESERVED_TOP_LEVEL_SEGMENTS,
  SMOKE_SEGMENT,
  joinKey,
  loadArchiveConfig,
  parseS3Uri,
  reservedTopLevelSegment,
  s3Uri,
  stripLeadingSlash,
};
