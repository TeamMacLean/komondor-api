// Administrative registration only: never moves files, hashes payloads, invokes
// model save hooks, sends mail, or modifies an existing database document.
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { ObjectId, BSON } = require("bson");
const { walkTree } = require("./s3-archive/inventory");
const { validateProjectRoot, apiAppearsStopped } = require("./s3-archive/preflight");

const bson = new BSON();
const fail = (message) => { throw new Error(message); };
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && value._bsontype === "ObjectID") return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
};
const encode = (value) => Buffer.from(JSON.stringify(canonical(value), null, 2) + "\n");
const equal = (a, b) => encode(a).equals(encode(b));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const statFields = (s) => Object.fromEntries(
  ["dev", "ino", "mode", "uid", "gid", "size", "mtimeMs", "ctimeMs"].map((k) => [k, s[k]]),
);
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

async function readRegular(filename) {
  const absolute = path.resolve(filename);
  if (await fs.realpath(absolute) !== absolute || !(await fs.lstat(absolute)).isFile()) {
    fail(`Evidence must be a canonical regular file: ${absolute}`);
  }
  return fs.readFile(absolute);
}

// Never replace an earlier record; fsync before making a database write possible.
async function writeOnce(filename, bytes) {
  const handle = await fs.open(filename, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  const dir = await fs.open(path.dirname(filename), "r");
  try { await dir.sync(); } finally { await dir.close(); }
}

async function evidenceDirectory(directory, datastoreRoot) {
  const absolute = path.resolve(directory);
  const repositoryRoot = path.resolve(__dirname, "..");
  if (inside(repositoryRoot, absolute) || inside(datastoreRoot, absolute)) {
    fail("Execution evidence must be outside the checkout and DATASTORE_ROOT");
  }
  await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
  if (await fs.realpath(absolute) !== absolute) fail("Evidence directory must not contain symlinks");
  return absolute;
}

function validateTargets(input) {
  if (input.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]+$/.test(input.batchId || "") ||
      !Array.isArray(input.targets) || !input.targets.length) fail("Invalid registration target document");
  const ids = new Set(), roots = new Set(), names = new Set();
  for (const t of input.targets) {
    if (!/^[a-zA-Z0-9_-]+$/.test(t.entryId || "") || ids.has(t.entryId)) fail("Invalid/duplicate entry ID");
    // The batch consists of group/project roots, not arbitrary subtrees. Preserve
    // literal ASCII spelling, including case and dots; do not normalise it away.
    if (!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(t.relativePath || "") ||
        t.relativePath.split("/").some((s) => s === "." || s === "..")) fail("Unsafe project root");
    const parts = t.relativePath.slice(1).split("/");
    if (parts[0] !== t.groupSafeName || parts[1] !== t.name) fail("Group/name must match the literal root");
    if (!/^[a-zA-Z0-9_-]+$/.test(t.owner || "") || !t.decisionAuthority || !t.sourceReference) fail("Missing custodian/authority/source");
    if (!Number.isSafeInteger(t.expectedFiles) || t.expectedFiles < 1 ||
        !Number.isSafeInteger(t.expectedBytes) || t.expectedBytes < 0) fail("Expected file totals required");
    if (roots.has(t.relativePath.toLowerCase()) || names.has(t.name.toLowerCase())) fail("Conflicting target roots/names");
    ids.add(t.entryId); roots.add(t.relativePath.toLowerCase()); names.add(t.name.toLowerCase());
  }
  return input;
}

async function requireIndexes(db) {
  const indexes = await db.collection("projects").indexes();
  for (const field of ["name", "safeName", "path"]) {
    if (!indexes.some((i) => i.unique && !i.sparse && !i.partialFilterExpression &&
        Object.keys(i.key).length === 1 && i.key[field] === 1)) {
      fail(`Required full unique projects.${field} index is absent; deploy indexes separately`);
    }
  }
}

async function observeTree(datastoreRoot, target) {
  const { sourceRoot } = await validateProjectRoot({ datastoreRoot }, { path: target.relativePath });
  const before = statFields(await fs.lstat(sourceRoot));
  const tree = await walkTree(sourceRoot);
  const after = statFields(await fs.lstat(sourceRoot));
  if (!equal(before, after)) fail(`Root changed during observation: ${target.entryId}`);
  if (tree.entries.some((e) => !["file", "dir"].includes(e.type))) fail(`Nonregular entry: ${target.entryId}`);
  const files = tree.entries.filter((e) => e.type === "file");
  if (files.length !== target.expectedFiles || files.reduce((n, f) => n + f.size, 0) !== target.expectedBytes) {
    fail(`File totals changed: ${target.entryId}`);
  }
  return { sourceRoot, rootStat: before, entries: tree.entries, observedAt: new Date().toISOString() };
}

