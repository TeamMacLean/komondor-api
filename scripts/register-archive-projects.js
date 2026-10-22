#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
const registration = require("../lib/archive-registration");

const usage = `Administrative registration of existing archive directories.
prepare --targets FILE --work-dir DIR --database NAME --actor USER
apply --work-dir DIR --database NAME --actor USER --backup-plan FILE
      --plan-sha256 HASH --quiescence-receipt FILE --execute
inspect --project-id ID --database NAME

MONGODB_URI and DATASTORE_ROOT must be explicit. prepare writes only local
evidence; apply inserts new Project records with history. No file moves, mail,
payload hashing, existing-record updates, deletion or archival are performed.
`;
const toolVersion = () => crypto.createHash("sha256").update([
  "scripts/register-archive-projects.js", "lib/archive-registration.js",
  "lib/project-registration-history.js", "models/Project.js",
  "lib/s3-archive/inventory.js", "lib/s3-archive/preflight.js",
].map((name) => fs.readFileSync(path.resolve(__dirname, "..", name))).reduce(
  (out, bytes) => Buffer.concat([out, Buffer.from(String(bytes.length) + ":"), bytes]), Buffer.alloc(0),
)).digest("hex");

function parse(args) {
  if (!args.length || args.includes("--help")) return { help: true };
  const command = args.shift(), result = { command };
  const allowed = {
    prepare: ["targets", "work-dir", "database", "actor"],
    apply: ["work-dir", "database", "actor", "backup-plan", "plan-sha256", "quiescence-receipt", "execute"],
    inspect: ["project-id", "database"],
  }[command];
  if (!allowed) throw Error("Unknown command");
  while (args.length) {
    if (!args[0].startsWith("--")) throw Error("Expected a named --argument");
    const flag = args.shift().replace(/^--/, "");
    if (!allowed.includes(flag) || Object.hasOwn(result, flag)) throw Error("Unexpected/duplicate argument");
    result[flag] = flag === "execute" ? true : args.shift();
    if (!result[flag] || String(result[flag]).startsWith("--")) throw Error(`Missing --${flag} value`);
  }
  for (const flag of allowed) if (!result[flag]) throw Error(`Required: --${flag}`);
  return result;
}

async function main(args = process.argv.slice(2)) {
  const options = parse(args);
  if (options.help) { process.stdout.write(usage); return; }
  if (!process.env.MONGODB_URI || !process.env.DATASTORE_ROOT) throw Error("Set explicit MONGODB_URI and DATASTORE_ROOT");
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false, autoCreate: false, useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 10000,
  });
  try {
    const db = mongoose.connection.db;
    if (db.databaseName !== options.database) throw Error("Connected database does not match --database");
    const info = await db.listCollections({ name: "projects" }).toArray();
    if (info.length !== 1) throw Error("Existing projects collection required");
    const databaseIdentity = { name: db.databaseName, host: mongoose.connection.host, port: mongoose.connection.port,
      collectionUuid: info[0].info?.uuid?.toString("hex") || null };
    if (!databaseIdentity.collectionUuid) throw Error("Cannot establish projects collection identity");
    const common = { db, databaseIdentity, datastoreRoot: process.env.DATASTORE_ROOT,
      workDir: options["work-dir"], actor: options.actor, toolVersion: toolVersion() };
    let result;
    if (options.command === "prepare") result = await registration.prepare({ ...common,
      targetsBytes: await registration.readRegular(options.targets) });
    else if (options.command === "apply") result = await registration.apply({ ...common,
      backupPlan: options["backup-plan"], expectedSha256: options["plan-sha256"], execute: options.execute,
      receipt: JSON.parse(await registration.readRegular(options["quiescence-receipt"])) });
    else {
      if (!/^[a-fA-F0-9]{24}$/.test(options["project-id"])) throw Error("Invalid project ID");
      const project = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(options["project-id"]) },
        { projection: { _id: 1, registrationProvenance: 1, reconciliationHistory: 1 } });
      if (!project) throw Error("Project not found");
      result = project;
    }
    process.stdout.write(registration.encode(result));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch((error) => {
  process.stderr.write(String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, "[redacted Mongo URI]") + "\n");
  process.exitCode = 1;
});
module.exports = { main, parse, toolVersion };
