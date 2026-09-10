#!/usr/bin/env node

const { execFileSync } = require("child_process");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");

const AdditionalFile = require("../models/AdditionalFile");
const IngestJob = require("../models/IngestJob");
const Project = require("../models/Project");
const Read = require("../models/Read");
const Run = require("../models/Run");
const Sample = require("../models/Sample");
const User = require("../models/User");
const { AwsCli } = require("../lib/s3-archive/aws");
const { runCli } = require("../lib/s3-archive/cli");
const { loadArchiveConfig } = require("../lib/s3-archive/config");
const { resolveMongoUri } = require("../lib/utils/validateEnv");

const repositoryRoot = path.resolve(__dirname, "..");

const toolVersion = () => {
  if (process.env.KOMONDOR_ARCHIVE_TOOL_VERSION) {
    return process.env.KOMONDOR_ARCHIVE_TOOL_VERSION;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_error) {
    return require("../package.json").version;
  }
};

const main = async () => {
  let config;
  try {
    config = loadArchiveConfig(process.env);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  try {
    await mongoose.connect(resolveMongoUri(process.env), {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10_000,
    });
  } catch (error) {
    process.stderr.write(`Could not connect to MongoDB: ${error.message}\n`);
    return 2;
  }

  try {
    const collections = await mongoose.connection.db
      .listCollections({ name: "projects" })
      .toArray();
    if (!collections.length) {
      process.stderr.write("MongoDB has no projects collection\n");
      return 2;
    }
    return await runCli(process.argv.slice(2), {
      mongoose,
      config,
      aws: new AwsCli(config),
      models: { AdditionalFile, IngestJob, Project, Read, Run, Sample, User },
      toolVersion: toolVersion(),
    });
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 2;
    });
}

module.exports = { main, toolVersion };
