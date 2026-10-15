#!/usr/bin/env node
// Real-AWS acceptance rehearsal, isolated under _smoke/<UUID>. No Mongo access.
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { AwsCli } = require("../lib/s3-archive/aws");
const {
  loadArchiveConfig,
  joinKey,
  SMOKE_SEGMENT,
  s3Uri,
} = require("../lib/s3-archive/config");
const { validateAws } = require("../lib/s3-archive/preflight");
const { createInventory } = require("../lib/s3-archive/inventory");
const {
  serializeManifest,
  sha256Bytes,
  parseAndVerifyManifest,
} = require("../lib/s3-archive/manifest");
const {
  copyManifestEntries,
  verifyManifestObjects,
} = require("../lib/s3-archive/upload");

const SIZES = [1024, 16 * 1024 ** 2, 6 * 1024 ** 3]; // Includes a mandatory >5 GiB multipart object.
const usage =
  "archive-s3-smoke.js prepare|upload|restore|verify-restore --work-dir /absolute/new/scratch [--execute]";
const restored = (head) => {
  const restore = head.Restore || "";
  const expiry = /expiry-date="([^"]+)"/.exec(restore);
  return (
    /ongoing-request="false"/.test(restore) &&
    expiry &&
    Date.parse(expiry[1]) > Date.now()
  );
};

// A usage mistake is the operator's, not a fault to debug, so it is reported
// as the invocation alone. Everything else keeps its stack trace.
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

const parseArgs = (argv) => {
  const [command, ...flags] = argv;
  if (!["prepare", "upload", "restore", "verify-restore"].includes(command))
    throw new UsageError(usage);
  let workDir,
    execute = false;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === "--work-dir" && !workDir) workDir = flags[++i];
    else if (flags[i] === "--execute" && !execute) execute = true;
    else throw new UsageError(usage);
  }
  if (!workDir || !path.isAbsolute(workDir)) throw new UsageError(usage);
  return { command, workDir: path.resolve(workDir), execute };
};

