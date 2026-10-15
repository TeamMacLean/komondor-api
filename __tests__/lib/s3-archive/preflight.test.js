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
    "s3api put-object": "--if-none-match --storage-class",
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
      headBucket: jest.fn().mockResolvedValue({}),
      listRootProbe: jest.fn().mockResolvedValue({}),
    };
  };

  const config = { expectedAccountId: "123456789012" };

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