async function contextFor(db, target) {
  const groups = await db.collection("groups").find({ safeName: target.groupSafeName }).toArray();
  const users = await db.collection("users").find({ username: target.owner }, { projection: { _id: 1, username: 1, name: 1 } }).toArray();
  if (groups.length !== 1 || groups[0].deleted || groups[0].isDeleted) fail(`Missing/ambiguous/inactive group: ${target.groupSafeName}`);
  if (users.length !== 1) fail(`Missing/ambiguous custodian: ${target.owner}`);
  return { group: { _id: String(groups[0]._id), safeName: groups[0].safeName },
    custodian: { _id: String(users[0]._id), username: users[0].username, name: users[0].name || null } };
}

async function requireUnclaimed(db, target, ownId = null) {
  const projects = await db.collection("projects").find({}, { projection: { _id: 1, name: 1, safeName: 1, path: 1 } }).toArray();
  const root = target.relativePath.toLowerCase();
  for (const p of projects) {
    if (ownId && String(p._id) === ownId) continue;
    const other = typeof p.path === "string" ? "/" + p.path.replace(/^\/+|\/+$/g, "").toLowerCase() : null;
    if ([p.name, p.safeName].some((v) => typeof v === "string" && v.toLowerCase() === target.name.toLowerCase()) ||
        (other && (other === root || other.startsWith(root + "/") || root.startsWith(other + "/")))) {
      fail(`Project claim conflicts with ${target.entryId}: ${p._id}`);
    }
  }
  const prefix = new RegExp("^/?" + escapeRegex(target.relativePath.slice(1)) + "(?:/|$)", "i");
  for (const collection of ["samples", "runs", "files", "additionalfiles"]) {
    if (await db.collection(collection).findOne({ $or: [{ path: prefix }, { "file.path": prefix }] }, { projection: { _id: 1 } })) {
      fail(`Existing ${collection} claim under ${target.entryId}; review associations first`);
    }
  }
  if (ownId) {
    const id = new ObjectId(ownId);
    for (const collection of ["samples", "additionalfiles"]) {
      if (await db.collection(collection).findOne({ project: { $in: [id, ownId] } }, { projection: { _id: 1 } })) {
        fail(`Registered project has acquired ${collection}; stop and review`);
      }
    }
  }
}

async function prepare({ db, databaseIdentity, datastoreRoot, targetsBytes, workDir, actor, toolVersion }) {
  if (!actor) fail("Actor is required");
  const input = validateTargets(JSON.parse(targetsBytes));
  await requireIndexes(db);
  const operations = [];
  for (const target of input.targets) {
    const context = await contextFor(db, target);
    await requireUnclaimed(db, target);
    const observation = await observeTree(datastoreRoot, target);
    operations.push({ operationId: crypto.randomUUID(), projectId: String(new ObjectId()), target,
      context, before: { exists: false, collection: "projects" }, observation });
  }
  const plan = { schemaVersion: 1, kind: "register-existing-archive-projects", batchId: input.batchId,
    preparedAt: new Date().toISOString(), preparedBy: actor, toolVersion, databaseIdentity,
    datastoreRoot: path.resolve(datastoreRoot), targetsSha256: sha256(targetsBytes), operations };
  // Makes the independent plan copy sufficient to recover an interrupted bundle.
  plan.targetsBase64 = targetsBytes.toString("base64");
  const directory = await evidenceDirectory(workDir, plan.datastoreRoot);
  const bytes = encode(plan);
  await writeOnce(path.join(directory, "plan.json"), bytes);
  await writeOnce(path.join(directory, "targets.json"), targetsBytes);
  return { planPath: path.join(directory, "plan.json"), planSha256: sha256(bytes), operations: operations.length, databaseWrites: 0 };
}

