const crypto = require("crypto");

const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = sortValue(value[key]);
        return result;
      }, {});
  }
  return value;
};

const serializeManifest = (manifest) =>
  Buffer.from(`${JSON.stringify(sortValue(manifest), null, 2)}\n`, "utf8");

const sha256Bytes = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const parseAndVerifyManifest = (bytes, expectedSha256) => {
  const actualSha256 = sha256Bytes(bytes);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    const error = new Error(
      `Control manifest SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha256})`,
    );
    error.code = "MANIFEST_DIGEST_MISMATCH";
    throw error;
  }
  const manifest = JSON.parse(bytes.toString("utf8"));
  return { manifest, sha256: actualSha256 };
};

module.exports = {
  parseAndVerifyManifest,
  serializeManifest,
  sha256Bytes,
  sortValue,
};
