/** Real CLI + Mongo + filesystem + AWS child process; only S3 is simulated. */
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const mongo = require("./support/mongo");
const { sha256Bytes } = require("../../lib/s3-archive/manifest");

jest.setTimeout(90_000);
let scratch, env, id, source, storePath;
const db = () => mongo.mongoose.connection.db;
const project = () => db().collection("projects").findOne({ _id: id });
const readStore = async () => JSON.parse(await fs.readFile(storePath, "utf8"));
const writeStore = (store) => fs.writeFile(storePath, JSON.stringify(store));
const cli = (command, ...flags) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve("scripts/move-project-to-s3.js"),
        command,
        "--project-id",
        String(id),
        ...flags,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
const expectSuccess = (result) => {
  expect({
    code: result.code,
    error: result.code ? result.stderr : "",
  }).toEqual({ code: 0, error: "" });
};
const lock = () =>
  cli(
    "lock",
    "--moved-by",
    "alice",
    "--acknowledge-known-anomalies",
    "--execute",
  );
const copy = () =>
  cli(
    "copy",
    "--moved-by",
    "alice",
    "--acknowledge-known-anomalies",
    "--execute",
  );

beforeAll(async () => {
  await mongo.connect();
  scratch = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "archive-cli-")),
  );
  await fs.mkdir(path.join(scratch, "bin"));
  const launcher = `#!${process.execPath}\nrequire(${JSON.stringify(
    path.resolve(__dirname, "support/archive-fake-aws.js"),
  )});\n`;
  await fs.writeFile(path.join(scratch, "bin/aws"), launcher, { mode: 0o700 });
  storePath = path.join(scratch, "s3.json");
  env = {
    ...process.env,
    PATH: `${scratch}/bin:${process.env.PATH}`,
    NODE_ENV: "test",
    DATASTORE_ROOT: `${scratch}/datastore`,
    AWS_ARCHIVE_S3_ROOT: "s3://archive-test/base",
    AWS_ARCHIVE_PROFILE: "archive-test",
    AWS_ARCHIVE_EXPECTED_ACCOUNT_ID: "123456789012",
    AWS_ARCHIVE_EXPECTED_ROLE_ARN:
      "arn:aws:iam::123456789012:role/archive-mover",
    AWS_ARCHIVE_STORAGE_CLASS: "DEEP_ARCHIVE",
    AWS_ARCHIVE_SSE: "AES256",
    AWS_ARCHIVE_SSE_KMS_KEY_ID: "",
    KOMONDOR_READY_URL: "http://127.0.0.1:1/ready",
    ARCHIVE_TEST_S3: storePath,
  };
});
afterAll(async () => {
  await mongo.disconnect();
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});
beforeEach(async () => {
  await mongo.dropDatabase();
  await fs.rm(env.DATASTORE_ROOT, { recursive: true, force: true });
  source = `${env.DATASTORE_ROOT}/group/project`;
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(`${source}/a.fastq`, "first complete sequencing file\n");
  await fs.writeFile(`${source}/b.fastq`, "second complete sequencing file\n");
  id = new mongo.mongoose.Types.ObjectId();
  await db()
    .collection("projects")
    .insertOne({ _id: id, name: "Archive test", path: "/group/project" });
  await db().collection("users").insertOne({ username: "alice" });
  await writeStore({ objects: {}, uploads: [] });
});

