const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough, Writable } = require("stream");

const { AwsCli } = require("../../../lib/s3-archive/aws");
const { crc64Nvme } = require("../../../lib/utils/crc64nvme");

const fsp = fs.promises;

const config = {
  bucket: "archive-bucket",
  basePrefix: "komondor",
  sseArgs: ["--sse", "AES256"],
  s3ApiSseArgs: ["--server-side-encryption", "AES256"],
};

describe("AWS CLI archive wrapper", () => {
  test("downloads a control object as exact bytes without trimming", async () => {
    const exact = Buffer.from('{"kind":"source"}\n \n', "utf8");
    const execFile = jest.fn((_command, _args, _options, callback) => {
      callback(null, exact, Buffer.alloc(0));
    });
    const aws = new AwsCli(config, { execFile });

    const downloaded = await aws.getObjectBuffer(
      "komondor/control/projects/p1/m1/source-manifest.v1.json",
    );

    expect(downloaded.equals(exact)).toBe(true);
    expect(downloaded.length).toBe(exact.length);
    expect(execFile).toHaveBeenCalledWith(
      "aws",
      [
        "s3",
        "cp",
        "s3://archive-bucket/komondor/control/projects/p1/m1/source-manifest.v1.json",
        "-",
        "--only-show-errors",
        "--no-cli-pager",
      ],
      expect.objectContaining({
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 1024,
        env: expect.objectContaining({ AWS_PAGER: "" }),
      }),
      expect.any(Function),
    );
  });

  test("requests enabled checksum fields when inspecting a data object", async () => {
    const execFile = jest.fn((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          ContentLength: 4,
          ChecksumCRC64NVME: "checksum",
          ChecksumType: "FULL_OBJECT",
        }),
        "",
      );
    });
    const aws = new AwsCli(config, { execFile });

    await expect(
      aws.headObject("komondor/data/group/project/read.fastq"),
    ).resolves.toMatchObject({ ChecksumType: "FULL_OBJECT" });
    expect(execFile.mock.calls[0][1]).toEqual([
      "s3api",
      "head-object",
      "--bucket",
      "archive-bucket",
      "--key",
      "komondor/data/group/project/read.fastq",
      "--checksum-mode",
      "ENABLED",
      "--output",
      "json",
      "--no-cli-pager",
    ]);
  });

  test("puts immutable control JSON with CRC64 and configured encryption", async () => {
    const bytes = Buffer.from('{"sealed":true}\n', "utf8");
    let bodyPath;
    let uploadedBytes;
    let bodyMode;
    const execFile = jest.fn((_command, args, _options, callback) => {
      bodyPath = args[args.indexOf("--body") + 1];
      uploadedBytes = fs.readFileSync(bodyPath);
      bodyMode = fs.statSync(bodyPath).mode & 0o777;
      callback(null, "{}", "");
    });
    const aws = new AwsCli(config, { execFile });

    await aws.putControlObject("komondor/control/source.json", bytes, {
      "komondor-project-id": "p1",
      "komondor-migration-id": "m1",
    });

    expect(uploadedBytes.equals(bytes)).toBe(true);
    expect(bodyMode).toBe(0o600);
    expect(fs.existsSync(bodyPath)).toBe(false);
    expect(execFile.mock.calls[0][1]).toEqual([
      "s3api",
      "put-object",
      "--bucket",
      "archive-bucket",
      "--key",
      "komondor/control/source.json",
      "--body",
      bodyPath,
      "--content-type",
      "application/json",
      "--checksum-algorithm",
      "CRC64NVME",
      "--if-none-match",
      "*",
      "--metadata",
      "komondor-project-id=p1,komondor-migration-id=m1",
      "--server-side-encryption",
      "AES256",
      "--output",
      "json",
      "--no-cli-pager",
    ]);
  });

  test("streams the pinned handle from byte zero with checksum and size arguments", async () => {
    const sourceBytes = Buffer.from("complete source bytes", "utf8");
    const received = [];
    const child = new EventEmitter();
    child.killed = false;
    child.kill = jest.fn(() => {
      child.killed = true;
    });
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        received.push(Buffer.from(chunk));
        callback();
      },
    });
    child.stdin.once("finish", () => {
      setImmediate(() => child.emit("close", 0, null));
    });
    const spawn = jest.fn().mockReturnValue(child);
    const aws = new AwsCli(config, { spawn });
    const temporary = await fsp.mkdtemp(
      path.join(os.tmpdir(), "komondor-aws-test-"),
    );
    const sourcePath = path.join(temporary, "reads.fastq");
    await fsp.writeFile(sourcePath, sourceBytes);
    const handle = await fsp.open(sourcePath, "r");

    try {
      // The caller's sequential position must not affect the archived bytes.
      const prefix = Buffer.alloc(3);
      await handle.read(prefix, 0, prefix.length, null);

      const result = await aws.uploadHandle(handle, {
        key: "komondor/data/group/project/reads.fastq",
        size: sourceBytes.length,
        metadata: { project: "p1", migration: "m1" },
      });

      expect(Buffer.concat(received).equals(sourceBytes)).toBe(true);
      expect(result).toEqual({
        bytes: sourceBytes.length,
        sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
        crc64nvme: crc64Nvme(sourceBytes),
      });
      await expect(handle.stat()).resolves.toMatchObject({
        size: sourceBytes.length,
      });
      expect(spawn).toHaveBeenCalledWith(
        "aws",
        [
          "s3",
          "cp",
          "-",
          "s3://archive-bucket/komondor/data/group/project/reads.fastq",
          "--expected-size",
          String(sourceBytes.length),
          "--checksum-algorithm",
          "CRC64NVME",
          "--content-type",
          "application/octet-stream",
          "--metadata",
          "project=p1,migration=m1",
          "--sse",
          "AES256",
          "--only-show-errors",
          "--no-cli-pager",
        ],
        expect.objectContaining({
          env: expect.objectContaining({ AWS_PAGER: "" }),
          stdio: ["pipe", "ignore", "pipe"],
        }),
      );
    } finally {
      await handle.close();
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  });

  test("checks an exact prefix key separately from slash-delimited children", async () => {
    const aws = new AwsCli(config);
    jest.spyOn(aws, "headObject").mockResolvedValue(null);
    jest.spyOn(aws, "hasObjects").mockResolvedValue(false);

    await expect(
      aws.hasObjectsAtOrBelow("komondor/data/group/project"),
    ).resolves.toBe(false);

    expect(aws.headObject).toHaveBeenCalledWith("komondor/data/group/project");
    expect(aws.hasObjects).toHaveBeenCalledWith("komondor/data/group/project/");
  });
});
