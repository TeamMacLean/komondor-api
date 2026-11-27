# Project website visibility (`displayOnSite`)

`Project.displayOnSite` hides a Project, with its Samples, Runs and file
information, from the ordinary Sequence Store website. It is an administrative
switch. There is no web toggle and no API endpoint that sets it. An
administrator changes it with the reviewed `mongosh` commands below.

| Stored value     | Effect                                                        |
| ---------------- | ------------------------------------------------------------- |
| field missing    | Visible. Existing group permissions apply. (Every legacy Project.) |
| `true`           | Visible. Existing group permissions apply.                    |
| `false` (BSON boolean) | Hidden from the website for everyone, administrators included. |
| anything else    | Not supported. Never write it. The model refuses non-booleans. |

`true` never grants access. Group membership still decides who can see a
visible Project. No backfill is needed, and none should be run.

## What hiding does

The API treats a hidden Project as if it did not exist for website requests:

- **Lists, search and autocomplete.** It disappears from `GET /projects`,
  `/samples`, `/runs`, `/search`, `/search/{project,sample,run}`,
  `GET /user?username=…`, and `GET /news`, along with its Samples, Runs and their
  news items. The web's counts come from these lists, so the counts drop too.
- **Direct requests.** `GET /project`, `/sample`, `/run`, `/runs/{id}/status`,
  `/samples/names/{projectId}` and `/runs/names/{sampleId}` return the same
  not-found response as a missing record. That response carries no file locations.
  `POST /runs/batch-status` lists hidden runs under `missing`.
- **Writes.** New Samples (`POST /samples/new`), new Runs (`POST /runs/new`),
  reingest, `PUT /project/toggle-nudgeable` and `POST /accessions/new` are
  refused with the existing not-found answer. Nothing is written.
- **ENA export.** `GET /accessions/csv` leaves out its Runs.
- **Names.** `GET /projects/names` leaves out hidden names, but uniqueness still
  covers every Project. `POST /projects/new` with a taken name, hidden or
  visible, gets one generic `409` with code `PROJECT_NAME_UNAVAILABLE`. The
  response gives no details about the Project that already has the name. Sample
  and Run names are unique only within their parent, so nothing more is needed.

Hiding changes only this one field. It leaves `isPublic`,
`reconciliation.retiredAt`, `storage.*`, `archiveMigration.*`, HPC preservation
dates and archive eligibility, paths, ownership, associations, archive
evidence, and the files on HPC and S3 exactly as they were. It deletes nothing,
and you can undo it.

### What still sees hidden Projects

The filter is applied where website requests run their queries, in
`lib/site-visibility.js` and the models' `iCanSee`. It is not a global query
hook, so these still see hidden Projects:

- Archive commands, reconciliation and registration tools, the HPC
  deletion-due report, retention calculations, the ingest and MD5 workers, and
  any other code that queries the models directly.
- The admin-only audit endpoints `GET /project/reconciliation-history` and
  `GET /admin/reconciliation-record`. `PUT /project/hpc-preservation` (admin
  retention metadata) also still works on a hidden Project.
- komondor-nudge, which reads MongoDB directly. **Nudge behaviour is
  unchanged.** A hidden but `nudgeable` Project can still be nudged. If that is
  not wanted, it is a separate follow-up (see below).
- `POST /internal/power/run-status`, the token-authenticated server-to-server
  monitor for komondor-power. It is not part of the website.

## Manual operation in `mongosh`

These snippets assume a `mongosh` session that is **already connected to the
right database**. They touch one Project, chosen by its exact `_id`, and every
write also checks the expected name, path and current value.

Rules:

- Choose the Project by ID from a reviewed request. **Never choose Projects
  for this because their names contain "test"** or match any other pattern.
- Run step 1 first and copy its output into the audit record before you write anything.
- Stop if any check prints `STOP`, or if a count is not exactly 1.
- These are plain collection updates. They do not change `updatedAt`, so after
  a restore the document is byte-for-byte what it was before.

### 1. Preview the Project's identity and current flag

```js
// Fill in from the reviewed request. All three must match exactly.
const projectId = ObjectId("REPLACE_WITH_24_HEX_ID");
const expectedName = "REPLACE_WITH_EXACT_NAME";
const expectedPath = "REPLACE_WITH_EXACT_PATH";

const beforeDoc = db.projects.findOne({ _id: projectId });
const [preview] = db.projects.aggregate([
  { $match: { _id: projectId } },
  { $project: {
      name: 1, path: 1, owner: 1, group: 1, isPublic: 1, storage: 1,
      displayOnSite: 1, displayOnSiteType: { $type: "$displayOnSite" },
      retiredAt: "$reconciliation.retiredAt",
  } },
]).toArray();
const sampleIds = db.samples.distinct("_id", { project: projectId });
printjson({
  checkedAt: new Date(),
  preview,
  samples: sampleIds.length,
  runs: db.runs.countDocuments({ sample: { $in: sampleIds } }),
});

if (!beforeDoc || beforeDoc.name !== expectedName || beforeDoc.path !== expectedPath) {
  print("STOP: no Project with exactly this id, name and path");
} else if (!["missing", "bool"].includes(preview.displayOnSiteType)) {
  print(`STOP: displayOnSite is stored as ${preview.displayOnSiteType}; repair needs a separate review`);
} else {
  // Keep this value in the audit record; step 4 needs it.
  const restoreTo = preview.displayOnSiteType === "missing" ? "missing" : beforeDoc.displayOnSite;
  print(`OK: current value = ${restoreTo}`);
  print("Audit before-image follows:");
  print(EJSON.stringify(beforeDoc, { relaxed: false }));
}
```

