// Operator-run, fixed-scope retention update. Loading defines a function; it does not write.
// See README.md. No storage/archiveMigration fields, files or Gulnara records are changed.
globalThis.komondorKeepDates = async function (mode = "preview") {
  const fs = require("fs"), os = require("os"), path = require("path");
  const fail = (message) => { throw new Error(message); };
  const encode = (value) => EJSON.stringify(value, { relaxed: false });
  const clone = (value) => EJSON.parse(encode(value), { relaxed: false });
  const same = (a, b) => encode(a) === encode(b);
  const host = os.hostname().split(".")[0], database = db.getName();
  const actor = os.userInfo().username;
  const endpoint = new (require("url").URL)(db.getMongo().getURI());
  const loopback = endpoint.protocol === "mongodb:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname);
  const production = host === "v1333" && database === "komondor"
    && loopback && endpoint.port === "28015";
  const scratch = host !== "v1333" && /^komondor-retention-test-[a-f0-9]{8}$/.test(database)
    && loopback && !!endpoint.port;
  if (!production && !scratch) fail("Expected v1333/komondor or an isolated local retention-test database.");
  if (production && !["deeks", "tsldata"].includes(actor)) fail("Run as deeks or tsldata on v1333.");
  if (!["preview", "apply", "verify"].includes(mode)) fail("Mode must be preview, apply or verify.");
  const plan = [
  {
    "id": "5fc012bda3efcb29338b7d58",
    "path": "/two_blades/gargy_2019_rnaseq",
    "until": "2027-11-26T23:59:59.999Z",
    "requestedBy": "Sara",
    "reason": "One year of HPC retention agreed with Sara; retain through 26 November 2027 unless an extension is requested."
  },
  {
    "id": "5fc012bda3efcb29338b7d5b",
    "path": "/skamoun/sequencing_of_mini_chromosomes_of_m__oryzae_2018",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "6054ba49d7661b6ec22a06f6",
    "path": "/skamoun/wheat_blast___zambia_2018_2020",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "5fc012bda3efcb29338b7d70",
    "path": "/skamoun/ronny_helen_pinfestans_pmirabilis_timecourse",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "61a758113545d74de71ebbec",
    "path": "/skamoun/pangenome_of_rice_infecting_magnaporthe_oryzae",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "61ee798cdecd27242ab8adb1",
    "path": "/skamoun/blast_fungi_collected_from_wild_grasses_in_germany",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "61fd5d59decd27242ab8adf3",
    "path": "/skamoun/illumina_sequencing_of_hi_c_libraries_from_selected_magnaporthe_oryzae_lineages",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "6502df19d32c7a7e4b174fe8",
    "path": "/skamoun/italian_blast_fungus_isolates_from_wild_grasses",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "6863b1c7dc823951803ac3a4",
    "path": "/skamoun/wheat_blast___bolivia_2023_24",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "65f06e07e372f7554d754873",
    "path": "/skamoun/wheat_blast___zambia_2023",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "6863e922dc823951803ac406",
    "path": "/skamoun/wheat_blast___paraguay_2023",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  },
  {
    "id": "69a81b4920a8c93a2306efc6",
    "path": "/skamoun/pacbio_hifi_and_linkprep_sequencing_of_stapelia_leendertziae",
    "until": "2031-11-26T23:59:59.999Z",
    "requestedBy": "Joe Win",
    "reason": "Keep on HPC per the Kamoun review. George assigned five years from 26 November 2026; Joe Win will be contacted and may request changes."
  }
];
  const protectedIds = [
    "6ae4ac89a6b876c643741d27", // Gulnara destination: normal age policy, no manual override.
    "61204424e788b405b6ce6bde", "611ff26de788b405b6ce6a4c",
    "5fd1ed55d8dd4a63058cc1c9", "5fdb2d62d7661b6ec22a0571",
  ];
  const ids = [...plan.map((p) => p.id), ...protectedIds];
  const fields = ["preserveOnHpcUntil", "hpcPreservationRequestedBy", "hpcPreservationReason", "hpcPreservationHistory"];
  const read = async () => db.projects.aggregate([
    { $match: { _id: { $in: ids.map((id) => ObjectId(id)) } } },
    { $project: { document: "$$ROOT", types: Object.fromEntries(fields.map((f) => [f, { $type: "$" + f }])) } },
  ]).toArray();
  const index = (rows) => new Map(rows.map((r) => [String(r.document._id), r]));
  const identity = (p, row) => {
    if (!row) fail("Missing target " + p.id);
    const d = row.document;
    if (d.path !== p.path || typeof d.name !== "string" || !d.name.trim()) fail("Project identity/path mismatch: " + p.id);
    if (d.reconciliation && Object.prototype.hasOwnProperty.call(d.reconciliation, "retiredAt")) fail("Retired Project: " + p.id);
    if (d.storage != null && (typeof d.storage !== "object" || Array.isArray(d.storage))) fail("Malformed storage: " + p.id);
    const state = d.storage?.state ?? "hpc";
    if (!["hpc", "aws_pending_hpc_deletion"].includes(state) || d.storage?.hpcVerifiedAbsentAt != null) {
      fail("Unexpected storage/absence state: " + p.id);
    }
  };
  const exact = (p, row) => {
    const d = row.document, t = row.types, h = d.hpcPreservationHistory;
    const last = Array.isArray(h) ? h[h.length - 1] : null;
    return t.preserveOnHpcUntil === "date" && same(d.preserveOnHpcUntil, new Date(p.until))
      && t.hpcPreservationRequestedBy === "string" && d.hpcPreservationRequestedBy === p.requestedBy
      && t.hpcPreservationReason === "string" && d.hpcPreservationReason === p.reason
      && last && last.at instanceof Date && Number.isFinite(+last.at)
      && typeof last.by === "string" && !!last.by.trim()
      && same(last.until, new Date(p.until)) && last.requestedBy === p.requestedBy && last.reason === p.reason;
  };
  const rows = await read(), before = index(rows);
  for (const id of protectedIds) if (!before.has(id)) fail("Missing protected Gulnara Project: " + id);
  const pending = [];
  for (const p of plan) {
    const row = before.get(p.id);
    identity(p, row);
    if (!Number.isFinite(+new Date(p.until)) || new Date(p.until).toISOString() !== p.until
        || !p.until.endsWith("T23:59:59.999Z") || (mode === "apply" && +new Date(p.until) <= Date.now())) fail("Invalid/expired planned date: " + p.id);
    if (exact(p, row)) continue;
    if (mode === "verify") continue;
    const t = row.types;
    if (!["missing", "null"].includes(t.preserveOnHpcUntil)
        || !["missing", "null"].includes(t.hpcPreservationRequestedBy)
        || !["missing", "null"].includes(t.hpcPreservationReason)
        || !["missing", "array"].includes(t.hpcPreservationHistory)) {
      fail("Existing or malformed retention values need review; no preflight writes: " + p.id);
    }
    pending.push(p);
  }
  const summary = (current) => plan.map((p) => {
    const row = current.get(p.id);
    if (!row) return { id: p.id, ok: false, error: "missing" };
    const d = row.document;
    return { id: p.id, name: d.name, path: d.path,
      expectedDate: p.until, actualDate: d.preserveOnHpcUntil ?? null,
      requestedBy: d.hpcPreservationRequestedBy ?? null, reason: d.hpcPreservationReason ?? null,
      bsonType: row.types.preserveOnHpcUntil, historyEntries: d.hpcPreservationHistory?.length ?? 0,
      ok: !!exact(p, row), url: "https://sequences.tsl.ac.uk/project?id=" + p.id };
  });
  if (mode === "preview") {
    const result = { mode, database, actor, wouldChange: pending.length, alreadyExact: 12 - pending.length,
      unchangedGulnaraProjects: 5, plan, current: summary(before) };
    printjson(result);
    return result;
  }
  if (mode === "verify") {
    const projects = summary(before), ok = projects.every((p) => p.ok);
    printjson({ mode, ok, verified: projects.filter((p) => p.ok).length, expected: 12, projects,
      gulnara: protectedIds.map((id) => ({ id, name: before.get(id).document.name,
        preserveOnHpcUntil: before.get(id).document.preserveOnHpcUntil ?? null, writtenByThisCommand: false })) });
    if (!ok) fail("Retention verification did not pass for all 12 Projects.");
    return;
  }
  // All identities and previous values have passed before the first write.
  const evidenceDir = fs.mkdtempSync(path.join(os.homedir(), ".komondor-keep-20261126-"));
  fs.chmodSync(evidenceDir, 0o700);
  const save = (name, value) => fs.writeFileSync(path.join(evidenceDir, name), encode(value) + "\n", { flag: "wx", mode: 0o600 });
  save("before.ejson", { at: new Date(), database, host, actor, authorization: "George's 26 November 2026 retention decisions", plan, rows });
  const changed = [];
  try {
    for (const p of pending) {
      const old = before.get(p.id).document, at = new Date();
      const event = { at, by: actor, previousUntil: old.preserveOnHpcUntil ?? null,
        until: new Date(p.until), requestedBy: p.requestedBy, reason: p.reason };
      // Match the entire observed document, including raw BSON and history.
      // Each write is atomic. The 12-Project batch is deliberately NOT described as a transaction.
      const result = await db.projects.updateOne({ _id: old._id, $expr: { $eq: ["$$ROOT", { $literal: old }] } }, {
        $set: { preserveOnHpcUntil: new Date(p.until), hpcPreservationRequestedBy: p.requestedBy,
          hpcPreservationReason: p.reason, updatedAt: at },
        $push: { hpcPreservationHistory: event },
      }, { upsert: false, writeConcern: { w: "majority", j: true, wtimeout: 15000 } });
      if (result.matchedCount !== 1 || result.modifiedCount !== 1) fail("Concurrent change; stopped at " + p.id);
      changed.push(p.id);
      const actual = await db.projects.findOne({ _id: old._id });
      const expected = clone(old);
      Object.assign(expected, { preserveOnHpcUntil: new Date(p.until), hpcPreservationRequestedBy: p.requestedBy,
        hpcPreservationReason: p.reason, updatedAt: at });
      expected.hpcPreservationHistory = [...(expected.hpcPreservationHistory || []), event];
      // Compare each top-level field so BSON field order after $set is irrelevant.
      if (!actual || !same(Object.keys(expected).sort(), Object.keys(actual).sort())) fail("Post-update document fields changed: " + p.id);
      const keys = Object.keys(expected);
      if (keys.some((key) => !same(expected[key], actual[key]))) fail("Post-update document mismatch: " + p.id);
    }
    const afterRows = await read(), after = index(afterRows);
    for (const id of protectedIds) if (!after.has(id) || !same(before.get(id), after.get(id))) fail("Protected Gulnara Project changed: " + id);
    for (const p of plan) identity(p, after.get(p.id));
    const projects = summary(after), ok = projects.every((p) => p.ok);
    save("after.ejson", { at: new Date(), rows: afterRows });
    const receipt = { mode, ok, changed, alreadyExact: 12 - pending.length, verified: projects.filter((p) => p.ok).length,
      expected: 12, protectedGulnaraUnchanged: 5, evidenceDir, projects };
    save("receipt.ejson", receipt);
    printjson(receipt);
    if (!ok) fail("Final retention verification did not pass.");
  } catch (error) {
    save("stopped.ejson", { at: new Date(), changed, error: error.message,
      note: "Some updates may have succeeded, including an uncertain last write. Inspect verify output; never roll back blindly." });
    printjson({ ok: false, stopped: true, changed, evidenceDir, error: error.message });
    throw error;
  }
};
