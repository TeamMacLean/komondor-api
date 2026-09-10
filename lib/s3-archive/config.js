const path = require("path");

const S3_URI = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.+?))?\/?$/;

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
    dataPrefixFor(relativeProjectRoot) {
      return joinKey(root.prefix, "data", relativeProjectRoot);
    },
    controlPrefixFor(projectId, migrationId) {
      return joinKey(
        root.prefix,
        "control",
        "projects",
        String(projectId),
        String(migrationId),
      );
    },
  };
};

module.exports = {
  joinKey,
  loadArchiveConfig,
  parseS3Uri,
  s3Uri,
  stripLeadingSlash,
};