If the current value is already `false`, the Project is already hidden. Do not
write anything.

### 2. Hide it

Run this in the same session as step 1. The filter repeats the identity check
and the current value, so a stale preview cannot overwrite a different state.

```js
const hideFilter = { _id: projectId, name: expectedName, path: expectedPath };
if (preview.displayOnSiteType === "missing") {
  hideFilter.displayOnSite = { $exists: false };
} else if (preview.displayOnSiteType === "bool" && beforeDoc.displayOnSite === true) {
  hideFilter.displayOnSite = true;
} else {
  throw new Error("STOP: unexpected current value; rerun step 1");
}

const hideResult = db.projects.updateOne(hideFilter, { $set: { displayOnSite: false } });
printjson(hideResult); // expect matchedCount: 1, modifiedCount: 1
```

### 3. Verify the change

```js
const afterDoc = db.projects.findOne({ _id: projectId });
const withoutFlag = (doc) => {
  const copy = Object.assign({}, doc);
  delete copy.displayOnSite;
  return EJSON.stringify(copy, { relaxed: false });
};

printjson({
  checkedAt: new Date(),
  matchedCount: hideResult.matchedCount,
  modifiedCount: hideResult.modifiedCount,
  before: preview.displayOnSiteType === "missing" ? "missing" : beforeDoc.displayOnSite,
  after: afterDoc.displayOnSite,
});
print(
  hideResult.matchedCount === 1 && hideResult.modifiedCount === 1 &&
  afterDoc.displayOnSite === false && withoutFlag(beforeDoc) === withoutFlag(afterDoc)
    ? "OK: only displayOnSite changed"
    : "STOP: unexpected result; restore with step 4 and review",
);
```

Record both outputs. Once the API with this feature is deployed, the Project
disappears from the website on the next request. There is no cache.

### 4. Restore the original value

Use the value recorded in step 1. Fill in all four values from the audit record,
because this may run in a later session. The names differ from steps 1–3, so
the snippet also works in the same session.

```js
const restoreId = ObjectId("REPLACE_WITH_24_HEX_ID");
const restoreName = "REPLACE_WITH_EXACT_NAME";
const restorePath = "REPLACE_WITH_EXACT_PATH";
const restoreTo = "missing"; // or: true, exactly as recorded in step 1

const restoreFilter = { _id: restoreId, name: restoreName, path: restorePath, displayOnSite: false };
const restoreUpdate = restoreTo === "missing"
  ? { $unset: { displayOnSite: "" } } // brings back a missing field
  : restoreTo === true
    ? { $set: { displayOnSite: true } }
    : null;
if (!restoreUpdate) throw new Error("STOP: restoreTo must be \"missing\" or true");

const beforeRestore = db.projects.findOne({ _id: restoreId });
const restoreResult = db.projects.updateOne(restoreFilter, restoreUpdate);
const restoredDoc = db.projects.findOne({ _id: restoreId });
printjson({
  checkedAt: new Date(),
  restoreResult, // expect matchedCount: 1, modifiedCount: 1
  restoredTo: Object.prototype.hasOwnProperty.call(restoredDoc, "displayOnSite")
    ? restoredDoc.displayOnSite
    : "missing",
});
print("Audit before-image follows:");
print(EJSON.stringify(beforeRestore, { relaxed: false }));
```

If step 1's before-image is still in the session, check the restore is exact:
`EJSON.stringify(beforeDoc, { relaxed: false }) === EJSON.stringify(restoredDoc, { relaxed: false })`
should print `true`.

## Candidate for a later production test

This is a historical note, not an instruction. Recheck everything with step 1
before doing anything.

- ID `693dc150aeb7e7fd45212caf`, name `Test Project 1765654863243`, path
  `/bioinformatics/test_project_1765654863243`.
- As of 27 November 2026 it had one Sample, no Runs or Reads, no recorded AWS
  archive and one zero-byte physical file.

It was not changed during implementation.

## Tests

- `__tests__/integration/project-site-visibility.test.js` runs against a real
  MongoDB. It covers lists, search, news, profiles, direct requests, writes,
  ENA export, name uniqueness, request bodies that try to set the flag,
  admin-only audit endpoints, archive and report tooling, and an exact restore.
  Run it with
  `MONGODB_URI=mongodb://127.0.0.1:27017/komondor-integration-test yarn test:integration`.
- `__tests__/lib/site-visibility.test.js` and `__tests__/models/visibility.test.js`
  cover the helpers and the `iCanSee` filters.

## Possible follow-ups (not done here)

- **komondor-nudge.** Decide whether hidden Projects should stop being nudged.
  Nudge reads MongoDB directly, so that change belongs in Nudge (or uses
  `nudgeable`). It does not belong here.
- **komondor-power run-status monitor.** It still reports hidden Runs to Power.
  Decide whether that is wanted.
- **HPC transfer-directory endpoints** (`/directory-files`, `/read-file`) list
  inbound staging folders, not Project records, so the flag does not apply to
  them.
- **Index.** `displayOnSite` is not indexed, because the projects collection is
  small. Add an index only if profiling shows the hidden-id lookup matters.
