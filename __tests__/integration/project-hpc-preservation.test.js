const express = require("express");
const request = require("supertest");
const mongo = require("./support/mongo");

mongo.mongoose.set("autoIndex", false);
mongo.mongoose.set("autoCreate", false);
let mockUser = { username: "deeks", isAdmin: true };
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    if (!mockUser) return res.status(401).send({ error: "Authentication required" });
    req.user = mockUser;
    return next();
  },
}));

const Project = require("../../models/Project");
const projectsRouter = require("../../routes/projects");
const { lockProject } = require("../../lib/s3-archive/state");
const app = express();
app.use(express.json());
app.use(projectsRouter);

const db = () => mongo.mongoose.connection.db;
const until = "2027-11-13T23:59:59.999Z";
let projectId;
const storedProject = () => db().collection("projects").findOne({ _id: projectId });
const preserve = (value, expected = null) => request(app)
  .put("/project/hpc-preservation")
  .send({ _id: String(projectId), preserveOnHpcUntil: value, expectedPreserveOnHpcUntil: expected });

beforeAll(async () => {
  // The suite deletes scratch fixtures. Never allow the ordinary application
  // database or a remote server, even if a developer inherited its environment.
  const uri = new URL(process.env.MONGODB_URI || "mongodb://invalid/invalid");
  const name = uri.pathname.slice(1);
  if (
    uri.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1"].includes(uri.hostname) ||
    uri.username || uri.password ||
    !(/^(komondor-ci|komondor-integration-test|komondor-hpc-preservation-test-[a-z0-9-]+)$/.test(name))
  ) throw new Error("HPC preservation integration tests require an explicit loopback scratch database.");
  await mongo.connect();
});

afterAll(async () => { await mongo.disconnect(); });

beforeEach(async () => {
  await mongo.dropDatabase();
  mockUser = { username: "deeks", isAdmin: true };
  projectId = new mongo.mongoose.Types.ObjectId();
  await db().collection("projects").insertOne({
    _id: projectId,
    name: "HPC retention fixture",
    safeName: "hpc_retention_fixture",
    path: "/fixture/hpc_retention_fixture",
    owner: "owner",
    group: new mongo.mongoose.Types.ObjectId(),
    shortDesc: "Scratch fixture",
    longDesc: "Only in an isolated integration database",
    storage: { state: "hpc" },
  });
});

test("unauthenticated and non-admin requests cannot mutate real MongoDB records", async () => {
  const before = await storedProject();
  mockUser = null;
  expect((await preserve(until)).status).toBe(401);
  mockUser = { username: "owner", isAdmin: false };
  expect((await preserve(until)).status).toBe(403);
  expect(await storedProject()).toEqual(before);
});

test("setting and clearing persist BSON Dates and audit atomically while public JSON hides history", async () => {
  const before = await storedProject();
  const start = new Date();
  const set = await preserve(until);
  expect(set.status).toBe(200);
  expect(set.body).toEqual({ projectId: String(projectId), preserveOnHpcUntil: until });
  const withDate = await storedProject();
  expect(withDate.preserveOnHpcUntil).toEqual(new Date(until));
  expect(withDate.storage).toEqual(before.storage);
  expect(withDate.path).toBe(before.path);
  expect(withDate.hpcPreservationHistory).toHaveLength(1);
  expect(withDate.hpcPreservationHistory[0]).toEqual({
    at: expect.any(Date), by: "deeks", previousUntil: null, until: new Date(until),
  });
  expect(withDate.hpcPreservationHistory[0].at.getTime()).toBeGreaterThanOrEqual(start.getTime());
  const normal = await Project.findById(projectId);
  expect(normal.hpcPreservationHistory).toBeUndefined();
  const selected = await Project.findById(projectId).select("+hpcPreservationHistory");
  expect(selected.hpcPreservationHistory).toHaveLength(1);
  const publicJson = JSON.parse(JSON.stringify(selected));
  expect(publicJson.preserveOnHpcUntil).toBe(until);
  expect(publicJson.storage.preserveOnHpcUntil).toBe(until);
  expect(publicJson).not.toHaveProperty("hpcPreservationHistory");

  const cleared = await preserve(null, until);
  expect(cleared.status).toBe(200);
  expect(cleared.body.preserveOnHpcUntil).toBeNull();
  const after = await storedProject();
  expect(after.preserveOnHpcUntil).toBeNull();
  expect(after.hpcPreservationHistory).toHaveLength(2);
  expect(after.hpcPreservationHistory[0]).toEqual(withDate.hpcPreservationHistory[0]);
  expect(after.hpcPreservationHistory[1]).toEqual({
    at: expect.any(Date), by: "deeks", previousUntil: new Date(until), until: null,
  });
  expect(after.storage).toEqual(before.storage);
  expect(await db().collection("newsitems").countDocuments()).toBe(0);
});

