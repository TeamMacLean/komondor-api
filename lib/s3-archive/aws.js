const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const { Crc64Nvme } = require("../utils/crc64nvme");
const { s3Uri } = require("./config");

class AwsCliError extends Error {
  constructor(message, { args = [], code, stderr = "" } = {}) {
    super(message);
    this.name = "AwsCliError";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

const missingObjectError = (error) =>
  error &&
  /(?:Not Found|NoSuchKey|\b404\b)/i.test(error.stderr || error.message);

class AwsCli {
  constructor(config, options = {}) {
    this.config = config;
    this.execFile = options.execFile || execFile;
    this.spawn = options.spawn || spawn;
    this.env = { ...process.env, AWS_PAGER: "" };
  }

  run(args, { json = true, maxBuffer = 64 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      this.execFile(
        "aws",
        [...args, ...(json ? ["--output", "json", "--no-cli-pager"] : [])],
        { env: this.env, encoding: "utf8", maxBuffer },
        (error, stdout, stderr) => {
          if (error) {
            return reject(
              new AwsCliError(
                `AWS CLI failed: aws ${args.join(" ")} (${String(stderr || error.message).trim()})`,
                { args, code: error.code, stderr: String(stderr || "") },
              ),
            );
          }

          if (!json) {
            return resolve(String(stdout || stderr || "").trim());
          }

          const value = String(stdout || "").trim();
          if (!value) {
            return resolve({});
          }
          try {
            return resolve(JSON.parse(value));
          } catch (parseError) {
            return reject(
              new AwsCliError(
                `AWS CLI returned invalid JSON: ${parseError.message}`,
                {
                  args,
                  stderr: String(stderr || ""),
                },
              ),
            );
          }
        },
      );
    });
  }

  version() {
    return this.run(["--version"], { json: false });
  }

  getCallerIdentity() {
    return this.run(["sts", "get-caller-identity"]);
  }

  headBucket() {
    return this.run(["s3api", "head-bucket", "--bucket", this.config.bucket]);
  }

  listRootProbe() {
    return this.run([
      "s3api",
      "list-objects-v2",
      "--bucket",
      this.config.bucket,
      "--prefix",
      this.config.basePrefix ? `${this.config.basePrefix}/` : "",
      "--max-keys",
      "1",
    ]);
  }

  async hasObjects(prefix) {
    const result = await this.run([
      "s3api",
      "list-objects-v2",
      "--bucket",
      this.config.bucket,
      "--prefix",
      prefix,
      "--max-keys",
      "1",
    ]);
    return (
      Number(result.KeyCount || 0) > 0 || (result.Contents || []).length > 0
    );
  }

  async hasObjectsAtOrBelow(prefix) {
    if (await this.headObject(prefix)) return true;
    return this.hasObjects(`${prefix.replace(/\/+$/, "")}/`);
  }

  async listObjectsAtOrBelow(prefix) {
    const clean = prefix.replace(/\/+$/, "");
    const [exact, children] = await Promise.all([
      this.headObject(clean),
      this.listObjects(`${clean}/`),
    ]);
    return exact
      ? [
          { Key: clean, Size: Number(exact.ContentLength), ...exact },
          ...children,
        ]
      : children;
  }

  async headObject(key) {
    try {
      return await this.run([
        "s3api",
        "head-object",
        "--bucket",
        this.config.bucket,
        "--key",
        key,
        "--checksum-mode",
        "ENABLED",
      ]);
    } catch (error) {
      if (missingObjectError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listObjects(prefix) {
    const objects = [];
    let token;
    do {
      const args = [
        "s3api",
        "list-objects-v2",
        "--bucket",
        this.config.bucket,
        "--prefix",
        prefix,
      ];
      if (token) {
        args.push("--continuation-token", token);
      }
      const page = await this.run(args);
      objects.push(...(page.Contents || []));
      token = page.IsTruncated ? page.NextContinuationToken : null;
    } while (token);
    return objects;
  }

  async listMultipartUploads(prefix) {
    const uploads = [];
    let keyMarker;
    let uploadIdMarker;
    do {
      const args = [
        "s3api",
        "list-multipart-uploads",
        "--bucket",
        this.config.bucket,
        "--prefix",
        prefix,
      ];
      if (keyMarker) args.push("--key-marker", keyMarker);
      if (uploadIdMarker) args.push("--upload-id-marker", uploadIdMarker);
      const page = await this.run(args);
      uploads.push(...(page.Uploads || []));
      keyMarker = page.IsTruncated ? page.NextKeyMarker : null;
      uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : null;
    } while (keyMarker);
    return uploads;
  }

  abortMultipartUpload(key, uploadId) {
    return this.run([
      "s3api",
      "abort-multipart-upload",
      "--bucket",
      this.config.bucket,
      "--key",
      key,
      "--upload-id",
      uploadId,
    ]);
  }

  async getObjectBuffer(key) {
    const uri = s3Uri(this.config.bucket, key);
    const args = ["s3", "cp", uri, "-", "--only-show-errors", "--no-cli-pager"];

    // Manifests are content-addressed. Do not route them through run(), which
    // intentionally trims human-readable command output: trimming one final
    // newline would change the SHA-256 of the downloaded object.
    return new Promise((resolve, reject) => {
      this.execFile(
        "aws",
        args,
        {
          env: this.env,
          encoding: "buffer",
          maxBuffer: 1024 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            return reject(
              new AwsCliError(
                `AWS CLI failed: aws ${args.join(" ")} (${Buffer.from(
                  stderr || error.message || "",
                )
                  .toString("utf8")
                  .trim()})`,
                {
                  args,
                  code: error.code,
                  stderr: Buffer.from(stderr || "").toString("utf8"),
                },
              ),
            );
          }
          return resolve(Buffer.from(stdout || ""));
        },
      );
    });
  }

  async putControlObject(key, bytes, metadata = {}) {
    const tempDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), "komondor-s3-archive-"),
    );
    const bodyPath = path.join(tempDirectory, "body.json");
    try {
      await fsp.writeFile(bodyPath, bytes, { mode: 0o600, flag: "wx" });
      const args = [
        "s3api",
        "put-object",
        "--bucket",
        this.config.bucket,
        "--key",
        key,
        "--body",
        bodyPath,
        "--content-type",
        "application/json",
        "--checksum-algorithm",
        "CRC64NVME",
        "--if-none-match",
        "*",
      ];
      if (Object.keys(metadata).length > 0) {
        args.push(
          "--metadata",
          Object.entries(metadata)
            .map(([name, value]) => `${name}=${value}`)
            .join(","),
        );
      }
      args.push(...this.config.s3ApiSseArgs);
      return await this.run(args);
    } finally {
      await fsp.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  async uploadHandle(handle, { key, size, metadata }) {
    const uri = s3Uri(this.config.bucket, key);
    const args = [
      "s3",
      "cp",
      "-",
      uri,
      "--expected-size",
      String(size),
      "--checksum-algorithm",
      "CRC64NVME",
      "--content-type",
      "application/octet-stream",
      "--metadata",
      Object.entries(metadata)
        .map(([name, value]) => `${name}=${value}`)
        .join(","),
      ...this.config.sseArgs,
      "--only-show-errors",
      "--no-cli-pager",
    ];

    const child = this.spawn("aws", args, {
      env: this.env,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const sha256 = crypto.createHash("sha256");
    const crc64 = new Crc64Nvme();
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        sha256.update(chunk);
        crc64.update(chunk);
        callback(null, chunk);
      },
    });

    const readStream = handle.createReadStream({
      autoClose: false,
      start: 0,
    });
    const childResult = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) return resolve();
        reject(
          new AwsCliError(
            `AWS upload failed for ${key} (exit ${code}${signal ? `, ${signal}` : ""}): ${stderr.trim()}`,
            { args, code, stderr },
          ),
        );
      });
    });

    try {
      await Promise.all([
        pipeline(readStream, meter, child.stdin),
        childResult,
      ]);
    } catch (error) {
      if (!child.killed) child.kill("SIGTERM");
      throw error;
    }

    return {
      bytes,
      sha256: sha256.digest("hex"),
      crc64nvme: crc64.toBase64(),
    };
  }
}

module.exports = {
  AwsCli,
  AwsCliError,
  missingObjectError,
};
