const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  RESERVED_TOP_LEVEL_SEGMENTS,
} = require("../../../lib/s3-archive/config");
const {
  validateAws,
  validateProjectRoot,
} = require("../../../lib/s3-archive/preflight");

const fsp = fs.promises;

describe("archive source-root validation", () => {
  let datastoreRoot;

  beforeAll(async () => {
    // realpath: macOS hands out /var/... symlinks for temporary directories,
    // and the validator requires DATASTORE_ROOT to be its canonical path.
    datastoreRoot = await fsp.realpath(
      await fsp.mkdtemp(path.join(os.tmpdir(), "komondor-preflight-")),
    );
    await fsp.mkdir(path.join(datastoreRoot, "group", "project"), {
      recursive: true,
    });
  });

  afterAll(async () => {
    await fsp.rm(datastoreRoot, { recursive: true, force: true });
  });

  test("accepts an ordinary two-segment project path", async () => {
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/project" }),
    ).resolves.toEqual({
      sourceRoot: path.join(datastoreRoot, "group", "project"),
      sourceRelativeRoot: "group/project",
      exists: true,
    });
  });

  test.each(RESERVED_TOP_LEVEL_SEGMENTS)(
    "refuses a project whose group is the reserved name %s",
    async (segment) => {
      // The refusal must land before any filesystem or S3 work, so that a
      // colliding group can never reach lock.
      await expect(
        validateProjectRoot({ datastoreRoot }, { path: `${segment}/project` }),
      ).rejects.toThrow(/reserved archive prefix/);
    },
  );

  test("allows a reserved name deeper in the path", async () => {
    await fsp.mkdir(path.join(datastoreRoot, "group", "_control"), {
      recursive: true,
    });

    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/_control" }),
    ).resolves.toMatchObject({ sourceRelativeRoot: "group/_control" });
  });

  test("still refuses a path that is too shallow or unsafe", async () => {
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group" }),
    ).rejects.toThrow(/at least two safe segments/);
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/../../etc" }),
    ).rejects.toThrow(/at least two safe segments/);
  });
});