test("full lifecycle validates exact bytes and refuses each independent deletion hazard", async () => {
  const planned = await cli("plan");
  expect(JSON.parse(planned.stdout).destination).toBe(
    "s3://archive-test/base/group/project",
  );
  expect((await project()).archiveMigration).toBeUndefined();
  expectSuccess(await lock());
  expectSuccess(await copy());
  const verified = await project();
  expect(verified.storage.state).toBe("aws_pending_hpc_deletion");
  const store = await readStore();
  const key = "base/group/project/a.fastq";
  const original = structuredClone(store.objects[key]);
  const manifestKey = verified.archiveMigration.manifests.sourceS3Uri.replace(
    "s3://archive-test/",
    "",
  );
  const bytes = Buffer.from(store.objects[manifestKey].body, "base64");
  expect(sha256Bytes(bytes)).toBe(
    verified.archiveMigration.manifests.sourceSha256,
  );
  expect(store.uploads.filter((upload) => upload.stdin)).toHaveLength(2);
  expect(store.uploads.find((upload) => upload.key === key)).toMatchObject({
    stdin: true,
    size: String(original.head.ContentLength),
    profile: "archive-test",
  });
  expect(
    Buffer.from(original.body, "base64").equals(
      await fs.readFile(`${source}/a.fastq`),
    ),
  ).toBe(true);

  const refuseDeletion = async () => {
    const result = await cli("deletion-command");
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain("rm -rf");
  };
  for (const mutate of [
    (o) => {
      delete o.head.ChecksumCRC64NVME;
    },
    (o) => {
      o.head.ChecksumCRC64NVME = "different";
    },
    (o) => {
      delete o.head.ChecksumType;
    },
    (o) => {
      o.head.ChecksumType = "COMPOSITE";
    },
    (o) => {
      o.head.ContentLength += 1;
    },
    (o) => {
      o.head.Metadata["komondor-migration-id"] = "foreign";
    },
    (o) => {
      o.head.StorageClass = "ONEZONE_IA";
    },
    (o) => {
      o.head.StorageClass = "REDUCED_REDUNDANCY";
    },
  ]) {
    store.objects[key] = structuredClone(original);
    mutate(store.objects[key]);
    await writeStore(store);
    await refuseDeletion();
  }
  delete store.objects[key];
  await writeStore(store);
  await refuseDeletion();
  store.objects[key] = original;
  store.objects["base/group/project/extra"] = original;
  await writeStore(store);
  await refuseDeletion();
  delete store.objects["base/group/project/extra"];
  await writeStore(store);
  await fs.writeFile(`${source}/new-output`, "unarchived");
  await refuseDeletion();
  await fs.unlink(`${source}/new-output`);
  // Changing a directory's timestamps does not change its archived content.
  const deletion = await cli("deletion-command");
  expectSuccess(deletion);
  expect(deletion.stdout).toContain(`rm -rf -- '${source}'`);
  expect((await fs.stat(source)).isDirectory()).toBe(true); // CLI never deletes.
  expect(
    (await cli("confirm-absent", "--confirmed-by", "alice", "--execute")).code,
  ).toBe(1);
  await fs.rm(source, { recursive: true }); // Test-owned disposable fixture only.
  expectSuccess(
    await cli("confirm-absent", "--confirmed-by", "alice", "--execute"),
  );
  expect((await project()).storage.state).toBe("aws");
});

test("real failed transfer preserves source and resumes with sealed storage class", async () => {
  expectSuccess(await lock());
  const store = await readStore();
  store.failUploadSuffix = "b.fastq";
  await writeStore(store);
  expect((await copy()).code).toBe(3);
  const failed = await project();
  expect(failed.storage.state).toBe("migrating");
  expect(failed.archiveMigration.phase).toBe("copying");
  expect((await cli("deletion-command")).stdout).not.toContain("rm -rf");
  const partial = await readStore();
  delete partial.failUploadSuffix;
  await writeStore(partial);
  env.AWS_ARCHIVE_STORAGE_CLASS = "STANDARD";
  try {
    expectSuccess(
      await cli(
        "resume",
        "--migration-id",
        failed.archiveMigration.id,
        "--resumed-by",
        "alice",
        "--execute",
      ),
    );
  } finally {
    env.AWS_ARCHIVE_STORAGE_CLASS = "DEEP_ARCHIVE";
  }
  const complete = await readStore();
  expect(complete.objects["base/group/project/b.fastq"].head.StorageClass).toBe(
    "DEEP_ARCHIVE",
  );
  expect(
    complete.uploads.filter((item) => item.key.endsWith("a.fastq")),
  ).toHaveLength(1);
  expect((await project()).archiveMigration.manifests.sourceSha256).toBe(
    failed.archiveMigration.manifests.sourceSha256,
  );
  expect((await project()).storage.state).toBe("aws_pending_hpc_deletion");
});
