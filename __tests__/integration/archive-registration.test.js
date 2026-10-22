const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const { BSON } = require("bson");
const mongo = require("./support/mongo");
mongo.mongoose.set("autoIndex", false);
mongo.mongoose.set("autoCreate", false);
require("../../models/Group");
const Project = require("../../models/Project");
const registration = require("../../lib/archive-registration");
const { toolVersion } = require("../../scripts/register-archive-projects");
const db = () => mongo.mongoose.connection.db;
let scratch, datastoreRoot, workDir, backupPlan, context, input, stoppedUrl;

beforeAll(async () => {
  await mongo.connect();
  scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "archive-registration-")));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  stoppedUrl = `http://127.0.0.1:${server.address().port}/ready`;
  await new Promise((resolve) => server.close(resolve));
});
afterAll(async () => { await mongo.disconnect(); if (scratch) await fs.rm(scratch, { recursive: true, force: true }); });
beforeEach(async () => {
  await mongo.dropDatabase();
  await fs.rm(scratch, { recursive: true, force: true });
  datastoreRoot = path.join(scratch, "data"); workDir = path.join(scratch, "evidence");
  backupPlan = path.join(scratch, "backup", "plan.json");
  await fs.mkdir(path.dirname(backupPlan), { recursive: true });
  const group = new mongo.mongoose.Types.ObjectId();
  await db().collection("groups").insertOne({ _id: group, safeName: "group", name: "group", deleted: false });
  await db().collection("users").insertOne({ username: "winj", name: "Joe Win" });
  await db().createCollection("projects");
  for (const field of ["name", "safeName", "path"]) await db().collection("projects").createIndex({ [field]: 1 }, { unique: true });
  input = { schemaVersion: 1, batchId: "2026-10-16", targets: ["Courville", "Saunders.Mixed_Case"].map((name, i) => ({
    entryId: `extra-${i}`, relativePath: `/group/${name}`, name, groupSafeName: "group", owner: "winj",
    observedUnixOwner: "root", expectedFiles: 1, expectedBytes: 7,
    decisionAuthority: "George selected custodian", sourceReference: { originalEntryId: `extra-${i}`, sourceName: name, originalOwner: null },
  })) };
  for (const t of input.targets) {
    await fs.mkdir(path.join(datastoreRoot, t.relativePath), { recursive: true });
    await fs.writeFile(path.join(datastoreRoot, t.relativePath, "data.bin"), "payload");
  }
  context = { db: db(), databaseIdentity: { name: db().databaseName, uuid: "scratch-only" },
    datastoreRoot, workDir, actor: "george", toolVersion: toolVersion() };
});
const prepare = () => registration.prepare({ ...context, targetsBytes: registration.encode(input) });
async function setup() {
  const prepared = await prepare();
  await fs.copyFile(prepared.planPath, backupPlan);
  const receipt = { recordedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
    actor: "george", planSha256: prepared.planSha256, allApiInstancesStopped: true, powerPaused: true,
    externalWritersFrozen: true, backupIndependentlyRetained: true, apiReadyUrls: [stoppedUrl] };
  return { ...context, backupPlan, expectedSha256: prepared.planSha256, execute: true, receipt };
}
const all = () => db().collection("projects").find({}).sort({ path: 1 }).toArray();
const snapshot = async () => Promise.all((await db().listCollections().toArray()).sort((a,b)=>a.name.localeCompare(b.name))
  .map(async ({ name }) => ({ name, indexes: await db().collection(name).indexes(), documents: await db().collection(name).find({}).toArray() })));

test("prepare is database-read-only, records absent before state, literal roots and original owner evidence", async () => {
  const before = await snapshot();
  await prepare();
  expect(await snapshot()).toEqual(before);
  const plan = JSON.parse(await fs.readFile(path.join(workDir, "plan.json")));
  expect(plan.operations).toHaveLength(2);
  expect(plan.operations[0]).toMatchObject({ before: { exists: false }, target: { name: "Courville", observedUnixOwner: "root" } });
  expect(plan.operations[0].observation.rootStat).toHaveProperty("uid");
  expect(plan.operations[0].observation.entries[0]).not.toHaveProperty("sha256");
  await expect(prepare()).rejects.toThrow("EEXIST");
});