function projectDocument(plan, op, planSha256, actor, at) {
  const identity = { name: op.target.name, safeName: op.target.name, path: op.target.relativePath,
    owner: op.target.owner, group: new ObjectId(op.context.group._id) };
  const registrationProvenance = { version: 1, batchId: plan.batchId, entryId: op.target.entryId,
    operationId: op.operationId, identity, planSha256, sourceReference: op.target.sourceReference,
    sourceRoot: op.observation.sourceRoot, rootStat: op.observation.rootStat,
    sourceUnixOwner: op.target.observedUnixOwner || null,
    observedAt: op.observation.observedAt, ownerRole: "administrative-custodian",
    originalScientificOwner: null, beforeExists: false };
  const values = { _id: new ObjectId(op.projectId), ...identity,
    shortDesc: `Administrative archive registration: ${op.target.entryId}`,
    longDesc: `Existing directory registered retrospectively for batch ${plan.batchId}. Custodian selected by ${op.target.decisionAuthority}. Original scientific ownership remains unresolved; see retained reconciliation history.`,
    nudgeable: false, nudges: [], doNotSendToEna: true,
    doNotSendToEnaReason: "Archive-only administrative registration; no ENA submission authorized.",
    isPublic: false, storage: { state: "hpc" }, createdAt: at, updatedAt: at, __v: 0 };
  return { ...values, registrationProvenance, reconciliationHistory: [{
    version: 1, kind: "administrative-registration", batchId: plan.batchId,
    operationId: op.operationId, at, actor, osUser: os.userInfo().username,
    decisionAuthority: op.target.decisionAuthority, reason: "Register existing unclaimed tree without moving bytes",
    before: { exists: false }, after: values, planSha256, toolVersion: plan.toolVersion,
  }] };
}