const runSmoke = async (
  { command, workDir, execute },
  { config, aws, sizes = SIZES, log = console.log },
) => {
  if (command !== "verify-restore" && !execute) {
    log(
      JSON.stringify({
        command,
        workDir,
        dryRun: true,
        sizes,
        next: "Review scratch path and AWS configuration, then add --execute",
      }),
    );
    return 0;
  }
  const identity = await validateAws(aws, config);
  const manifestPath = path.join(workDir, "source-manifest.v1.json");
  if (command === "prepare") {
    // Fail if this directory already exists. An interrupted preparation is
    // disposable; choose a NEW directory rather than modifying sealed sources.
    await fs.mkdir(workDir, { mode: 0o700 });
    workDir = await fs.realpath(workDir);
    const sourceRoot = path.join(workDir, "source");
    await fs.mkdir(sourceRoot);
    for (const size of sizes) {
      const handle = await fs.open(
        path.join(sourceRoot, `${size}-bytes.bin`),
        "wx",
        0o600,
      );
      try {
        await handle.truncate(size);
        const marker = crypto.randomBytes(Math.min(256, size));
        await handle.write(marker, 0, marker.length, 0);
        await handle.write(marker, 0, marker.length, size - marker.length);
      } finally {
        await handle.close();
      }
    }
    log("Hashing disposable source files; the largest is 6 GiB.");
    const inventory = await createInventory(sourceRoot);
    const id = crypto.randomUUID();
    const dataKeyPrefix = joinKey(
      config.basePrefix,
      SMOKE_SEGMENT,
      id,
      "payload",
    );
    const manifest = {
      manifestVersion: 1,
      kind: "smoke-source",
      projectId: `smoke-${id}`,
      migrationId: id,
      sourceRoot,
      dataKeyPrefix,
      dataPrefix: s3Uri(config.bucket, dataKeyPrefix),
      dataStorageClass: "DEEP_ARCHIVE",
      createdAt: new Date().toISOString(),
      entries: inventory.entries.map((entry) => ({
        ...entry,
        s3Key:
          entry.disposition === "copy"
            ? joinKey(dataKeyPrefix, entry.relPath)
            : null,
      })),
    };
    await fs.writeFile(manifestPath, serializeManifest(manifest), {
      flag: "wx",
      mode: 0o600,
    });
    log(
      JSON.stringify({
        prepared: true,
        manifestPath,
        destination: manifest.dataPrefix,
        identity,
      }),
    );
    return 0;
  }
  workDir = await fs.realpath(workDir);
  const bytes = await fs.readFile(manifestPath);
  const { manifest, sha256 } = parseAndVerifyManifest(bytes);
  const prefix = joinKey(
    config.basePrefix,
    SMOKE_SEGMENT,
    manifest.migrationId,
    "payload",
  );
  if (
    !/^[a-f0-9-]{36}$/.test(manifest.migrationId) ||
    manifest.kind !== "smoke-source" ||
    manifest.sourceRoot !== path.join(workDir, "source") ||
    manifest.dataKeyPrefix !== prefix ||
    manifest.dataPrefix !== s3Uri(config.bucket, prefix) ||
    manifest.dataStorageClass !== "DEEP_ARCHIVE" ||
    manifest.entries.some(
      (entry) =>
        entry.disposition === "copy" &&
        entry.s3Key !== joinKey(prefix, entry.relPath),
    )
  ) {
    throw new Error(
      "Smoke manifest does not match this scratch directory and archive configuration",
    );
  }
  manifest.sourceManifestSha256 = sha256;
  const controlKey = joinKey(
    config.basePrefix,
    SMOKE_SEGMENT,
    manifest.migrationId,
    "source-manifest.v1.json",
  );
  const existing = await aws.headObject(controlKey);
  if (existing) {
    const remote = await aws.getObjectBuffer(controlKey);
    if (!remote.equals(bytes))
      throw new Error("Smoke control manifest changed");
  } else if (command === "upload") {
    await aws.putControlObject(controlKey, bytes);
    if (!(await aws.getObjectBuffer(controlKey)).equals(bytes))
      throw new Error("Smoke control manifest did not round-trip");
  } else throw new Error("Upload this rehearsal before requesting a restore");

  if (command === "upload") {
    await copyManifestEntries(aws, manifest.sourceRoot, manifest, {
      onProgress: (progress) => log(JSON.stringify(progress)),
    });
  }
  const verification = await verifyManifestObjects(aws, manifest);
  if (!verification.verified || !verification.storageClass.matches) {
    throw new Error(
      `Smoke objects did not verify in DEEP_ARCHIVE: ${JSON.stringify(
        verification,
      )}`,
    );
  }
  const entries = manifest.entries.filter(
    (entry) => entry.disposition === "copy",
  );
  if (command === "restore") {
    for (const entry of entries) {
      const head = await aws.headObject(entry.s3Key);
      if (/ongoing-request="true"/.test(head.Restore || "") || restored(head))
        continue;
      await aws.restoreObject(entry.s3Key);
    }
    log(
      "Restore requested (Standard tier, 2 days). Run verify-restore after S3 completes the requests.",
    );
    return 0;
  }
  if (command === "verify-restore") {
    for (const entry of entries) {
      const head = await aws.headObject(entry.s3Key);
      if (!restored(head)) {
        log(
          `Restore pending or absent: ${entry.s3Key}. No passing receipt written.`,
        );
        return 1;
      }
    }
    const downloads = [];
    for (const entry of entries) {
      const actual = await aws.downloadObjectDigest(entry.s3Key);
      if (
        actual.bytes !== entry.size ||
        actual.sha256 !== entry.sha256 ||
        actual.crc64nvme !== entry.crc64nvme
      ) {
        throw new Error(
          `Restored bytes do not match the sealed source: ${entry.relPath}`,
        );
      }
      downloads.push({ s3Key: entry.s3Key, ...actual });
    }
    const receiptPath = path.join(
      workDir,
      `restore-verified-${Date.now()}.json`,
    );
    await fs.writeFile(
      receiptPath,
      serializeManifest({
        verified: true,
        checkedAt: new Date().toISOString(),
        identity,
        sourceManifestSha256: sha256Bytes(bytes),
        dataPrefix: manifest.dataPrefix,
        downloads,
      }),
      { flag: "wx", mode: 0o600 },
    );
    log(JSON.stringify({ verified: true, receiptPath }));
    return 0;
  }
  const reportPath = path.join(workDir, `upload-verified-${Date.now()}.json`);
  await fs.writeFile(
    reportPath,
    serializeManifest({
      ...verification,
      identity,
      sourceManifestSha256: sha256,
    }),
    { flag: "wx", mode: 0o600 },
  );
  log(
    JSON.stringify({
      verified: true,
      reportPath,
      next: "restore --execute, then verify-restore",
    }),
  );
  return 0;
};

const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const options = parseArgs(process.argv.slice(2));
  const config = loadArchiveConfig({
    ...process.env,
    DATASTORE_ROOT: options.workDir,
  });
  return runSmoke(options, { config, aws: new AwsCli(config) });
};
if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        error instanceof UsageError
          ? `${error.message}\n`
          : `${error.stack || error.message}\n`,
      );
      process.exitCode = 2;
    });
module.exports = { UsageError, parseArgs, runSmoke, SIZES };
