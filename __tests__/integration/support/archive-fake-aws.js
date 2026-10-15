// Process-boundary S3 double. Used only by archive-cli.test.js; production
// inventory, streaming, control digests, Mongo fences and CLI code stay real.
const fs = require("fs");
const { crc64Nvme } = require("../../../lib/utils/crc64nvme");
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const storePath = process.env.ARCHIVE_TEST_S3;
if (!storePath) throw new Error("ARCHIVE_TEST_S3 required");
const store = JSON.parse(fs.readFileSync(storePath));
const save = () => {
  fs.writeFileSync(`${storePath}.next`, JSON.stringify(store));
  fs.renameSync(`${storePath}.next`, storePath);
};
const fail = (message) => {
  process.stderr.write(message);
  process.exit(1);
};
const json = (data) => process.stdout.write(JSON.stringify(data));
const metadata = () =>
  Object.fromEntries(
    (value("--metadata") || "")
      .split(",")
      .filter(Boolean)
      .map((pair) => pair.split("=")),
  );
const put = (key, bytes) => {
  store.objects[key] = {
    body: bytes.toString("base64"),
    head: {
      ContentLength: bytes.length,
      ChecksumCRC64NVME: crc64Nvme(bytes),
      ChecksumType: "FULL_OBJECT",
      StorageClass: value("--storage-class"),
      Metadata: metadata(),
    },
  };
  store.uploads.push({
    key,
    stdin: args[2] === "-",
    size: value("--expected-size"),
    profile: value("--profile"),
  });
  save();
};
const main = async () => {
  if (value("--profile") !== "archive-test") fail("wrong profile");
  if (args.includes("--version"))
    return process.stdout.write("aws-cli/2.36.44 test");
  if (args.includes("help"))
    return process.stdout.write(
      "--checksum-algorithm CRC64NVME --checksum-mode --if-none-match --storage-class",
    );
  const [service, operation] = args;
  if (service === "sts")
    return json({
      Account: "123456789012",
      Arn: "arn:aws:sts::123456789012:assumed-role/archive-mover/test",
    });
  if (service === "s3" && operation === "cp") {
    if (args[2] === "-") {
      const key = args[3].replace("s3://archive-test/", "");
      if (store.failUploadSuffix && key.endsWith(store.failUploadSuffix))
        fail("ExpiredToken: simulated interrupted upload");
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      put(key, Buffer.concat(chunks));
      return;
    }
    const key = args[2].replace("s3://archive-test/", "");
    if (!store.objects[key]) return fail("NoSuchKey 404");
    return process.stdout.write(Buffer.from(store.objects[key].body, "base64"));
  }
  const key = value("--key");
  switch (operation) {
    case "head-bucket":
      return json({});
    case "get-bucket-versioning":
      return json({ Status: "Enabled" });
    case "get-bucket-lifecycle-configuration":
      return json({ Rules: [] });
    case "list-objects-v2": {
      const Contents = Object.entries(store.objects)
        .filter(([k]) => k.startsWith(value("--prefix")))
        .map(([Key, object]) => ({ Key, Size: object.head.ContentLength }));
      return json({ Contents, KeyCount: Contents.length, IsTruncated: false });
    }
    case "list-multipart-uploads":
      return json({ Uploads: [] });
    case "head-object":
      if (!store.objects[key]) return fail("Not Found 404");
      return json(store.objects[key].head);
    case "put-object":
      if (store.objects[key]) return fail("PreconditionFailed 412");
      put(key, fs.readFileSync(value("--body")));
      return json({});
    default:
      return fail(`Unimplemented fake AWS call: ${args.join(" ")}`);
  }
};
main().catch((error) => fail(error.stack));
