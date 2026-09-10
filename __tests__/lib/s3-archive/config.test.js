const {
  joinKey,
  loadArchiveConfig,
  parseS3Uri,
  s3Uri,
  stripLeadingSlash,
} = require("../../../lib/s3-archive/config");

const validEnv = (overrides = {}) => ({
  AWS_ARCHIVE_S3_ROOT: "s3://archive-bucket/komondor",
  AWS_ARCHIVE_EXPECTED_ACCOUNT_ID: "123456789012",
  DATASTORE_ROOT: "/srv/komondor/datastore",
  HPC_TRANSFER_DIRECTORY: "this-value-is-deliberately-irrelevant",
  ...overrides,
});

describe("S3 archive configuration", () => {
  test.each([
    ["s3://archive-bucket", { bucket: "archive-bucket", prefix: "" }],
    [
      "s3://archive-bucket/a/nested-prefix",
      { bucket: "archive-bucket", prefix: "a/nested-prefix" },
    ],
  ])("parses %s", (uri, expected) => {
    expect(parseS3Uri(uri)).toEqual(expected);
  });

  test.each([
    [undefined, /not set/],
    ["archive-bucket/prefix", /must look like/],
    ["s3://archive-bucket/", /trailing slash/],
    ["s3://archive-bucket//prefix", /must look like/],
  ])("refuses an invalid archive root %p", (value, message) => {
    expect(() => parseS3Uri(value)).toThrow(message);
  });

  test("derives mirrored data and separate control prefixes", () => {
    const config = loadArchiveConfig(validEnv());

    expect(config).toMatchObject({
      bucket: "archive-bucket",
      basePrefix: "komondor",
      expectedAccountId: "123456789012",
      datastoreRoot: "/srv/komondor/datastore",
      readyUrl: "http://127.0.0.1:3000/ready",
    });
    expect(config.dataPrefixFor("group/project")).toBe(
      "komondor/data/group/project",
    );
    expect(config.controlPrefixFor("project-id", "migration-id")).toBe(
      "komondor/control/projects/project-id/migration-id",
    );
  });

  test("uses the configured readiness URL and encryption arguments", () => {
    const config = loadArchiveConfig(
      validEnv({
        KOMONDOR_READY_URL: "http://127.0.0.1:4321/ready",
        AWS_ARCHIVE_SSE: "aws:kms",
        AWS_ARCHIVE_SSE_KMS_KEY_ID: "alias/komondor-archive",
      }),
    );

    expect(config.readyUrl).toBe("http://127.0.0.1:4321/ready");
    expect(config.sseArgs).toEqual([
      "--sse",
      "aws:kms",
      "--sse-kms-key-id",
      "alias/komondor-archive",
    ]);
    expect(config.s3ApiSseArgs).toEqual([
      "--server-side-encryption",
      "aws:kms",
      "--ssekms-key-id",
      "alias/komondor-archive",
    ]);
  });

  test.each([
    [{ AWS_ARCHIVE_EXPECTED_ACCOUNT_ID: "123" }, /12 digits/],
    [{ DATASTORE_ROOT: "relative/datastore" }, /absolute path/],
    [{ DATASTORE_ROOT: "" }, /absolute path/],
    [{ AWS_ARCHIVE_SSE: "not-an-algorithm" }, /AES256 or aws:kms/],
    [
      { AWS_ARCHIVE_SSE_KMS_KEY_ID: "alias/key" },
      /requires AWS_ARCHIVE_SSE=aws:kms/,
    ],
  ])("refuses incomplete safety configuration %#", (override, message) => {
    expect(() => loadArchiveConfig(validEnv(override))).toThrow(message);
  });

  test("joins keys without duplicate separators", () => {
    expect(joinKey("/base/", "/data/", "group/project/")).toBe(
      "base/data/group/project",
    );
    expect(s3Uri("bucket", "base/data/project")).toBe(
      "s3://bucket/base/data/project",
    );
    expect(stripLeadingSlash("///group/project")).toBe("group/project");
  });
});
