// Only run through test-keep-dates.py, which starts an isolated temporary mongod.
(async () => {
if (!/^komondor-retention-test-[a-f0-9]{8}$/.test(db.getName())) throw new Error("Scratch database required");
const fs = require("fs"), nodePath = require("path");
const script = nodePath.join(__dirname, "keep-dates.mongosh.js");
const source = fs.readFileSync(script, "utf8");
const plan = JSON.parse(source.split("const plan = ")[1].split(";\n  const protectedIds")[0]);
const protectedIds = ["6ae4ac89a6b876c643741d27", "61204424e788b405b6ce6bde", "611ff26de788b405b6ce6a4c", "5fd1ed55d8dd4a63058cc1c9", "5fdb2d62d7661b6ec22a0571"];
const actualDb = db, coll = db.projects;
const encode = (v) => EJSON.stringify(v, { relaxed: false });
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const snapshot = async () => encode(await coll.find().sort({ _id: 1 }).toArray());
const seed = async () => {
  await coll.deleteMany({});
  await coll.insertMany([...plan.map((p) => ({ _id: ObjectId(p.id), name: p.path.split("/").pop(), path: p.path,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
    storage: { state: p.requestedBy === "Sara" ? "aws_pending_hpc_deletion" : "hpc", s3VerifiedAt: new Date("2026-11-02") },
    archiveMigration: { id: "keep-this-value", phase: "verified" },
    untouched: { number: NumberInt(7), long: NumberLong("9007199254740993"), decimal: NumberDecimal("1.234"), double: Double(1.25), nested: ["literal", { value: "retain" }] },
  })), ...protectedIds.map((id) => ({ _id: ObjectId(id), name: "protected", path: "/ntalbot/protected-" + id,
    preserveOnHpcUntil: new Date("2030-01-01"), keep: "unchanged" }))]);
};
const quiet = printjson;
printjson = () => {};
await load(script);
let passed = 0;
const test = async (name, body) => { db = actualDb; await seed(); await body(); passed++; print("PASS " + name); };
const rejectsNoWrites = async (change) => {
  await change(); const before = await snapshot(); let failed = false;
  try { await komondorKeepDates("apply"); } catch (_) { failed = true; }
  assert(failed, "expected refusal"); assert(await snapshot() === before, "preflight wrote data");
};
await test("preview never writes; full apply preserves unrelated data and five Gulnara records", async () => {
  const before = await snapshot(); await komondorKeepDates("preview"); assert(await snapshot() === before, "preview wrote");
  await komondorKeepDates("apply"); await komondorKeepDates("verify");
  const docs = await coll.find({ _id: { $in: plan.map((p) => ObjectId(p.id)) } }).toArray();
  assert(docs.length === 12, "wrong count");
  assert(docs.filter((d) => d.hpcPreservationRequestedBy === "Joe Win" && d.preserveOnHpcUntil.toISOString() === "2031-11-26T23:59:59.999Z").length === 11, "Joe dates wrong");
  const sara = docs.find((d) => String(d._id) === "5fc012bda3efcb29338b7d58");
  assert(sara.preserveOnHpcUntil.toISOString() === "2027-11-26T23:59:59.999Z" && sara.hpcPreservationRequestedBy === "Sara", "Sara date wrong");
  for (const d of docs) assert(d.hpcPreservationHistory.length === 1 && d.archiveMigration.id === "keep-this-value", "audit/storage damaged");
  for (const d of await coll.find({ _id: { $in: protectedIds.map((id) => ObjectId(id)) } }).toArray()) assert(d.keep === "unchanged" && !d.hpcPreservationHistory, "Gulnara changed");
  const once = await snapshot(); await komondorKeepDates("apply"); assert(await snapshot() === once, "retry duplicated or changed records");
});
await test("missing last target refuses before any updates", () => rejectsNoWrites(() => coll.deleteOne({ _id: ObjectId(plan[11].id) })));
await test("wrong final target path refuses before any updates", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[11].id) }, { $set: { path: "/wrong" } })));
await test("retired target refuses before any updates", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[11].id) }, { $set: { "reconciliation.retiredAt": new Date() } })));
await test("retired null marker refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[11].id) }, { $set: { "reconciliation.retiredAt": null } })));
await test("malformed false storage state refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[11].id) }, { $set: { "storage.state": false } })));
await test("malformed BSON date refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { preserveOnHpcUntil: "2031-11-26" } })));
await test("numeric BSON date refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { preserveOnHpcUntil: 0 } })));
await test("different existing hold is never shortened", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { preserveOnHpcUntil: new Date("2040-01-01") } })));
await test("orphan metadata refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { hpcPreservationReason: "Another decision" } })));
await test("malformed history refuses", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { hpcPreservationHistory: null } })));
await test("missing protected Gulnara destination refuses", () => rejectsNoWrites(() => coll.deleteOne({ _id: ObjectId(protectedIds[0]) })));
await test("matching fields without audit are not silently adopted", () => rejectsNoWrites(() => coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { preserveOnHpcUntil: new Date(plan[0].until), hpcPreservationRequestedBy: plan[0].requestedBy, hpcPreservationReason: plan[0].reason } })));
await test("legacy history without requester/reason is retained", async () => {
  const event = { at: new Date("2020-01-01"), by: "older-admin", previousUntil: null, until: null };
  await coll.updateOne({ _id: ObjectId(plan[0].id) }, { $set: { preserveOnHpcUntil: null, hpcPreservationHistory: [event] } });
  await komondorKeepDates("apply");
  const h = (await coll.findOne({ _id: ObjectId(plan[0].id) })).hpcPreservationHistory;
  assert(h.length === 2 && encode(h[0]) === encode(event), "legacy history changed");
});
await test("concurrent edit stops after one update; inspected retry adopts it without duplicate audit", async () => {
  let writes = 0;
  const prototype = Object.getPrototypeOf(coll), originalUpdate = prototype.updateOne;
  prototype.updateOne = async function (...args) {
    if (++writes === 2) await originalUpdate.call(coll, { _id: ObjectId(plan[1].id) }, { $set: { unrelatedConcurrentEdit: true } });
    return originalUpdate.apply(this, args);
  };
  let failed = false;
  try { await komondorKeepDates("apply"); } catch (_) { failed = true; }
  finally { prototype.updateOne = originalUpdate; }
  assert(failed, "CAS did not refuse");
  assert(await coll.countDocuments({ hpcPreservationHistory: { $exists: true } }) === 1, "continued after conflict");
  assert((await coll.findOne({ _id: ObjectId(plan[1].id) })).unrelatedConcurrentEdit === true, "overwrote concurrent edit");
  await komondorKeepDates("apply"); await komondorKeepDates("verify");
  assert((await coll.findOne({ _id: ObjectId(plan[0].id) })).hpcPreservationHistory.length === 1, "duplicate audit on adoption");
});
printjson = quiet;
print("PASSED " + passed + " real-MongoDB scenarios");
})();
