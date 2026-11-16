const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs").promises;
const { mongoose, connect, dropDatabase, disconnect } = require("./support/mongo");
const { configureEnv, restoreEnv } = require("./support/env");
// Report fixtures need no indexes; other suites deliberately poison indexes.
// Disable model DDL before compilation and isolate this suite's scratch state.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
const Group = require("../../models/Group");
const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");
const { buildReport } = require("../../scripts/hpc-deletion-due-report");
const execute = promisify(execFile);
const oid = (date) => mongoose.Types.ObjectId.createFromTime(Date.parse(date) / 1000);
let configured;

beforeAll(async () => {
  const uri = new URL(process.env.MONGODB_URI || "mongodb://invalid/invalid");
  if (!["127.0.0.1", "localhost"].includes(uri.hostname) || uri.username || uri.password ||
      !/^komondor-(integration-test|ci|hpc-preservation-test-[a-z0-9-]+)$/.test(uri.pathname.slice(1))) {
    throw new Error("Report integration tests require an explicit loopback scratch database");
  }
  configured = await configureEnv("hpc-due-report");
  await connect();
});
beforeEach(dropDatabase);
afterAll(async () => { await disconnect(); await restoreEnv(configured); });

const seed = async () => {
  const group = new mongoose.Types.ObjectId();
  await Group.collection.insertOne({ _id: group, name: "Synthetic group", safeName: "synthetic" });
  const projects = [
    { _id: oid("2010-01-01Z"), name: "Old active", preserveOnHpcUntil: new Date("2026-10-31T23:59:59.999Z") },
    { _id: oid("2011-01-01Z"), name: "Recent run" },
    { _id: oid("2012-01-01Z"), name: "Invalid zero", preserveOnHpcUntil: 0 },
    { _id: oid("2013-01-01Z"), name: "Invalid string", preserveOnHpcUntil: "2027-01-01" },
    { _id: oid("2014-01-01Z"), name: "Retired", reconciliation: { retiredAt: new Date() } },
    { _id: oid("2015-01-01Z"), name: "Manual disposal" },
    { _id: oid("2016-01-01Z"), name: "Pending verified", storage: {
      state: "aws_pending_hpc_deletion", s3Uri: "s3://synthetic-bucket/project", s3VerifiedAt: new Date("2026-10-01Z"),
    } },
    { _id: oid("2017-01-01Z"), name: "Retired run ignored" },
  ].map((project, i) => ({ group, owner: "synthetic-owner", safeName: `synthetic${i}`, path: `/synthetic/project${i}`, ...project }));
  await Project.collection.insertMany(projects);
  const samples = [1, 6, 7].map((i) => ({ _id: new mongoose.Types.ObjectId(), project: projects[i]._id }));
  await Sample.collection.insertMany(samples);
  await Run.collection.insertMany([
    { _id: oid("2026-01-01Z"), sample: samples[0]._id },
    { _id: oid("2026-02-01Z"), sample: samples[1]._id },
    { _id: oid("2026-03-01Z"), sample: samples[2]._id, reconciliation: { retiredAt: new Date() } },
  ]);
  await mongoose.connection.db.collection("archiveReconciliations").insertOne({
    project: projects[5]._id, disposition: "existing-approved-direct-disposal", executionStatus: "reconciled", entryId: "synthetic-001",
  });
  return projects;
};

const snapshot = async () => {
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const result = {};
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    result[name] = { documents: await db.collection(name).find({}).sort({ _id: 1 }).toArray(), indexes: await db.collection(name).indexes() };
  }
  return JSON.stringify(result);
};

test("joins newest Runs, hides retired records, retains invalid BSON and manual dispositions without writes", async () => {
  await seed();
  const before = await snapshot();
  const report = await buildReport({ Project, Sample, Run, db: mongoose.connection.db,
    now: new Date("2026-11-16T12:00:00.000Z"), webAppUrl: "https://example.test", years: 5 });
  expect(report.rows.map((row) => row.project_name)).toEqual([
    "Manual disposal", "Retired run ignored", "Pending verified", "Old active", "Invalid zero", "Invalid string",
  ]);
  expect(report.counts).toEqual({ overdue: 4, dueWithinWindow: 0, notYetOnAws: 5, keepDatesExpiring: 0, invalid: 2 });
  expect(report.rows.find((row) => row.project_name === "Manual disposal").notes).toContain("manual disposal without an AWS copy");
  expect(report.rows.find((row) => row.project_name === "Pending verified")).toMatchObject({
    eligible_from: "2026-10-01", age_basis_at: "2026-02-01T00:00:00.000Z", on_aws: "yes",
  });
  expect(await snapshot()).toBe(before);
});

test("real CLI writes stdout or file, logs test email only to stderr, and leaves database unchanged", async () => {
  await seed();
  const before = await snapshot();
  const script = path.resolve(__dirname, "../../scripts/hpc-deletion-due-report.js");
  const env = { ...process.env, NODE_ENV: "test", WEB_APP_URL: "https://example.test", HPC_DUE_REPORT_TO: "review@example.test", HPC_RETENTION_YEARS: "5" };
  const { stdout, stderr } = await execute(process.execPath, [script, "--within-months", "6", "--email"], { env });
  expect(stdout).toMatch(/^owner_username,group_name,project_name,/);
  expect(stdout).not.toContain("EMAIL");
  expect(stderr).toContain("EMAIL (NOT SENT)");
  expect(stdout).toContain("invalid keep date");
  const out = path.join(configured.base, "report.csv");
  const fileRun = await execute(process.execPath, [script, "--out", out], { env });
  expect(fileRun.stdout).toBe("");
  expect(await fs.readFile(out, "utf8")).toBe(stdout);
  expect(await snapshot()).toBe(before);
});


test("storage locations exposes asynchronous retention dates and raw malformed values", async () => {
  const projects = await seed();
  const { projectStorageLocations } = require("../../lib/project-storage-locations");
  const recent = await Project.findById(projects[1]._id);
  const result = await projectStorageLocations(recent);
  expect(result).toMatchObject({ ageBasisAt: "2026-01-01T00:00:00.000Z", archiveDueAt: "2031-01-01T00:00:00.000Z", hpcDeletionEligibleAt: "2031-01-01T00:00:00.000Z" });
  const invalid = await Project.findById(projects[2]._id);
  expect(await projectStorageLocations(invalid)).toMatchObject({ hpcPreservationInvalid: true, hpcDeletionEligibleAt: null });
});