test("registration and complete creation history are inserted together without touching payloads or creating dependents/news", async () => {
  const options = await setup();
  const before = await fs.stat(path.join(datastoreRoot, "group/Courville/data.bin"));
  const result = await registration.apply(options);
  expect(result.completed).toBe(2);
  const projects = await all();
  expect(projects.map(p=>p.path)).toEqual(["/group/Courville", "/group/Saunders.Mixed_Case"]);
  for (const p of projects) {
    expect(p.owner).toBe("winj"); expect(p.nudgeable).toBe(false); expect(p.doNotSendToEna).toBe(true);
    expect(p.createdAt).toBeInstanceOf(Date);
    expect(p.reconciliationHistory).toHaveLength(1);
    expect(p.reconciliationHistory[0]).toMatchObject({ before: { exists: false }, actor: "george", after: { owner: "winj", path: p.path } });
    expect(p.registrationProvenance.originalScientificOwner).toBeNull();
    expect(p.registrationProvenance.sourceUnixOwner).toBe("root");
    expect(p).not.toHaveProperty("secondaryOwner");
  }
  expect((await db().listCollections().toArray()).map(c=>c.name).sort()).toEqual(["groups", "projects", "users"]);
  const after = await fs.stat(path.join(datastoreRoot, "group/Courville/data.bin"));
  for (const key of ["ino", "size", "uid", "gid", "mtimeMs", "ctimeMs"]) expect(after[key]).toBe(before[key]);
  const exported = new BSON().deserialize(await fs.readFile(path.join(workDir, result.results[0].exportName)));
  expect(exported._id.equals(projects[0]._id)).toBe(true);
  expect(exported.createdAt).toEqual(projects[0].createdAt);
});

test("crash after insert leaves its history intact and retry recovers without duplicating any record", async () => {
  const options = await setup();
  await expect(registration.apply({ ...options, afterInsert: async () => { throw Error("simulated crash"); } })).rejects.toThrow("simulated crash");
  const first = await all(); expect(first).toHaveLength(1); expect(first[0].reconciliationHistory).toHaveLength(1);
  expect((await fs.readdir(workDir)).filter(name=>name.startsWith("failed-"))).toHaveLength(1);
  const result = await registration.apply(options);
  expect(result.results.map(r=>r.outcome)).toEqual(["verified-existing-operation", "created"]);
  expect(await db().collection("projects").countDocuments()).toBe(2);
  expect((await all())[0]).toEqual(first[0]);
  const again = await registration.apply(options);
  expect(again.results.every(r=>r.outcome === "verified-existing-operation")).toBe(true);
  expect((await all()).map(p=>p.reconciliationHistory.length)).toEqual([1,1]);
  // The independent plan embeds its exact targets; no original checkout input
  // is needed to recover a lost convenience targets.json file.
  await fs.unlink(path.join(workDir,"targets.json"));
  expect((await registration.apply(options)).completed).toBe(2);
});

test("resume refuses later edits and never restores an old document over them", async () => {
  const options = await setup(); await registration.apply(options);
  const id = (await all())[0]._id;
  await db().collection("projects").updateOne({ _id: id }, { $set: { longDesc: "later human edit" } });
  await expect(registration.apply(options)).rejects.toThrow("Existing record differs");
  expect((await db().collection("projects").findOne({ _id: id })).longDesc).toBe("later human edit");
});

test.each(["digest", "backup", "database", "tool", "targets", "expired", "power", "execute"])("refuses invalid %s evidence before any insert", async (kind) => {
  const options = await setup();
  if (kind === "digest") options.expectedSha256 = "0".repeat(64);
  if (kind === "backup") await fs.appendFile(backupPlan, " ");
  if (kind === "database") options.databaseIdentity = { name: "other" };
  if (kind === "tool") options.toolVersion = "other";
  if (kind === "targets") await fs.appendFile(path.join(workDir, "targets.json"), " ");
  if (kind === "expired") options.receipt.expiresAt = new Date(Date.now()-1).toISOString();
  if (kind === "power") options.receipt.powerPaused = false;
  if (kind === "execute") options.execute = false;
  await expect(registration.apply(options)).rejects.toThrow();
  expect(await all()).toEqual([]);
});

test("same-size source changes refuse the whole batch, even in its final target", async () => {
  const options = await setup();
  await fs.utimes(path.join(datastoreRoot, "group/Saunders.Mixed_Case/data.bin"), new Date(), new Date(Date.now()+5000));
  await expect(registration.apply(options)).rejects.toThrow("Tree changed");
  expect(await all()).toEqual([]);
});

test("later database claims refuse registration rather than adopting another project", async () => {
  const options = await setup();
  await db().collection("projects").insertOne({ name: "courville", safeName: "courville", path: "/group/courville" });
  await expect(registration.apply(options)).rejects.toThrow("Project claim conflicts");
  expect(await db().collection("projects").countDocuments()).toBe(1);
});

test.each(["orphan", "symlink", "totals", "index", "custodian", "group"])("prepare refuses %s discrepancies without a database write", async (kind) => {
  if (kind === "orphan") await db().collection("files").insertOne({ path: "/group/Courville/data.bin" });
  if (kind === "symlink") await fs.symlink("data.bin", path.join(datastoreRoot, "group/Courville/alias"));
  if (kind === "totals") input.targets[0].expectedBytes++;
  if (kind === "index") await db().collection("projects").dropIndex("path_1");
  if (kind === "custodian") input.targets[0].owner = "unknown";
  if (kind === "group") await db().collection("groups").updateOne({}, { $set: { deleted: true } });
  const before = await snapshot();
  await expect(prepare()).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});

