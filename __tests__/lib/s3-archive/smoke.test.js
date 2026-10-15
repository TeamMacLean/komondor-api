jest.mock("../../../lib/s3-archive/preflight", () => ({
  validateAws: jest.fn().mockResolvedValue({ arn: "test-mover" }),
}));
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { crc64Nvme } = require("../../../lib/utils/crc64nvme");
const {
  runSmoke,
  parseArgs,
  SIZES,
} = require("../../../scripts/archive-s3-smoke");

let parent, workDir, objects, aws;
const config = { bucket: "smoke-test", basePrefix: "base" };
const digest = (bytes) => ({
  bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  crc64nvme: crc64Nvme(bytes),
});
const run = (command, execute = true) =>
  runSmoke(
    { command, workDir, execute },
    { config, aws, sizes: [1024, 4096], log: jest.fn() },
  );
beforeEach(async () => {
  parent = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "archive-smoke-test-")),
  );
  workDir = path.join(parent, "new-rehearsal");
  objects = new Map();
  const put = (key, bytes, metadata = {}, storageClass = "STANDARD") =>
    objects.set(key, {
      bytes,
      head: {
        ContentLength: bytes.length,
        ChecksumCRC64NVME: crc64Nvme(bytes),
        ChecksumType: "FULL_OBJECT",
        Metadata: metadata,
        StorageClass: storageClass,
      },
    });
  aws = {
    headObject: jest.fn(async (key) => objects.get(key)?.head || null),
    getObjectBuffer: jest.fn(async (key) => objects.get(key).bytes),
    putControlObject: jest.fn(async (key, bytes) => put(key, bytes)),
    listMultipartUploads: jest.fn().mockResolvedValue([]),
    listObjectsAtOrBelow: jest.fn(async (prefix) =>
      [...objects.keys()]
        .filter((key) => key.startsWith(`${prefix}/`))
        .map((Key) => ({ Key })),
    ),
    uploadHandle: jest.fn(async (handle, { key, metadata, storageClass }) => {
      const bytes = await handle.readFile();
      put(key, bytes, metadata, storageClass);
      return digest(bytes);
    }),
    restoreObject: jest.fn(async (key) => {
      objects.get(
        key,
      ).head.Restore = `ongoing-request="false", expiry-date="${new Date(
        Date.now() + 86400000,
      ).toUTCString()}"`;
    }),
    downloadObjectDigest: jest.fn(async (key) =>
      digest(objects.get(key).bytes),
    ),
  };
});
afterEach(async () => {
  await fs.rm(parent, { recursive: true, force: true });
});
test("rehearsal uses the production stream/verification path then proves restored bytes", async () => {
  expect(SIZES.some((size) => size > 5 * 1024 ** 3)).toBe(true);
  expect(await run("prepare")).toBe(0);
  expect(await run("upload")).toBe(0);
  expect(aws.uploadHandle).toHaveBeenCalledTimes(2);
  expect(await run("upload")).toBe(0); // Reuses completed files on interruption.
  expect(aws.uploadHandle).toHaveBeenCalledTimes(2);
  expect(await run("verify-restore")).toBe(1);
  expect(await run("restore")).toBe(0);
  expect(await run("verify-restore")).toBe(0);
  const receipt = (await fs.readdir(workDir)).find((file) =>
    file.startsWith("restore-verified-"),
  );
  expect(
    JSON.parse(await fs.readFile(path.join(workDir, receipt))),
  ).toMatchObject({
    verified: true,
    downloads: [{ bytes: 1024 }, { bytes: 4096 }],
  });
});
test("a corrupt restored download cannot produce a passing receipt", async () => {
  await run("prepare");
  await run("upload");
  await run("restore");
  aws.downloadObjectDigest.mockResolvedValue(digest(Buffer.from("wrong")));
  await expect(run("verify-restore")).rejects.toThrow(
    /Restored bytes do not match/,
  );
  expect(
    (await fs.readdir(workDir)).filter((file) =>
      file.startsWith("restore-verified-"),
    ),
  ).toEqual([]);
});
test("expired restores are requested again", async () => {
  await run("prepare");
  await run("upload");
  for (const object of objects.values())
    object.head.Restore =
      'ongoing-request="false", expiry-date="Mon, 01 Jan 2024 00:00:00 GMT"';
  expect(await run("verify-restore")).toBe(1);
  await run("restore");
  expect(aws.restoreObject).toHaveBeenCalledTimes(2);
});
test("dry run does not create files or upload", async () => {
  await run("prepare", false);
  expect(await fs.readdir(parent)).toEqual([]);
  expect(aws.putControlObject).not.toHaveBeenCalled();
});
test("refuses re-preparation and a changed destination", async () => {
  await run("prepare");
  await expect(run("prepare")).rejects.toThrow(/EEXIST/);
  await expect(
    runSmoke(
      { command: "upload", workDir, execute: true },
      { config: { ...config, bucket: "wrong" }, aws },
    ),
  ).rejects.toThrow(/does not match/);
  expect(aws.putControlObject).not.toHaveBeenCalled();
});
test("requires an explicit absolute scratch directory and recognises no deletion command", () => {
  expect(() => parseArgs(["delete", "--work-dir", workDir])).toThrow();
  expect(() => parseArgs(["prepare", "--work-dir", "relative"])).toThrow();
  expect(parseArgs(["upload", "--work-dir", workDir])).toMatchObject({
    execute: false,
  });
});