async function quiescence(db, receipt, digest, actor) {
  const now = Date.now(), recorded = Date.parse(receipt.recordedAt), expiry = Date.parse(receipt.expiresAt);
  if (receipt.planSha256 !== digest || receipt.actor !== actor || !Number.isFinite(recorded) ||
      !Number.isFinite(expiry) || recorded > now || expiry <= now || expiry - recorded > 3600000 ||
      receipt.allApiInstancesStopped !== true || receipt.powerPaused !== true ||
      receipt.externalWritersFrozen !== true || receipt.backupIndependentlyRetained !== true ||
      !Array.isArray(receipt.apiReadyUrls) || !receipt.apiReadyUrls.length) fail("Missing/expired quiescence and independent-backup receipt");
  for (const url of receipt.apiReadyUrls) {
    if (!/^https?:\/\//.test(url)) fail("Invalid API readiness URL");
    await apiAppearsStopped(url);
  }
  if (await db.collection("ingestjobs").findOne({ status: { $nin: ["done", "failed"] } }) ||
      await db.collection("runs").findOne({ $or: [{ status: { $in: ["pending", "processing"] } }, { md5VerificationStatus: "in_progress" }] })) {
    fail("Ingest/run/MD5 work has not drained");
  }
}

async function apply({ db, databaseIdentity, datastoreRoot, workDir, backupPlan, expectedSha256, actor, receipt, execute, toolVersion, afterInsert }) {
  if (!execute) fail("Apply requires --execute; prepare is read-only");
  const directory = await evidenceDirectory(workDir, path.resolve(datastoreRoot));
  const filename = path.join(directory, "plan.json");
  const bytes = await readRegular(filename), digest = sha256(bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "") || digest !== expectedSha256) fail("Reviewed plan digest differs");
  const backup = path.resolve(backupPlan);
  if (inside(directory, backup) || inside(path.resolve(__dirname, ".."), backup) || inside(path.resolve(datastoreRoot), backup) ||
      !(await readRegular(backup)).equals(bytes)) fail("Independent backup plan does not match");
  const originalStat = await fs.stat(filename), backupStat = await fs.stat(backup);
  if (originalStat.dev === backupStat.dev && originalStat.ino === backupStat.ino) fail("Backup is the same file/hard link");
  const plan = JSON.parse(bytes);
  if (plan.schemaVersion !== 1 || plan.kind !== "register-existing-archive-projects" ||
      plan.datastoreRoot !== path.resolve(datastoreRoot) || !equal(plan.databaseIdentity, databaseIdentity) ||
      plan.toolVersion !== toolVersion) fail("Plan belongs to a different database, datastore or tool version");
  const targetsBytes = Buffer.from(plan.targetsBase64 || "", "base64");
  if (sha256(targetsBytes) !== plan.targetsSha256) fail("Target evidence differs");
  try {
    if (!(await readRegular(path.join(directory, "targets.json"))).equals(targetsBytes)) fail("Target evidence differs");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const input = validateTargets(JSON.parse(targetsBytes));
  if (input.batchId !== plan.batchId || !equal(input.targets, plan.operations.map((o) => o.target)) ||
      new Set(plan.operations.map((o) => o.projectId)).size !== plan.operations.length ||
      new Set(plan.operations.map((o) => o.operationId)).size !== plan.operations.length) fail("Plan operations differ from targets");
  await requireIndexes(db);
  const existing = new Map();
  // Check the entire batch before the first insert. Still recheck each operation
  // below; after a mid-batch failure the retained successes are resumable.
  for (const op of plan.operations) {
    const found = await db.collection("projects").findOne({ _id: new ObjectId(op.projectId) });
    if (found) {
      const event = found.reconciliationHistory?.[0];
      if (!event || event.actor !== actor || !(event.at instanceof Date) ||
          !equal(found, projectDocument(plan, op, digest, actor, event.at))) fail(`Existing record differs: ${op.target.entryId}`);
      existing.set(op.projectId, found);
    }
    if (!equal(await contextFor(db, op.target), op.context)) fail(`Group/custodian changed: ${op.target.entryId}`);
    await requireUnclaimed(db, op.target, found ? op.projectId : null);
    const current = await observeTree(datastoreRoot, op.target);
    if (!equal(current.rootStat, op.observation.rootStat) || !equal(current.entries, op.observation.entries)) fail(`Tree changed since plan: ${op.target.entryId}`);
  }
  await quiescence(db, receipt, digest, actor);
  const runId = crypto.randomUUID();
  await writeOnce(path.join(directory, `execution-${runId}.json`), encode({ at: new Date(), actor, planSha256: digest, receipt }));
  const results = [];
  try {
  for (const op of plan.operations) {
    await quiescence(db, receipt, digest, actor);
    if (!equal(await contextFor(db, op.target), op.context)) fail(`Group/custodian changed: ${op.target.entryId}`);
    await requireUnclaimed(db, op.target, existing.has(op.projectId) ? op.projectId : null);
    const current = await observeTree(datastoreRoot, op.target);
    if (!equal(current.rootStat, op.observation.rootStat) || !equal(current.entries, op.observation.entries)) fail(`Tree changed: ${op.target.entryId}`);
    let document = existing.get(op.projectId);
    if (!document) {
      document = projectDocument(plan, op, digest, actor, new Date());
      // Complete creation document and history enter MongoDB together. No save
      // hook is involved; no NewsItem, file, Sample or Run is manufactured.
      await db.collection("projects").insertOne(document, { writeConcern: { w: "majority", j: true } });
      if (afterInsert) await afterInsert(op); // Injectable crash boundary for integration tests.
    }
    const actual = await db.collection("projects").findOne({ _id: document._id });
    if (!equal(actual, document)) fail(`Post-insert verification failed: ${op.target.entryId}`);
    // A fresh filename on retry preserves the interrupted run's evidence.
    const recordBytes = bson.serialize(actual);
    const exportName = `created-${op.target.entryId}-${runId}.bson`;
    await writeOnce(path.join(directory, exportName), recordBytes);
    const result = { entryId: op.target.entryId, projectId: op.projectId, operationId: op.operationId,
      outcome: existing.has(op.projectId) ? "verified-existing-operation" : "created",
      after: canonical(actual), exportName, exportSha256: sha256(recordBytes), at: new Date() };
    await writeOnce(path.join(directory, `result-${op.target.entryId}-${runId}.json`), encode(result));
    results.push(result);
  }
  } catch (error) {
    await writeOnce(path.join(directory, `failed-${runId}.json`), encode({
      runId, planSha256: digest, at: new Date(), error: error.message,
      receiptCount: results.length, recordedEntries: results.map((r) => r.entryId),
      note: "An insert may have committed before its file receipt. Resume verifies the database history; do not assume unreceipted means absent.",
    }));
    throw error;
  }
  const summary = { runId, planSha256: digest, completed: results.length, results };
  await writeOnce(path.join(directory, `completed-${runId}.json`), encode(summary));
  return summary;
}

module.exports = { prepare, apply, validateTargets, projectDocument, encode, sha256, readRegular,
  writeOnce, evidenceDirectory, quiescence, statFields };