test("active API and unfinished ingest both block execution", async () => {
  const options = await setup();
  const server = http.createServer((_req,res)=>res.end("running"));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    await expect(registration.apply({ ...options, receipt: { ...options.receipt, apiReadyUrls: [`http://127.0.0.1:${server.address().port}/ready`] } })).rejects.toThrow("still answering");
  } finally { await new Promise(resolve=>server.close(resolve)); }
  await db().collection("ingestjobs").insertOne({ status: "claimed", payload: { additionalFile: { path: "/group/Courville/extra" } } });
  await expect(registration.apply(options)).rejects.toThrow("has not drained");
  expect(await all()).toEqual([]);
});

test("later model saves preserve mixed-case roots and ordinary updates cannot erase history or identities", async () => {
  await registration.apply(await setup());
  const id = (await all())[0]._id;
  const p = await Project.findById(id);
  expect(p.toJSON()).not.toHaveProperty("registrationProvenance");
  expect(p.toJSON()).not.toHaveProperty("reconciliationHistory");
  expect(await p.getRelativePath()).toBe("group/Courville");
  p.shortDesc = "Updated description";
  await p.save();
  expect((await db().collection("projects").findOne({ _id: id })).path).toBe("/group/Courville");
  expect(await db().collection("newsitems").countDocuments()).toBe(0);
  await expect(Project.updateOne({ _id: id }, { $unset: { registrationProvenance: "" } })).rejects.toThrow("append-only");
  await expect(Project.updateOne({ _id: id }, { $push: { reconciliationHistory: { forged: true } } })).rejects.toThrow("append-only");
  expect(await Project.findByIdAndUpdate(id, { $set: { path: "/group/courville" } }, { new: true })).toBeNull();
  expect((await Project.deleteOne({ _id: id })).deletedCount).toBe(0);
  const withHistory = await Project.findById(id).select("+reconciliationHistory");
  withHistory.reconciliationHistory = [];
  await expect(withHistory.save({ validateBeforeSave: false })).rejects.toThrow("append-only");
  const identity = await Project.findById(id); identity.owner = "other";
  await expect(identity.save()).rejects.toThrow("owner is pinned");
  const result = await Project.findByIdAndUpdate(id, { $set: { "storage.state": "migrating" } }, { new: true });
  expect(result.storage.state).toBe("migrating");
});

test("real CLI prepares and applies to the explicit scratch database and inspect exports history", async () => {
  const targetFile = path.join(scratch, "targets.json"); await fs.writeFile(targetFile, registration.encode(input));
  const invoke = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/register-archive-projects.js"), ...args], {
      env: { ...process.env, DATASTORE_ROOT: datastoreRoot }, stdio: ["ignore","pipe","pipe"],
    }); let stdout="", stderr="";
    child.stdout.on("data", c=>stdout+=c); child.stderr.on("data",c=>stderr+=c); child.on("error",reject);
    child.on("close",code=>resolve({ code, stdout, stderr }));
  });
  const prepared = await invoke(["prepare", "--targets", targetFile, "--work-dir", workDir, "--database", db().databaseName, "--actor", "george"]);
  expect(prepared.stderr).toBe(""); expect(prepared.code).toBe(0);
  const data = JSON.parse(prepared.stdout); await fs.copyFile(data.planPath, backupPlan);
  const receiptPath=path.join(scratch,"quiescence.json");
  await fs.writeFile(receiptPath,JSON.stringify({ recordedAt:new Date(Date.now()-1000).toISOString(), expiresAt:new Date(Date.now()+600000).toISOString(), actor:"george",planSha256:data.planSha256,allApiInstancesStopped:true,powerPaused:true,externalWritersFrozen:true,backupIndependentlyRetained:true,apiReadyUrls:[stoppedUrl] }));
  const applied=await invoke(["apply","--work-dir",workDir,"--database",db().databaseName,"--actor","george","--backup-plan",backupPlan,"--plan-sha256",data.planSha256,"--quiescence-receipt",receiptPath,"--execute"]);
  expect(applied.stderr).toBe("");expect(applied.code).toBe(0);
  const inspected=await invoke(["inspect","--project-id",String((await all())[0]._id),"--database",db().databaseName]);
  expect(inspected.code).toBe(0);expect(JSON.parse(inspected.stdout).reconciliationHistory).toHaveLength(1);
});

test("bulk operations, document deletion, replacement and insertMany cannot bypass provenance protection", async () => {
  await registration.apply(await setup());
  const original = (await all())[0], id = original._id;
  await expect(Project.insertMany([{ ...original, _id: new mongo.mongoose.Types.ObjectId() }])).rejects.toThrow("administrative CLI");
  await expect(Project.bulkWrite([{ updateOne: { filter: { _id: id }, update: { $unset: { reconciliationHistory: "" } } } }])).rejects.toThrow("append-only");
  await Project.bulkWrite([{ updateOne: { filter: { _id: id }, update: { $set: { owner: "other" } } } }, { deleteOne: { filter: { _id: id } } }]);
  await Project.replaceOne({ _id: id }, { name: "replacement" });
  await expect((await Project.findById(id)).deleteOne()).rejects.toThrow("Retain registered project history");
  await expect((await Project.findById(id).select("name")).remove()).rejects.toThrow("Retain registered project history");
  expect(await db().collection("projects").findOne({ _id: id })).toEqual(original);
});