test("two administrators using the same stale missing value produce one write and one audit entry", async () => {
  const otherUntil = "2028-11-13T23:59:59.999Z";
  const results = await Promise.all([preserve(until), preserve(otherUntil)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const winner = results.find(result => result.status === 200).body.preserveOnHpcUntil;
  const stored = await storedProject();
  expect(stored.preserveOnHpcUntil).toEqual(new Date(winner));
  expect(stored.hpcPreservationHistory).toHaveLength(1);
  expect(stored.hpcPreservationHistory[0].until).toEqual(new Date(winner));
  expect(stored.hpcPreservationHistory[0].previousUntil).toBeNull();
});

test("the actual archive lock replaces storage without discarding the hold or its history", async () => {
  expect((await preserve(until)).status).toBe(200);
  const before = await storedProject();
  const now = new Date();
  const migrationId = String(new mongo.mongoose.Types.ObjectId());
  await lockProject(Project, projectId, {
    s3Uri: "s3://scratch-only/fixture/hpc_retention_fixture",
    archiveMigration: {
      id: migrationId, phase: "locked", movedBy: "deeks", startedAt: now, updatedAt: now,
      sourceRoot: "/scratch-only/fixture/hpc_retention_fixture",
      sourceRelativeRoot: "fixture/hpc_retention_fixture",
    },
  });
  const after = await storedProject();
  expect(after.storage).toEqual({ state: "migrating", s3Uri: "s3://scratch-only/fixture/hpc_retention_fixture" });
  expect(after.archiveMigration.id).toBe(migrationId);
  expect(after.preserveOnHpcUntil).toEqual(new Date(until));
  expect(after.hpcPreservationHistory).toEqual(before.hpcPreservationHistory);
  expect(after.path).toBe(before.path);
  expect(await db().collection("newsitems").countDocuments()).toBe(0);
});

test("retention remains editable on a reconciled verified archive without changing its sealed identity", async () => {
  const original = await storedProject();
  const now = new Date();
  await db().collection("projects").updateOne({ _id: projectId }, { $set: {
    storage: { state: "aws_pending_hpc_deletion", s3Uri: "s3://scratch-only/fixture/hpc_retention_fixture", s3VerifiedAt: now },
    archiveMigration: { id: String(new mongo.mongoose.Types.ObjectId()), phase: "verified", manifests: { sourceSha256: "sealed-source", verificationSha256: "sealed-verification" } },
    reconciliation: { version: 1, operationId: "scratch-only", identity: { name: original.name, path: original.path } },
  } });
  const before = await storedProject();
  expect((await preserve(until)).status).toBe(200);
  const after = await storedProject();
  for (const field of ["storage", "archiveMigration", "reconciliation", "path", "name"]) expect(after[field]).toEqual(before[field]);
  expect(after.preserveOnHpcUntil).toEqual(new Date(until));
  expect(after.hpcPreservationHistory).toHaveLength(1);
});
