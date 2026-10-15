const {
  RESERVED_TOP_LEVEL_SEGMENTS,
  joinKey,
  loadArchiveConfig,
  parseS3Uri,
  reservedTopLevelSegment,
  s3Uri,
  stripLeadingSlash,
} = require("../../../lib/s3-archive/config");

const validEnv = (overrides = {}) => ({
  AWS_ARCHIVE_S3_ROOT: "s3://archive-bucket/komondor",
  AWS_ARCHIVE_EXPECTED_ACCOUNT_ID: "123456789012",
  AWS_ARCHIVE_PROFILE: "archive-mover",
  AWS_ARCHIVE_EXPECTED_ROLE_ARN: "arn:aws:iam::123456789012:role/archive-mover",
  DATASTORE_ROOT: "/srv/komondor/datastore",
  HPC_TRANSFER_DIRECTORY: "this-value-is-deliberately-irrelevant",
  ...overrides,
});

describe("S3 archive configuration", () => {
  test("matches an Identity Center role path to its pathless STS assumed-role name", () => {
    const config = loadArchiveConfig(
      validEnv({
        AWS_ARCHIVE_EXPECTED_ROLE_ARN:
          "arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/eu-west-2/AWSReservedSSO_archive_0123456789abcdef",
      }),
    );
    expect(config.expectedAssumedRolePrefix).toBe(
      "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_archive_0123456789abcdef/",
    );
    expect(config.profile).toBe("archive-mover");
  });

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

  test("mirrors the datastore hierarchy with groups at the archive root", () => {
    const config = loadArchiveConfig(validEnv());

    expect(config).toMatchObject({
      bucket: "archive-bucket",
      basePrefix: "komondor",
      expectedAccountId: "123456789012",
      datastoreRoot: "/srv/komondor/datastore",
      readyUrl: "http://127.0.0.1:3000/ready",
    });
    // No intervening "data/" level: the payload key is the datastore-relative
    // path, so HPC and S3 paths can be compared directly.
    expect(config.dataPrefixFor("group/project")).toBe(
      "komondor/group/project",
    );
    expect(config.controlPrefixFor("project-id", "migration-id")).toBe(
      "komondor/_control/projects/project-id/migration-id",
    );
    expect(config.controlProjectPrefixFor("project-id")).toBe(
      "komondor/_control/projects/project-id",
    );
  });

  test("writes payload to Deep Archive and control objects to Standard", () => {
    const config = loadArchiveConfig(validEnv());

    expect(config.dataStorageClass).toBe("DEEP_ARCHIVE");
    expect(config.controlStorageClass).toBe("STANDARD");
    expect(config.storageClassArgs).toEqual([
      "--storage-class",
      "DEEP_ARCHIVE",
    ]);
    expect(config.controlStorageClassArgs).toEqual([
      "--storage-class",
      "STANDARD",
    ]);
  });

  test("accepts a different payload class and normalises its case", () => {
    const config = loadArchiveConfig(
      validEnv({ AWS_ARCHIVE_STORAGE_CLASS: "glacier_ir" }),
    );

    expect(config.dataStorageClass).toBe("GLACIER_IR");
    expect(config.storageClassArgs).toEqual(["--storage-class", "GLACIER_IR"]);
    // Control objects must stay immediately readable whatever the payload class.
    expect(config.controlStorageClass).toBe("STANDARD");
  });

  test.each(RESERVED_TOP_LEVEL_SEGMENTS)(
    "refuses to build a payload key under the reserved prefix %s",
    (segment) => {
      const config = loadArchiveConfig(validEnv());

      expect(reservedTopLevelSegment(`${segment}/project`)).toBe(segment);
      expect(() => config.dataPrefixFor(`${segment}/project`)).toThrow(
        /reserved archive prefix/,
      );
    },
  );

  test("does not treat a reserved name below the group level as a collision", () => {
    const config = loadArchiveConfig(validEnv());

    // Only the first segment shares a namespace with the archive's prefixes.
    expect(reservedTopLevelSegment("group/_control")).toBeNull();
    expect(config.dataPrefixFor("group/_control")).toBe(
      "komondor/group/_control",
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
    [{ AWS_ARCHIVE_STORAGE_CLASS: "DEEP_FREEZE" }, /must be one of/],
    [{ AWS_ARCHIVE_STORAGE_CLASS: "ONEZONE_IA" }, /must be one of/],
    [{ AWS_ARCHIVE_STORAGE_CLASS: "REDUCED_REDUNDANCY" }, /must be one of/],
    [{ AWS_ARCHIVE_PROFILE: "" }, /must name/],
    [{ AWS_ARCHIVE_EXPECTED_ROLE_ARN: "" }, /IAM role ARN/],
    [
      { AWS_ARCHIVE_EXPECTED_ROLE_ARN: "arn:aws:iam::999999999999:role/admin" },
      /expected account/,
    ],
  ])("refuses incomplete safety configuration %#", (override, message) => {
    expect(() => loadArchiveConfig(validEnv(override))).toThrow(message);
  });

  test("joins keys without duplicate separators", () => {
    expect(joinKey("/base/", "/_control/", "group/project/")).toBe(
      "base/_control/group/project",
    );
    expect(s3Uri("bucket", "base/group/project")).toBe(
      "s3://bucket/base/group/project",
    );
    expect(stripLeadingSlash("///group/project")).toBe("group/project");
  });
});