describe("archive AWS preflight", () => {
  // Only the flags the uploader actually passes; the real help output is pages
  // long and the check is a substring match on each flag name.
  const HELP = {
    "s3 cp": "--checksum-algorithm --expected-size --sse --storage-class",
    "s3api head-object": "--checksum-mode",
    "s3api put-object":
      "--if-none-match --storage-class --checksum-algorithm CRC64NVME",
  };

  const makeAws = (help = {}) => {
    const text = { ...HELP, ...help };
    return {
      version: jest.fn().mockResolvedValue("aws-cli/2.36.44 Python/3.14.6"),
      run: jest.fn((args) =>
        Promise.resolve(text[args.slice(0, 2).join(" ")] ?? ""),
      ),
      getCallerIdentity: jest.fn().mockResolvedValue({
        Account: "123456789012",
        Arn: "arn:aws:sts::123456789012:assumed-role/archive-mover/operator",
      }),
      getBucketVersioning: jest.fn().mockResolvedValue({ Status: "Enabled" }),
      getBucketLifecycle: jest.fn().mockResolvedValue({ Rules: [] }),
      headBucket: jest.fn().mockResolvedValue({}),
      listRootProbe: jest.fn().mockResolvedValue({}),
    };
  };

  const config = {
    expectedAccountId: "123456789012",
    expectedRoleArn: "arn:aws:iam::123456789012:role/archive-mover",
    expectedAssumedRolePrefix:
      "arn:aws:sts::123456789012:assumed-role/archive-mover/",
  };

  test.each(["s3api put-object"])(
    "refuses old %s with flags but no CRC64NVME",
    async (command) => {
      const aws = makeAws({
        [command]: HELP[command].replace(
          "CRC64NVME",
          "CRC32 SHA256 SHA1 CRC32C",
        ),
      });
      await expect(validateAws(aws, config)).rejects.toThrow(/lacks CRC64NVME/);
      expect(aws.getCallerIdentity).not.toHaveBeenCalled();
    },
  );

  test.each(["2.20.0", "2.22.99"])(
    "refuses %s even when its help has checksum flags",
    async (version) => {
      const aws = makeAws();
      aws.version.mockResolvedValue(`aws-cli/${version}`);
      await expect(validateAws(aws, config)).rejects.toThrow(
        /v2.23.0 or later/,
      );
      expect(aws.getCallerIdentity).not.toHaveBeenCalled();
    },
  );

  test("accepts the supported version floor without algorithm names in cp help", async () => {
    const aws = makeAws();
    aws.version.mockResolvedValue("aws-cli/2.23.0");
    await expect(validateAws(aws, config)).resolves.toBeDefined();
  });

  test("accepts overstrike-formatted capability help", async () => {
    const aws = makeAws({
      "s3api put-object": HELP["s3api put-object"].replace(
        "CRC64NVME",
        [..."CRC64NVME"].map((c) => `${c}\b${c}`).join(""),
      ),
    });
    await expect(validateAws(aws, config)).resolves.toBeDefined();
  });

  test("refuses an administrator session in the correct account", async () => {
    const aws = makeAws();
    aws.getCallerIdentity.mockResolvedValue({
      Account: config.expectedAccountId,
      Arn: "arn:aws:sts::123456789012:assumed-role/admin/operator",
    });
    await expect(validateAws(aws, config)).rejects.toThrow(/EXPECTED_ROLE_ARN/);
    expect(aws.headBucket).not.toHaveBeenCalled();
  });

  test.each([undefined, "Suspended"])(
    "refuses bucket versioning %s",
    async (Status) => {
      const aws = makeAws();
      aws.getBucketVersioning.mockResolvedValue({ Status });
      await expect(validateAws(aws, config)).rejects.toThrow(
        /versioning must be Enabled/,
      );
    },
  );

  test.each([
    "Expiration",
    "NoncurrentVersionExpiration",
    "Transitions",
    "NoncurrentVersionTransitions",
  ])("refuses enabled lifecycle %s", async (field) => {
    const aws = makeAws();
    aws.getBucketLifecycle.mockResolvedValue({
      Rules: [{ Status: "Enabled", [field]: {} }],
    });
    await expect(validateAws(aws, config)).rejects.toThrow(
      /lifecycle expiration or transition/,
    );
  });

  test("allows incomplete multipart cleanup and disabled old rules", async () => {
    const aws = makeAws();
    aws.getBucketLifecycle.mockResolvedValue({
      Rules: [
        {
          Status: "Enabled",
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
        { Status: "Disabled", Expiration: { Days: 1 } },
      ],
    });
    await expect(validateAws(aws, config)).resolves.toBeDefined();
  });

  test("accepts a CLI exposing every flag the uploader passes", async () => {
    const aws = makeAws();

    await expect(validateAws(aws, config)).resolves.toMatchObject({
      version: "aws-cli/2.36.44 Python/3.14.6",
      accountId: "123456789012",
      arn: "arn:aws:sts::123456789012:assumed-role/archive-mover/operator",
    });
    // Bucket reachability is part of the preflight, not left to first upload.
    expect(aws.headBucket).toHaveBeenCalled();
    expect(aws.listRootProbe).toHaveBeenCalled();
  });

  test.each([
    [
      "s3 cp without --storage-class",
      { "s3 cp": "--checksum-algorithm --expected-size --sse" },
      /s3 cp lacks --storage-class/,
    ],
    [
      "put-object without --storage-class",
      { "s3api put-object": "--if-none-match" },
      /put-object lacks --storage-class/,
    ],
    [
      "s3 cp without --checksum-algorithm",
      { "s3 cp": "--expected-size --sse --storage-class" },
      /s3 cp lacks --checksum-algorithm/,
    ],
    [
      "head-object without --checksum-mode",
      { "s3api head-object": "" },
      /head-object lacks --checksum-mode/,
    ],
    [
      "put-object without --if-none-match",
      { "s3api put-object": "--storage-class" },
      /put-object lacks --if-none-match/,
    ],
  ])("refuses a CLI with %s", async (_label, help, message) => {
    // Refusing here is the point: every one of these would otherwise surface
    // mid-copy, after objects had already been written.
    const aws = makeAws(help);

    await expect(validateAws(aws, config)).rejects.toThrow(message);
    expect(aws.getCallerIdentity).not.toHaveBeenCalled();
    expect(aws.headBucket).not.toHaveBeenCalled();
  });

  test("refuses a v1 CLI before inspecting any capability", async () => {
    const aws = makeAws();
    aws.version.mockResolvedValue("aws-cli/1.42.0 Python/3.9.0");

    await expect(validateAws(aws, config)).rejects.toThrow(/v2 is required/);
    expect(aws.run).not.toHaveBeenCalled();
  });

  test("refuses an account other than the configured fence", async () => {
    const aws = makeAws();
    aws.getCallerIdentity.mockResolvedValue({
      Account: "999999999999",
      Arn: "arn:aws:sts::999999999999:assumed-role/someone-else/operator",
    });

    await expect(validateAws(aws, config)).rejects.toThrow(
      /does not match AWS_ARCHIVE_EXPECTED_ACCOUNT_ID/,
    );
    expect(aws.headBucket).not.toHaveBeenCalled();
  });
});
