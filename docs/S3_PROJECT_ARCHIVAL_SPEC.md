# S3 project archival specification

Status: **proposed, implementation-ready**. Version 1 of the manually supervised
workflow that archives one Komondor project from the HPC datastore to Amazon S3.

Every code citation below was verified against the working trees of
`komondor-api`, `komondor-web`, `komondor-power` and `komondor-nudge` on
2026-09-07. Line numbers are current as of that date; when they move, the
file and symbol are the anchor.

---

## 1. Executive summary

Komondor's canonical sequence data lives under `DATASTORE_ROOT` on the HPC
filesystem as `group/project/sample/run/{raw,additional}`. After some years a
project is no longer being written to and needs to move to cheap archival
storage. This document specifies a lean, deliberately manual v1 that:

- adds a **Project-owned storage lifecycle** (`hpc → migrating →
aws_pending_hpc_deletion → aws`) as the single source of storage truth;
- makes every **storage-bearing write** (sample/run creation, reingest,
  additional-file attachment, ingest worker moves, MD5 verification, live
  filesystem reconciliation) refuse or become not-applicable for any project
  that has left `hpc`, while ordinary metadata edits stay available;
- ships a **Node CLI in `komondor-api/scripts/`** that locks the project,
  inventories the exact project tree on disk, copies every regular file to a
  mirrored S3 prefix with full-object CRC-64/NVME verification, seals immutable
  source and verification manifests in an S3 control prefix, and only then
  transitions the project;
- keeps **HPC deletion manual**: the CLI prints one exact `rm` command for a
  human, and a separate command confirms the project root is `ENOENT` before
  the final `aws` state is recorded;
- gives **komondor-web** a shared badge, API-provided file locations, read-only
  UX and archived-file rendering; gives **komondor-power** early validation and
  terminal error handling; gives **komondor-nudge** an explicit read-only
  schema declaration and regression tests.

Retrieval from S3, automated deletion, sub-project moves, and any web control
that changes storage state are explicitly out of scope.

---

## 2. Problem statement and current behavior (verified)

### 2.1 Where data lives and how paths are formed

- `Project.path` is computed in `pre("validate")`
  ([`models/Project.js:47`](../models/Project.js#L47)) as
  `join("/", group.safeName, project.safeName)` (line 73), so it carries a
  **leading slash**, e.g. `/tsl/wheat_blast`. `Sample.path` and `Run.path`
  extend it (`models/Sample.js:144`, `models/Run.js:123`).
- Directories are created in **`post("save")`**, not `pre("validate")`:
  `models/Project.js:85` → `fs.promises.mkdir` at line 122;
  `models/Sample.js:167` → mkdir at line 192; `models/Run.js:137` → mkdir at
  line 163. Query-level updates (`findByIdAndUpdate`, `updateOne`) bypass these
  document hooks entirely; the only query hook is a no-op
  (`models/Project.js:135`).
- `getRelativePath()` (`models/Run.js:185`, `Sample.js:216`,
  `Project.js:153`) returns the same hierarchy **without** the leading slash.
- `File.path` is written verbatim by `moveToFolderAndSave`
  ([`models/File.js:588`](../models/File.js#L588)). Reads get a slashless
  datastore-relative path (`lib/file-utils.js:628-629`, from
  `run.getRelativePath()` at line 712); AdditionalFiles get a leading-slash
  path built from the parent's `.path` (`lib/file-utils.js:565-569`). The two
  shapes coexist in the database.

### 2.2 File movement is not only the Read post-save hook

- `models/Read.js:51` `post("save")` moves the file unless `skipPostSave`
  (line 52). `models/AdditionalFile.js:44` and `:50` guard on `skipPostSave`
  and `wasNew`, and **swallow** move errors (lines 78-81).
- The ingest worker moves first and saves second with `skipPostSave: true`:
  `lib/file-utils.js:626-652` (reads) and `:563-583` (additional files),
  driven from `lib/ingest-queue.js:873-897`.
- `File.moveToFolderAndSave` writes a partial file `<dest>.part-<FileId>`
  (`models/File.js:151`, opened `wx` at line 224) and promotes it; interrupted
  copies leave `.part-` files that nothing sweeps (`server.js:242`). The
  listing helper hides them (`routes/_utils.js:71`).
- Route entry points that reach the datastore: `POST /projects/new`
  (`routes/projects.js:239`, save at 306, `sortAdditionalFiles` at 309),
  `POST /samples/new` (`routes/samples.js:236`, save at 389/407,
  `sortAdditionalFiles` at 410 in the non-TPlex branch only), `POST /runs/new`
  (`routes/runs.js:375`, save at 560, `enqueueRunIngest` at 582 and 511),
  `POST /runs/:id/reingest` (`routes/runs.js:898`, `requeueFailedIngest` at
  1136). **There is no standalone attach-additional-file route**;
  `sortAdditionalFiles` is imported only by `routes/projects.js:13` and
  `routes/samples.js:10` and reachable only from the create handlers.

### 2.3 Ingest jobs and MD5 verification

- `models/IngestJob.js` references **only the Run** (`runId`, line 17); status
  enum `pending | claimed | done | failed` (line 10); lease at line 44. The
  worker claims atomically (`lib/ingest-queue.js:225`), loads only the Run
  (line 814), and calls `verifyRunMd5` once (line 928). Sample and Project are
  reached indirectly through `run.getRelativePath()`.
- `findRunsNeedingVerification` (`lib/md5-verification.js:283`) selects
  `md5VerificationStatus: "pending"`, `status: "complete"`, attempts < 3, every
  five minutes (`lib/background-jobs.js:210`). `verifyRunMd5` resolves
  `DATASTORE_ROOT/<run relative path>/raw/<basename>` via `resolveWithinReal`
  (line 219) and writes `destinationMd5`, `md5Mismatch`, `MD5LastChecked`
  (line 246). The claim in its header comment that the run-creation route also
  calls it is stale; the only callers are the worker and the cron job.
- Daily jobs: `cleanupStalePendingRuns` at 02:00 (`background-jobs.js:217`) is
  DB-only and matches `status: "processing"` (`md5-verification.js:365`); the
  03:00 upload sweep (`background-jobs.js:226`) touches only tus staging.

### 2.4 Detail reads reconcile against the live filesystem

- `GET /project` (`routes/projects.js:139-149`) reads
  `DATASTORE_ROOT/<project.path>/additional` and returns
  `{ project, actualAdditionalFiles, additionalFilesStatus }`.
- `GET /sample` (`routes/samples.js:214-224`) does the same for the sample.
- `GET /run` (`routes/runs.js:281-301`) reads `raw` and `additional` via
  `compareFilesToDirectory` (`routes/_utils.js:197`) and returns
  `{ run, actualReads, actualAdditionalFiles, additionalFilesStatus,
rawFilesStatus }`.
- `getActualFiles` (`routes/_utils.js:62`) returns `[]` on `ENOENT`, and the
  comparator marks DB records with no file as `MISMATCH`
  (`routes/_utils.js:181`). **A deleted HPC tree therefore reads as a
  mismatch today**, and the web's additional-file lists are built by diffing
  `actualAdditionalFiles` against DB records (`pages/project.vue:165`,
  `pages/sample.vue:193`, `pages/run.vue:187`).
- `GET /runs/:id/status` (`routes/runs.js:635`, response at 699) and
  `POST /runs/batch-status` (`routes/runs.js:1218`, response at 1309) are
  hand-built and touch no filesystem.

### 2.5 Response shaping

- Every entity route sends the Mongoose document directly with
  `toJSON: { virtuals: true }` (`models/Project.js:44`, `Sample.js:34`,
  `Run.js:70`). There is **no sanitising serializer**; the only `toObject()`
  is `routes/users.js:60`. `.lean()` appears nowhere.
- `GET /sample` populates `project` as an object (`routes/samples.js:194`);
  `GET /run` populates `sample` (`routes/runs.js:256`) but not
  `sample.project`. `GET /samples` (`routes/samples.js:108`), `GET /runs`
  (`routes/runs.js:181`) and `/search` (`routes/search.js:58`, `:83`) populate
  only `group`; `sample.project` and `run.sample` are bare ObjectId strings.
- `handleError` (`routes/_utils.js:20`) emits `{ error, detail, requestId }`
  (lines 48-52). There is **no `code` field** and no request-id middleware in
  `app.js`; ids are generated per handler.

### 2.6 Accessions CSV

`GET /accessions/csv` (`routes/accessions.js:302`, guarded by
`hasFullRecordsAccess` at 304) emits `HEADINGS` (line 282) and builds
`list_of_read_files` as `_path.join(READS_ROOT_PATH || "/tsl/data/reads",
read.file.path)` joined by `;` (lines 218-222). Because `File.path` already
contains `group/project/...`, appending it to a project-level S3 URI would
duplicate segments.

### 2.7 Environment, shutdown, scripts

- `validateEnv` (`lib/utils/validateEnv.js:215`) checks `DATASTORE_ROOT`
  writable and `HPC_TRANSFER_DIRECTORY` read-only via `checkMount`
  (lines 261-276) and returns `{ ok, errors, warnings }` (line 334);
  `server.js:330` exits on failure. `/ready` re-derives its checks from
  `REQUIRED_MOUNTS` (`app.js:130`) and `registerReadinessCheck`
  (`app.js:155`), answering 503 when any fails (`app.js:253`).
- The active-transfer register is in-memory and per-process
  (`lib/active-transfers.js:24`); `server.js:211-234` refuses a clean shutdown
  while transfers are in flight. `ecosystem.config.js:38` pins
  `instances: 1`.
- `scripts/inspect-ingest-backlog.js` is the script pattern: `dotenv`,
  `resolveMongoUri` (line 45), `mongoose.connect` with a 10 s selection timeout
  (line 144), exit codes 0/1/2, `require.main === module` guard (line 276),
  and no `process.argv` parsing.

### 2.8 komondor-web

- Detail pages hardcode `/tsl/data/reads{{ x.path }}` (`pages/project.vue:126`,
  `pages/sample.vue:156`, `pages/run.vue:129`) while the copy helpers build
  from `process.env.HPC_DATASTORE_ROOT` (`components/ReadList.vue:213`,
  `:353`; `components/AdditionalFileList.vue:119`). The displayed and copied
  roots can disagree.
- `pages/run.vue` renders one `b-tag` from `md5Status` (line 255) and polls
  the **whole run** from `GET /run` every 5 s (`startPolling` at 316,
  `setInterval` at 318) while `status === "pending"` or MD5 is
  pending/in-progress (line 299), stopping at line 359.
- Cards render no badges (`components/{projects,samples,runs}/*Card.vue`).
  New buttons: `ProjectList.vue:34` (static link), `SampleList.vue:34`
  (`v-if="project && showNewButton"`), `RunList.vue:34`
  (`v-if="sample && showNewButton"`). Clone: `pages/sample.vue:302`,
  `pages/run.vue:307`. Forms take the parent from the query string
  (`pages/samples/new.vue:174`, `pages/runs/new.vue:309`) inside `asyncData`.
- `AdditionalFileList.vue` shows "No additional files detected in HPC" (line 4)
  when the disk listing is empty. `ReadList.vue` `md5Status(read)` (line 285)
  labels reads `Verified/Checking/Awaiting/Mismatch/No MD5/N/A`.
- `plugins/error-handler.js` handles only 401 and network failures; every
  other status is left to the caller (line 105). `utils/apiError.js` reads
  `error`, `message`, `requestId` only (`readErrorBody` line 40,
  `getApiErrorMessage` line 74).
- The only route middleware is `middleware/admin.js`; `auth` comes from
  `@nuxtjs/auth`.

### 2.9 komondor-power

- `isRetryableError` (`server/utils/komondorApiClient.ts:188-209`) retries
  network/timeout messages and statuses `408, 502, 503, 504` (line 205). **409
  is already terminal.** There is no test for this.
- Response interfaces carry index signatures (`Project` at lines 31-37, key
  `[key: string]: unknown` at 36); responses are cast, not parsed
  (line 255). Additive fields are inert.
- `validatePreExistingEntities.ts` fetches `GET /project?id=` (line 196) and
  `GET /sample?id=` (line 244), checks group membership (lines 207, 256) and
  caches per request.
- `insertMetadata.ts` tracks `CreatedEntities` (line 20) and, on failure,
  logs "You can safely resubmit the same CSV..." (line 95). That advice is
  contradicted by `checkUniqueProjectNames.ts:39-43`, which rejects duplicate
  project names, and by `docs/CSV_UPLOAD_WORKFLOW.md:203-214`.
- `extractErrorMessage` (`komondorApiErrorMessage.ts:41-52`) reads `detail`,
  then `message`, then `error`, then status text. `pollRunsUntilComplete`
  (`insertMetadata.ts:364`) polls `POST /runs/batch-status` until every run is
  terminal.

### 2.10 komondor-nudge

- `models.js:9-18` declares a read-only Project schema with
  `nudgeable: { type: Boolean, default: true }` (line 15); the default is
  applied only when a document is constructed and saved, which only
  `__tests__/models.test.js` does.
- `checkNudgeUpdates.js:205` loads projects with `Project.aggregate`, which
  bypasses the schema, so every stored field reaches `classify()`. The sole
  write is `Project.updateOne(..., { $push: { nudges: ... } })` at line 317.
  `nudgeable === false` short-circuits at line 51. `sendToEna` is declared but
  never read.
- `audit-nudges.js:215` uses `findById(...).lean()`. In Mongoose 5 a lean
  query returns the raw driver document, so undeclared fields such as
  `storage` already reach it; declaring them documents the shape rather than
  changing runtime behaviour. Fixtures insert with the raw driver
  (`__tests__/helpers/world.js:105`). The shared-field contract is
  `README.md:99-107`.

---

## 3. Goals, non-goals, assumptions, terminology

### Goals

1. One project at a time can be archived to S3 with cryptographic evidence
   that every regular file under its exact project root arrived intact.
2. Once locked, no code path in any of the four repositories can write into
   that project's HPC tree.
3. The website shows the project's storage state and S3 location and stops
   claiming that archived files are missing.
4. HPC deletion is a separate, human-executed, human-verified step.

### Non-goals (v1)

Moving a sample, run or file independently; automated HPC deletion; retrieval,
restore, browsing, downloads or presigned URLs; any web/admin control that
changes storage state; inspecting `HPC_TRANSFER_DIRECTORY` or tus staging;
fixing historical DB/filesystem discrepancies fleet-wide; rewriting legacy
checksums or `File.path`; denormalising Project state onto child documents;
per-file S3 bookkeeping on Read/File; a daemon or queue; mid-file multipart
resume; application-owned storage-class transitions; treating archival as ENA
release.

### Assumptions

- Production runs a single API instance (`ecosystem.config.js:38`) on one host
  that mounts `DATASTORE_ROOT`. The CLI runs on that host.
- AWS CLI v2 with full-object checksum support is installed on that host. The
  development machine has `aws-cli/2.34.1`, which exposes
  `--checksum-algorithm` on `aws s3 cp` and `--checksum-mode` on
  `aws s3api head-object`; the production version is a deployment input
  (§21) and is verified by the smoke test (§16.4).
- Node ≥ 24 per `package.json` `engines`.

### Terminology

| Term                      | Meaning                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **project root**          | `path.resolve(DATASTORE_ROOT, stripLeadingSlash(project.path))`, snapshotted at lock time as `archiveMigration.sourceRoot`.                |
| **relative project root** | `project.path` without its leading slash, e.g. `tsl/wheat_blast`. Snapshotted as `archiveMigration.sourceRelativeRoot`.                    |
| **archive root**          | `AWS_ARCHIVE_S3_ROOT`, `s3://bucket[/base]`.                                                                                               |
| **data prefix**           | `<archive root>/data/<relative project root>`; stored immutably as `storage.s3Uri`.                                                        |
| **control prefix**        | `<archive root>/control/projects/<projectId>/<migrationId>/`.                                                                              |
| **storage-bearing write** | Any operation that creates directories, moves, copies, hashes-and-records, or lists files under the project root with intent to reconcile. |
| **manifest**              | The versioned JSON inventory of the project tree (§9).                                                                                     |

---

## 4. User and operator stories

- As a **bioinformatician viewing an old project**, I see "Archived in AWS"
  on the project, its samples and runs, can copy the `s3://` location, and
  the file lists still show what was archived rather than "missing".
- As a **user trying to add a run to an archived project**, the New Run
  button is gone with a one-line explanation, and if I somehow submit, the
  API answers 409 with a stable code.
- As the **operator**, I run `plan` to see exactly what is on disk and how it
  differs from the database, take the lock in a short maintenance window, run
  `copy` while the site stays up, review the verification report, run the
  printed delete command myself, and run `confirm-absent`.
- As the **operator recovering from a failed copy**, `status` tells me the
  phase, the last error, and every migration-owned object and incomplete
  multipart upload; `resume` continues from the sealed manifest; nothing asks
  me to edit MongoDB by hand.
- As **komondor-power**, a CSV that references an archived project fails
  validation before any create, and a race-time 409 is reported as terminal
  with the IDs already created.
- As **komondor-nudge**, I keep nudging archived projects by the same rules
  as before.

---

## 5. Decision log and invariants

### 5.1 Decisions (settled)

| #   | Decision                                                                                                                                                                                        | Rationale                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Project-only granularity; Sample/Run carry no stored storage state.                                                                                                                             | Fixed by product. Children derive `projectStorage` at response time.                                                             |
| D2  | Storage state is a **stored enum without a Mongoose default**; absent means `hpc` in both serialization and query predicates.                                                                   | A default hides absence from exact queries. Predicates use `$or: [{exists:false},{eq:"hpc"}]`.                                   |
| D3  | The mover never calls `project.save()`; every transition is a fenced `findOneAndUpdate`.                                                                                                        | `save()` would run the mkdir `post("save")` hook (§2.1).                                                                         |
| D4  | Lock transition requires the API and workers to be **stopped** (quiescence window). Copy runs with the guarded API live.                                                                        | "Check then later save" in the create routes is not atomic; a lease system is future work.                                       |
| D5  | Lock is a separate CLI command from copy.                                                                                                                                                       | Keeps the maintenance window to minutes; copy can take hours. (Deviation, §22.)                                                  |
| D6  | S3 layout is `<root>/data/<relative to DATASTORE_ROOT>` for bytes and `<root>/control/projects/<projectId>/<migrationId>/` for manifests.                                                       | Lifecycle rules filter by prefix; `data/` can go cold, `control/` stays readable. (Deviation, §22.)                              |
| D7  | Full-object **CRC-64/NVME** is the upload-verification checksum; **SHA-256** is the manifest's cryptographic identity.                                                                          | CRC64NVME is the only algorithm S3 stores as `FULL_OBJECT` for every multipart upload; SHA-256 multipart is composite.           |
| D8  | CRC-64/NVME is computed by a pure-JS table implementation in `lib/utils/crc64nvme.js`, verified by known vector and by the real-S3 smoke test. No new dependency.                               | `@aws-sdk/crc64-nvme-crt` pulls the AWS CRT; not worth it for one 40-line routine.                                               |
| D9  | Uploads stream from a pinned descriptor into `aws s3 cp - <key>`. The CLI never receives a pathname.                                                                                            | Defeats path-swap races; matches `lib/utils/md5.js` `O_NOFOLLOW` practice.                                                       |
| D10 | No API route or web control mutates storage state.                                                                                                                                              | Fixed by product.                                                                                                                |
| D11 | One machine code `PROJECT_STORAGE_READ_ONLY` for every storage refusal, including an invalid stored state; envelope `{ error, detail, requestId, code, projectId, storageState }`.              | One thing for clients to key off. Invalid state is distinguishable by `storageState: "invalid"` and a server-side integrity log. |
| D12 | Public storage summary is produced by a `toJSON` transform on the Project schema plus `select: false` on `archiveMigration`; children get `projectStorage` via one batched lookup per response. | Routes serialize documents directly (§2.5); a schema transform covers every path including populated `sample.project`.           |
| D13 | Detail routes return `status: "NOT_APPLICABLE"` reconciliation objects and `null` disk listings for every non-`hpc` state, and always return DB-backed Reads/AdditionalFiles.                   | Reads must not report archived files as missing.                                                                                 |
| D14 | Accessions CSV keeps its columns and emits the effective authoritative URI in `list_of_read_files`: HPC path for `hpc`/`migrating`, `s3://` for `aws_pending_hpc_deletion`/`aws`.               | **Needs product sign-off** (§21). No in-repo consumer requires POSIX paths; ENA tooling outside the repo may.                    |
| D15 | The API provides ready-made display locations (`location` objects) for all states; the web appends only a filename.                                                                             | Removes the `/tsl/data/reads` literal and the `HPC_DATASTORE_ROOT` disagreement from Vue.                                        |
| D16 | Symlinks are recorded and skipped, never followed. Hard links are uploaded under each key. Special files are recorded and skipped.                                                              | Fixed by product; `aws s3 cp` defaults to following symlinks, which is why the CLI never sees a path.                            |
| D17 | Unreadable or unverifiable regular files block unless a per-entry operator exclusion with reason is sealed into the manifest. `--acknowledge-known-anomalies` covers only metadata anomalies.   | Bytes must never be silently omitted.                                                                                            |
| D18 | Failed multipart uploads restart the file from byte zero. Resume is file-granular.                                                                                                              | Lean v1.                                                                                                                         |
| D19 | The mover role has **no `s3:DeleteObject`**. Cleanup of a failed attempt is a separately reviewed manual action; `status` prints the exact inventory.                                           | Fixed by product.                                                                                                                |
| D20 | Nudge keeps its existing eligibility rules; storage is declared read-only with no default and shown in the audit output.                                                                        | Archival ≠ ENA release.                                                                                                          |

### 5.2 Invariants

- **I1** A project in any state other than `hpc` accepts no storage-bearing
  write from any repository.
- **I2** `storage.s3Uri` and `archiveMigration.sourceRoot` are written once,
  at lock, and never rewritten.
- **I3** `aws_pending_hpc_deletion` is reachable only by a fenced update that
  requires a sealed verification report whose digest is stored on the
  Project.
- **I4** `aws` is reachable only after `lstat(sourceRoot)` returns `ENOENT`.
- **I5** No command in the mover deletes an S3 object or an HPC file.
- **I6** Legacy documents with no `storage` field behave exactly as `hpc`;
  any other unexpected value fails closed for writes and is logged as an
  integrity error.
- **I7** The deletion command is printed only after a fresh S3 re-verification
  and a fresh local tree comparison both pass.
- **I8** A resumed migration always verifies against the originally sealed
  source manifest digest; it never adopts a new baseline.

---

## 6. Project data model and state transitions

### 6.1 Schema additions (`models/Project.js`)

```js
const STORAGE_STATES = ["hpc", "migrating", "aws_pending_hpc_deletion", "aws"];
const MIGRATION_PHASES = [
  "locked", "inventoried", "source_sealed", "copying", "copied",
  "verified", "completed",
];

storage: {
  // No default on purpose (D2). Absent === "hpc".
  state: { type: String, enum: STORAGE_STATES },
  s3Uri: { type: String },              // immutable data prefix, set at lock
  s3VerifiedAt: { type: Date },         // set at verified
  hpcVerifiedAbsentAt: { type: Date },  // set by confirm-absent
  archivedAt: { type: Date },           // set by confirm-absent (== final state time)
},

archiveMigration: {
  type: new Schema({
    id: { type: String, required: true },          // 24-hex, generated by the CLI
    phase: { type: String, enum: MIGRATION_PHASES, required: true },
    movedBy: { type: String, required: true },     // audit identity (Komondor username)
    osUser: String,                                // effective OS user at lock
    awsIdentityArn: String,                        // sts get-caller-identity at lock
    awsAccountId: String,
    startedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    sourceRoot: { type: String, required: true },          // absolute, snapshot
    sourceRelativeRoot: { type: String, required: true },  // e.g. "tsl/wheat_blast"
    lastError: { at: Date, phase: String, message: String },
    failedAt: Date,
    resumeCount: { type: Number, default: 0 },
    lastResumedBy: String,
    lastResumedAt: Date,
    anomalyAcknowledgement: { by: String, at: Date, manifestSha256: String },
    manifests: {
      version: Number,                 // manifest format version, 1
      sourceS3Uri: String,
      sourceSha256: String,            // sha256 of the exact stored bytes
      sourceSealedAt: Date,
      verificationS3Uri: String,
      verificationSha256: String,
      verificationSealedAt: Date,
      fileCount: Number,               // regular files copied
      totalBytes: Number,
      skippedEntries: Number,          // symlinks + specials + excluded
    },
    confirmedAbsentBy: String,
    restartedFrom: [String],           // prior migration ids for this project
  }, { _id: false }),
  select: false,                        // never returned unless +archiveMigration
},
```

Indexes: `schema.index({ "storage.state": 1 })`.

`POST /projects/new` sets `storage: { state: "hpc" }` explicitly on new
documents. Existing documents are **not backfilled**; predicates and the
serializer treat absence as `hpc`. An optional idempotent backfill
(`updateMany({ storage: { $exists: false } }, { $set: { storage: { state: "hpc" } } })`)
may be run later but is not part of this rollout.

### 6.2 Normalisation and validity (`lib/storage-state.js`)

```js
resolveStorageState(projectLike) -> {
  state,               // "hpc" | "migrating" | "aws_pending_hpc_deletion" | "aws" | "invalid"
  acceptsHpcWrites,    // state === "hpc"
  authoritativeLocation, // "hpc" for hpc/migrating; "s3" for the two aws states; null for invalid
  integrityError,      // string | null
}
```

Rules:

| Stored                                                                                                                | Resolved                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `storage` absent, or `storage.state` absent **and** no other storage field set                                        | `hpc`                      |
| `state: "hpc"` and `s3Uri`/`s3VerifiedAt`/`hpcVerifiedAbsentAt`/`archivedAt` all absent                               | `hpc`                      |
| `state: "migrating"` with `s3Uri` set                                                                                 | `migrating`                |
| `state: "aws_pending_hpc_deletion"` with `s3Uri` and `s3VerifiedAt` set                                               | `aws_pending_hpc_deletion` |
| `state: "aws"` with `s3Uri`, `s3VerifiedAt`, `hpcVerifiedAbsentAt`, `archivedAt` set                                  | `aws`                      |
| anything else (unknown string, missing required evidence, `hpc` with S3 evidence, `state` absent but `s3Uri` present) | `invalid`                  |

`invalid` is a **derived public value**, never stored. When resolved, the API
logs `[storage-integrity] project <id> …` at error level once per request,
refuses storage writes with `PROJECT_STORAGE_READ_ONLY` and
`storageState: "invalid"`, and serves reads with `acceptsHpcWrites: false`
and `authoritativeLocation: null`. It is never normalised to `hpc`.

Predicates exported for reuse (API guards, MD5 selection, CLI):

```js
const HPC_WRITABLE_FILTER = {
  $or: [{ "storage.state": { $exists: false } }, { "storage.state": "hpc" }],
};
const NON_HPC_FILTER = { "storage.state": { $exists: true, $ne: "hpc" } };
```

### 6.3 State-transition table

| From                                                                | To                                                                                            | Command                       | Fence (all must hold in the same `findOneAndUpdate` filter)          | Precondition evidence                                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hpc` (or absent)                                                   | `migrating` / phase `locked`                                                                  | `lock --execute`              | `_id`, `HPC_WRITABLE_FILTER`                                         | API quiesced (§8.3), preflight clean, AWS identity matches, destination prefix clean                                                                                        |
| `migrating` / `locked`                                              | `migrating` / `inventoried`                                                                   | `copy` (phase 1)              | `_id`, state `migrating`, `archiveMigration.id`, phase `locked`      | Inventory sealed locally, stable across re-walk                                                                                                                             |
| `migrating` / `inventoried`                                         | `migrating` / `source_sealed`                                                                 | `copy` (phase 2)              | as above, phase `inventoried`                                        | Source manifest PUT to control prefix with `--if-none-match "*"`, digest recorded                                                                                           |
| `migrating` / `source_sealed`                                       | `migrating` / `copying`                                                                       | `copy` (phase 3)              | phase `source_sealed`                                                | first data upload about to start                                                                                                                                            |
| `migrating` / `copying`                                             | `migrating` / `copied`                                                                        | `copy` (phase 3 end)          | phase `copying`                                                      | every manifest entry uploaded or verified-existing                                                                                                                          |
| `migrating` / `copied`                                              | `aws_pending_hpc_deletion` / `verified`                                                       | `copy` (phase 4)              | phase `copied`                                                       | HEAD every key, key set equality, local re-walk equality, verification report sealed                                                                                        |
| `migrating` / `locked` or `inventoried`                             | `hpc` (storage reset to `{ state: "hpc" }`; `archiveMigration` retained with phase `aborted`) | `abort-before-copy --execute` | state `migrating`, id, phase ∈ {`locked`,`inventoried`}              | Fresh S3 checks: zero objects under data prefix, zero control objects for this migration, zero incomplete multipart uploads                                                 |
| `migrating` / any with `lastError`                                  | same phase, `lastError` cleared, `resumeCount+1`                                              | `resume --execute`            | state `migrating`, id, `manifests.sourceSha256`                      | Source manifest re-fetched and digest-verified                                                                                                                              |
| `migrating` / failed after `source_sealed` and judged irrecoverable | `migrating` / `locked` with a **new** migration id, old id appended to `restartedFrom`        | `restart --execute`           | state `migrating`, old id                                            | Old migration's data prefix has zero objects, zero multipart uploads; old control manifests moved by operator to `control/projects/<projectId>/abandoned/<oldId>/` (manual) |
| `aws_pending_hpc_deletion`                                          | `aws` / `completed`                                                                           | `confirm-absent --execute`    | state `aws_pending_hpc_deletion`, id, `manifests.verificationSha256` | `lstat(sourceRoot)` → `ENOENT`; verification report re-read and digest matches                                                                                              |

There is no transition out of `aws_pending_hpc_deletion` other than to `aws`,
and none out of `aws`. There is no generic "set state" command.

`migrationHealth` (public, only while `migrating`): `needs_attention` when
`lastError` is set, or when phase is `copying` and `updatedAt` is older than
24 hours; otherwise `active`.

---

## 7. Public API schema, behavior matrix, error contract

### 7.1 Public storage summary

Produced by `publicStorageSummary(project)` in `lib/storage-state.js` and
installed as the Project schema's `toJSON.transform` (which also deletes
`archiveMigration` if present):

```jsonc
"storage": {
  "state": "aws_pending_hpc_deletion",   // hpc | migrating | aws_pending_hpc_deletion | aws | invalid
  "acceptsHpcWrites": false,
  "authoritativeLocation": "s3",          // hpc | s3 | null
  "s3Uri": "s3://tsl-archive/komondor/data/tsl/wheat_blast",  // null while hpc
  "s3VerifiedAt": "2026-10-02T09:14:11.000Z",                  // null until verified
  "hpcVerifiedAbsentAt": null,
  "archivedAt": null,
  "migrationHealth": null                 // "active" | "needs_attention" only while migrating
}
```

`archiveMigration`, operator identities, control-manifest URIs and digests,
phase names and `lastError` never appear in any HTTP response.

Sample and Run documents receive an additive top-level `projectStorage` field
with exactly the same shape, attached by `attachProjectStorage(docs, { via })`:

- `via: "project"` (samples): one `Project.find({ _id: { $in: ids } }).select("storage")`.
- `via: "sample"` (runs): one `Sample.find(...).select("project")` then one
  `Project.find(...)`.

No per-row queries. Existing relationship fields are untouched: `sample.project`
and `run.sample` keep their current shape (object where populated today,
string elsewhere). Where `sample.project` is populated it will additionally
carry `storage` via the transform; clients must still read `projectStorage`.

Nested children inside `GET /project` (`project.samples`) and `GET /sample`
(`sample.runs`) do **not** receive `projectStorage`; the parent's `storage`
applies to them and the web passes it down.

### 7.2 Location objects (detail routes only)

Added to `GET /project`, `GET /sample`, `GET /run`:

```jsonc
"location": {
  "authoritative": "s3",                    // mirrors storage.authoritativeLocation
  "baseUri": "s3://tsl-archive/komondor/data/tsl/wheat_blast/isolate_a/run_1",
  "rawUri": ".../run_1/raw",                // run only
  "additionalUri": ".../run_1/additional",
  "plannedS3Uri": null                      // set only while migrating: the immutable data prefix + relative path
}
```

Derivation is centralised in `lib/storage-state.js#locationFor(project, relativePathFromProjectRoot)`:

- HPC form: `READS_ROOT_PATH || "/tsl/data/reads"` + `/` + relative-to-DATASTORE_ROOT path, joined with `path.posix.join`.
- S3 form: `storage.s3Uri` + `/` + path relative to the project root, joined
  with `/` string concatenation (never `path.join`). The relative path is
  computed by stripping `archiveMigration.sourceRelativeRoot` from the
  entity's slashless path. `sourceRelativeRoot` is read with
  `.select("+archiveMigration.sourceRelativeRoot")` inside the helper only.

The web appends **only a filename** to `rawUri`/`additionalUri`.

### 7.3 Endpoint and worker behavior matrix

| Surface                                                                                   | `hpc`                              | `migrating`                         | `aws_pending_hpc_deletion` | `aws`     | `invalid`                              |
| ----------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------- | -------------------------- | --------- | -------------------------------------- |
| `POST /projects/new`                                                                      | creates with `storage.state:"hpc"` | n/a                                 | n/a                        | n/a       | n/a                                    |
| `POST /samples/new`                                                                       | unchanged                          | **409**                             | **409**                    | **409**   | **409**                                |
| `POST /runs/new`                                                                          | unchanged                          | **409**                             | **409**                    | **409**   | **409**                                |
| `POST /runs/:id/reingest`                                                                 | unchanged                          | **409**                             | **409**                    | **409**   | **409**                                |
| Ingest worker `runIngestJob`                                                              | unchanged                          | job `failed`, run `error` (§7.5)    | same                       | same      | same                                   |
| MD5 cron + `verifyRunMd5`                                                                 | unchanged                          | excluded; skipped without FS access | same                       | same      | same                                   |
| `GET /project`, `/sample`, `/run` reconciliation                                          | unchanged                          | `NOT_APPLICABLE`, listings `null`   | same                       | same      | same                                   |
| `GET /project`, `/sample`, `/run` DB-backed `additionalFiles`/`rawFiles`                  | unchanged                          | returned                            | returned                   | returned  | returned                               |
| `location`                                                                                | HPC                                | HPC + `plannedS3Uri`                | S3                         | S3        | `authoritative: null`, `baseUri: null` |
| `GET /projects`, `/samples`, `/runs`, `/search`, `/runs/:id/status`, `/runs/batch-status` | `storage`/`projectStorage` present | same                                | same                       | same      | same                                   |
| `GET /accessions/csv` `list_of_read_files`                                                | HPC path                           | HPC path                            | `s3://`                    | `s3://`   | `unresolved:` marker (§7.6)            |
| `PUT /project/toggle-nudgeable`                                                           | allowed                            | allowed                             | allowed                    | allowed   | allowed                                |
| `POST /accessions/new`                                                                    | allowed                            | allowed                             | allowed                    | allowed   | allowed                                |
| `POST /groups/delete` datastore check                                                     | unchanged                          | unchanged                           | unchanged                  | unchanged | unchanged                              |

**Metadata-only updates that remain legal in every state**: `nudgeable`,
`nudges` (nudge worker), accessions on project/sample/run, `releaseDate`,
`doNotSendToEna`/reason, news items, group edits. Nothing in this spec makes
`Project` immutable.

### 7.4 Guard placement (must precede side effects)

`assertProjectAcceptsHpcWrites(project, requestId)` throws
`StorageReadOnlyError` (carries `projectId`, `storageState`). Placement:

- `POST /samples/new`: after `Project.findById` (`routes/samples.js:283`) and
  `canWriteGroup` (line 302), **before** the idempotent `Sample.findOne`
  (line 331) and before `new Sample().save()`.
- `POST /runs/new`: change `Sample.findById(sampleId).select("group")`
  (`routes/runs.js:414`) to `.select("group project")`, load
  `Project.findById(project).select("storage")`, guard after `canWriteGroup`
  (line 428) and **before** LibraryType resolution and the idempotent
  `Run.findOne` (line 534). `respondWithExistingRun` (line 490) is therefore
  unreachable for a non-hpc project, so a retried create after the lock
  answers 409, never a stale 200.
- `POST /runs/:id/reingest`: after `canWriteGroup` (`routes/runs.js:931`),
  before any merge or `requeueFailedIngest` (line 1136).
- `POST /projects/new`: no guard (new projects are `hpc`).

Authorisation always runs first so an unauthorised caller learns nothing about
storage state.

### 7.5 Worker and cron behavior

- `runIngestJob` (`lib/ingest-queue.js:811`): after `Run.findById` (814),
  resolve `Sample.findById(run.sample).select("project")` →
  `Project.findById(...).select("storage")` → `resolveStorageState`. If not
  writable: `IngestJob` → `failed` with
  `lastError: "PROJECT_STORAGE_READ_ONLY: project <id> is <state>"`, Run →
  `status: "error"`, `statusError: "This project's storage is read-only (<state>); the ingest was not performed."`,
  no filesystem access, return. Recovery: the quiescence preflight (§8.3)
  refuses to lock while any job is pending/claimed, so this path fires only if
  a job was enqueued during a race; `abort-before-copy` followed by
  `POST /runs/:id/reingest` recovers it.
- `findRunsNeedingVerification` (`lib/md5-verification.js:282`): compute
  `nonHpcProjectIds = Project.find(NON_HPC_FILTER).select("_id")`, then
  `sampleIds = Sample.find({ project: { $in } }).select("_id")`, and add
  `sample: { $nin: sampleIds }` to the run query. Both are cheap while non-hpc
  projects are few; the queries are skipped entirely when the first returns
  nothing.
- `verifyRunMd5` (line 25): after populating `sample.project` (already done
  at line 50), resolve state; if not `hpc`, return
  `{ success: true, skipped: true, reason: "PROJECT_STORAGE_READ_ONLY" }`
  **without** changing `md5VerificationStatus` and without touching the
  filesystem. Historical `destinationMd5`, `md5Mismatch`, `MD5LastChecked`
  are never rewritten.
- `recoverStalledVerifications` and `cleanupStalePendingRuns`: unchanged
  (DB-only).
- `GET /runs/:id/status` and `POST /runs/batch-status`: add `projectStorage`
  and, when not `hpc`, `md5VerificationApplicable: false` with
  `md5VerificationNotApplicableReason: "PROJECT_STORAGE_READ_ONLY"`. Existing
  fields keep their historical values.

### 7.6 Detail-route reconciliation

For any resolved state other than `hpc`, `GET /project`, `GET /sample`,
`GET /run` skip every `readdir` and return:

```jsonc
"actualAdditionalFiles": null,
"actualReads": null,                    // run only
"additionalFilesStatus": {
  "status": "NOT_APPLICABLE",
  "reason": "PROJECT_STORAGE_READ_ONLY",
  "storageState": "aws",
  "message": "HPC reconciliation is not applicable: this project's authoritative storage is S3.",
  "missing": [], "extra": [], "unresolved": []
},
"rawFilesStatus": { ...same shape... }  // run only
```

`status` gains the value `NOT_APPLICABLE` alongside `OK | WARNING | MISMATCH |
UNKNOWN`. DB-backed `additionalFiles` and `rawFiles` (populated Reads with
`file`) are returned exactly as today.

### 7.7 Accessions CSV (D14, needs sign-off)

Columns unchanged. For each run row, resolve the project's storage once per
project (batched). `list_of_read_files` cell:

- `authoritativeLocation === "hpc"`: existing expression.
- `authoritativeLocation === "s3"`: `storage.s3Uri + "/" + relativeToProjectRoot(File.path)`
  where `relativeToProjectRoot` strips a leading slash and then the stored
  `sourceRelativeRoot` prefix. If `File.path` does not begin with that prefix
  (a historical inconsistency the manifest will already have reported), emit
  `unresolved:<File.path>` and log a warning; never emit a duplicated prefix
  or a nonexistent HPC path.
- `invalid`: `unresolved:<File.path>`.

Mixed schemes in one export are the accepted consequence. If a real POSIX-only
consumer is identified before rollout, the alternative is a versioned
`GET /accessions/csv?locations=hpc-only` that emits the legacy HPC path for
every row regardless of state, not silent blanking or new columns.

### 7.8 Error contract

`routes/_utils.js` gains:

```js
// handleError(res, error, statusCode, message, requestId, extra)
// `extra` is spread into the body after the three existing fields.
const storageReadOnlyResponse = (res, { project, state, requestId }) =>
  handleError(
    res,
    new Error(`Project storage is read-only (${state})`),
    409,
    `This project's data storage is ${describe(state)}; new data cannot be added to it.`,
    requestId,
    {
      code: "PROJECT_STORAGE_READ_ONLY",
      projectId: String(project._id),
      storageState: state,
    },
  );
```

Body, byte-for-byte stable across every guarded endpoint:

```json
{
  "error": "This project's data storage is archived in AWS S3; new data cannot be added to it.",
  "detail": "Project storage is read-only (aws)",
  "requestId": "1757200000000-abc123def",
  "code": "PROJECT_STORAGE_READ_ONLY",
  "projectId": "64f1c0…",
  "storageState": "aws"
}
```

OpenAPI: add optional `code` (string), `projectId` (string), `storageState`
(string) to the shared error schema; add a `StorageSummary` schema; add
`storage` to Project, `projectStorage` to Sample/Run/search/status shapes;
add `location` to the three detail responses; add `NOT_APPLICABLE` to the
reconciliation status enum; document the 409 on the three write routes.
`__tests__/contract/openapi.test.js` must keep passing (no new routes are
added, so its route walk is unaffected).

`BREAKING_CHANGES.md`: new section describing the 409, the new fields, the
`NOT_APPLICABLE` status, the CSV URI change, and the rollback prohibition
(§18). `docs/CONTRACTS.md`: new drift-list entry "Storage state is
Project-owned; 409 `PROJECT_STORAGE_READ_ONLY` is terminal for Power".
`.env.example`: document `AWS_ARCHIVE_S3_ROOT`,
`AWS_ARCHIVE_EXPECTED_ACCOUNT_ID`, optional `AWS_ARCHIVE_SSE`,
`AWS_ARCHIVE_SSE_KMS_KEY_ID`, `KOMONDOR_READY_URL`, and note that the API
itself does not require them. `validateEnv` warns (does not fail) when
`READS_ROOT_PATH` is unset, since it now feeds displayed locations.

---

## 8. Migration CLI contract and runbook

### 8.1 Layout

- Entry point: `scripts/move-project-to-s3.js` (thin argv parser + dispatch,
  same env/connection/exit-code pattern as `scripts/inspect-ingest-backlog.js`,
  but it **does** load models because it must write).
- Implementation: `lib/s3-archive/{cli.js, config.js, preflight.js,
inventory.js, manifest.js, upload.js, verify.js, s3.js, state.js}` and
  `lib/utils/crc64nvme.js`. `lib/storage-state.js` is shared with the API.
- Exit codes: `0` success/nothing to do; `1` refused or findings (listed);
  `2` could not connect/configure; `3` failed mid-mutation (state persisted
  with `lastError`).
- Every AWS call is `child_process.execFile("aws", [...args], { env })` with
  `--output json`; never a shell string. Every command prints the resolved
  identity (Komondor user, OS user, AWS ARN/account, bucket, prefix, project,
  migration id) before doing anything.

### 8.2 Commands

```text
node scripts/move-project-to-s3.js plan               --project-id <ObjectId> [--json]
node scripts/move-project-to-s3.js lock               --project-id <ObjectId> --moved-by <user> [--acknowledge-known-anomalies] --execute
node scripts/move-project-to-s3.js copy               --project-id <ObjectId> --moved-by <user> [--exclude-entry <relpath> --exclude-reason "<text>"]... --execute
node scripts/move-project-to-s3.js status             --project-id <ObjectId> [--json]
node scripts/move-project-to-s3.js resume             --project-id <ObjectId> --migration-id <id> --resumed-by <user> --execute
node scripts/move-project-to-s3.js abort-before-copy  --project-id <ObjectId> --migration-id <id> --aborted-by <user> --execute
node scripts/move-project-to-s3.js restart            --project-id <ObjectId> --migration-id <old-id> --restarted-by <user> --execute
node scripts/move-project-to-s3.js deletion-command   --project-id <ObjectId>
node scripts/move-project-to-s3.js confirm-absent     --project-id <ObjectId> --confirmed-by <user> --execute
```

Without `--execute`, `lock`, `copy`, `resume`, `abort-before-copy`, `restart`
and `confirm-absent` run their preflight and print what they would do, and
exit 0/1 accordingly. `plan`, `status`, `deletion-command` never mutate
MongoDB or S3 in any mode. `--project-id` is the only selector; names are
never accepted.

`--moved-by` / `--resumed-by` / `--confirmed-by` must name an existing
Komondor `User` (`users` collection) and are audit identities. The authority
boundary is: shell access to the production host, the MongoDB credentials in
its `.env`, and the AWS role/profile available to that shell. The CLI records
`process.getuid()`/`os.userInfo().username` and `sts get-caller-identity` on
every mutating command.

### 8.3 Configuration and preflight (every command)

| Check                                                                                                                                                                                                                             | Failure                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `AWS_ARCHIVE_S3_ROOT` matches `^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](/[^/].*)?$` and has no trailing slash                                                                                                                       | exit 2                                                     |
| `AWS_ARCHIVE_EXPECTED_ACCOUNT_ID` is 12 digits                                                                                                                                                                                    | exit 2                                                     |
| `aws --version` parses as v2 and `aws s3 cp help` mentions `--checksum-algorithm`, `aws s3api head-object help` mentions `--checksum-mode`, `aws s3api put-object help` mentions `--if-none-match`                                | exit 2, prints the installed version and the minimum (§21) |
| `aws sts get-caller-identity` account equals expected                                                                                                                                                                             | exit 2                                                     |
| `aws s3api head-bucket` succeeds; `list-objects-v2 --max-keys 1` on the archive root succeeds                                                                                                                                     | exit 2                                                     |
| `DATASTORE_ROOT` set, is a directory (reuse `validateEnv`'s `checkMount`, read-only mode)                                                                                                                                         | exit 2                                                     |
| MongoDB reachable; `projects` collection exists                                                                                                                                                                                   | exit 2                                                     |
| Project exists; `resolveStorageState` is not `invalid` (mutating commands)                                                                                                                                                        | exit 1 with the integrity detail                           |
| Project root = `path.resolve(DATASTORE_ROOT, stripLeadingSlash(project.path))` is strictly below `DATASTORE_ROOT` by ≥ 2 segments, `realpath` of it equals its lexical path (no symlinked ancestor), it is a directory by `lstat` | exit 1                                                     |

Optional: `AWS_ARCHIVE_SSE=aws:kms` + `AWS_ARCHIVE_SSE_KMS_KEY_ID` are passed
as `--sse`/`--sse-kms-key-id` on uploads. With SSE-KMS the role also needs
`kms:GenerateDataKey` and `kms:Decrypt` (the latter to read checksums back via
`head-object --checksum-mode ENABLED`).

Bucket configuration the operator must confirm (deployment inputs, §21):
Object Ownership bucket-owner-enforced; versioning recommended; a lifecycle
rule `AbortIncompleteMultipartUpload` after 7 days on the whole archive root;
a transition rule to the chosen cold class **scoped to `<base>/data/`** with a
delay longer than the pilot's verification-plus-deletion window; **no
transition rule** on `<base>/control/`.

IAM policy for the mover role (minimum): `sts:GetCallerIdentity`;
`s3:ListBucket`, `s3:ListBucketMultipartUploads` on the bucket, condition
`s3:prefix` under `<base>/`; `s3:PutObject`, `s3:GetObject`,
`s3:GetObjectAttributes`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`
on `<base>/*`. **No `s3:DeleteObject`, `s3:DeleteObjectVersion`, or
`s3:PutLifecycleConfiguration`.** (`AbortMultipartUpload` lets the CLI clean up
its own failed upload; it cannot remove completed objects.)

### 8.4 Quiescence window and `lock`

Because `POST /samples/new` and `POST /runs/new` load, authorise, and only
later save (§2.2), and because the ingest worker holds work in memory, the
`hpc → migrating` transition is done with all writers stopped:

1. Announce the window. `pm2 stop komondor-api` (single instance,
   `ecosystem.config.js:38`). `server.js` refuses to exit while a transfer is
   in flight; wait for it or defer the window.
2. `lock --project-id … --moved-by … [--execute]`:
   - Refuses if `GET ${KOMONDOR_READY_URL:-http://127.0.0.1:${PORT}/ready}`
     answers anything but connection-refused (a 503 while draining still
     counts as _running_).
   - Refuses on any **hard blocker** (§8.5).
   - Reports every **anomaly** (§8.6); if any is _serious_, requires
     `--acknowledge-known-anomalies`, recorded as
     `anomalyAcknowledgement { by, at }` (manifest digest is filled in later
     by `copy` when the manifest is sealed).
   - Generates the migration id, snapshots `sourceRoot`,
     `sourceRelativeRoot`, computes `s3Uri = <root>/data/<sourceRelativeRoot>`,
     checks the data prefix and this migration's control prefix are empty
     (`list-objects-v2 --max-keys 1`) and that
     `list-multipart-uploads --prefix <data prefix>/` is empty.
   - Atomic transition:
     ```js
     Project.findOneAndUpdate(
       { _id, ...HPC_WRITABLE_FILTER },
       {
         $set: {
           storage: { state: "migrating", s3Uri },
           archiveMigration: {
             id,
             phase: "locked",
             movedBy,
             osUser,
             awsIdentityArn,
             awsAccountId,
             startedAt,
             updatedAt,
             sourceRoot,
             sourceRelativeRoot,
             anomalyAcknowledgement,
           },
         },
       },
       { new: true },
     ).select("+archiveMigration");
     ```
     A `null` result means the fence failed (someone else changed it); exit 1.
   - Repeats the hard-blocker preflight after the lock (a job could have been
     claimed between check and update only if the API was running, which
     step 2a forbids; the repeat is belt and braces).
3. `pm2 start komondor-api` **only with the guard-aware release** (§18 gate).
   Confirm `/ready` is 200.

The window is minutes long. `copy` then runs with the site live; the project
is read-only for storage from this point.

### 8.5 Hard blockers (lock, and re-checked by copy before sealing)

- Any `Run` under the project with `status ∈ {pending, processing}` or
  `md5VerificationStatus === "in_progress"` (runs found via
  `Sample.find({ project })` → `Run.find({ sample: { $in } })`).
- Any `IngestJob` with `status ∈ {pending, claimed}` whose `runId` is one of
  those runs.
- Any entry under the project root matching `PARTIAL_TRANSFER_PATTERN`
  (`lib/active-transfers.js:21`), i.e. `.part-<24hex>`.
- Project root containment/realpath failure (§8.3).
- AWS identity, bucket, prefix, or capability failure.
- Destination data prefix already contains any object, or this migration's
  control prefix already contains any object (lock only; copy uses ownership
  checks instead).

Historic `Run.status === "error"`, `md5VerificationStatus === "failed"`,
`md5Mismatch: true`, missing `MD5`, DB/disk differences and unexpected files
are **not** blockers.

### 8.6 Anomalies (reported, never blocking by themselves)

| Anomaly                                                                   | Serious?                           |
| ------------------------------------------------------------------------- | ---------------------------------- |
| Symlink (recorded with raw `readlink` target, skipped)                    | no                                 |
| Hard link (recorded with `dev:ino`, uploaded under every key)             | no                                 |
| Socket/FIFO/device/other special (recorded, skipped)                      | no                                 |
| Regular file on disk with no Read/AdditionalFile record                   | no                                 |
| Read/AdditionalFile record with no file on disk                           | **yes**                            |
| Read with `md5Mismatch: true` or `destinationMd5` absent                  | **yes**                            |
| Run with `status: "error"` or `md5VerificationStatus: "failed"`           | **yes**                            |
| `File.path` not under `sourceRelativeRoot` (§7.7 will emit `unresolved:`) | **yes**                            |
| Empty directory (recorded; S3 has no directories)                         | no                                 |
| Regular file unreadable (`EACCES`, `EIO`)                                 | **blocker unless excluded** (§8.7) |

### 8.7 `copy`

Runs in phases; each phase transition is a fenced update on
`{ _id, "storage.state": "migrating", "archiveMigration.id": id, "archiveMigration.phase": <expected> }`.
`copy` may be invoked repeatedly; it resumes from the stored phase (§9.6).
It refuses if `lastError` is set (use `resume`).

1. **Inventory** (`locked → inventoried`): §9.1. Also re-runs §8.5.
2. **Seal source manifest** (`inventoried → source_sealed`): serialise the
   manifest deterministically (sorted keys, `\n` line endings, UTF-8), compute
   SHA-256 of the exact bytes, PUT to
   `<control prefix>/source-manifest.v1.json` with
   `--if-none-match "*"`, `--content-type application/json`,
   `--checksum-algorithm CRC64NVME`, then HEAD it and compare
   `ContentLength` and CRC. Record `manifests.sourceS3Uri`, `sourceSha256`,
   `sourceSealedAt`, `fileCount`, `totalBytes`, `skippedEntries`, and
   `anomalyAcknowledgement.manifestSha256`. **From here automatic abort is
   forbidden.** If the PUT succeeded but the MongoDB update fails, `status`
   detects the orphan control object (HEAD on the deterministic key, digest
   match against a locally re-serialised manifest) and `resume` adopts it
   without re-uploading (§9.6).
3. **Copy** (`source_sealed → copying → copied`): §9.4, per entry, in
   manifest order, sequentially (one upload at a time in v1; parallelism is
   future work). Progress lines every N entries / every 60 s, and a
   `updatedAt` bump on the Project every 5 minutes so `migrationHealth` is
   meaningful.
4. **Verify** (`copied → verified`, state → `aws_pending_hpc_deletion`):
   §9.5. Writes `<control prefix>/verification-report.v1.json` with
   `--if-none-match "*"`, records its digest, then the single fenced update
   that sets `storage.state`, `storage.s3VerifiedAt`, `phase: "verified"`.

Any thrown error sets `lastError { at, phase, message }` and `failedAt` via
a fenced update (the phase is left unchanged), prints the `status` summary,
and exits 3.

`--exclude-entry <relpath> --exclude-reason "<text>"` (repeatable) is the only
way to proceed past an unreadable regular file. The exclusion is written into
the manifest entry (`disposition: "excluded", excludedBy, excludedReason`),
counted in `skippedEntries`, and the verification report lists it. It cannot
be applied to a readable file.

### 8.8 `status`

Read-only. Prints: resolved state and phase; migration id; identities;
timestamps; `lastError`; manifest pointers, digests and counts; whether the
source manifest object exists in S3 and whether its digest matches the stored
one; a count and sample of objects under the data prefix (paginated
`list-objects-v2`), split into _owned by this migration_ (metadata
`komondor-migration-id` equal), _owned by a prior migration id in
`restartedFrom`_, and _foreign_; every incomplete multipart upload under the
data prefix (`list-multipart-uploads`) with `UploadId`, key and initiated
time; a copy progress estimate (verified keys / manifest keys) when in
`copying`; and, in `aws_pending_hpc_deletion`, whether `lstat(sourceRoot)`
still succeeds. `--json` emits the same as one JSON document.

### 8.9 `resume`

Fenced on `_id`, state `migrating`, `archiveMigration.id === --migration-id`
and `manifests.sourceSha256` (must be set, i.e. phase ≥ `source_sealed`;
earlier failures are resumed by simply re-running `copy`, which re-inventories).
Steps: fetch the source manifest object, verify its SHA-256 equals the stored
digest (else exit 1: "control manifest damaged; see §8.11"), clear
`lastError`, increment `resumeCount`, record `lastResumedBy/At`, then continue
`copy` from the stored phase. It never re-walks the tree to build a new
manifest; the re-walk in phase 4 is a _comparison_ against the sealed one.

### 8.10 `abort-before-copy`

Allowed only when phase ∈ {`locked`, `inventoried`} and
`manifests.sourceSha256` is unset. Fresh checks, all of which must pass:
zero objects under the data prefix; zero objects under this migration's
control prefix; zero incomplete multipart uploads under the data prefix. Then:

```js
Project.findOneAndUpdate(
  {
    _id,
    "storage.state": "migrating",
    "archiveMigration.id": id,
    "archiveMigration.phase": { $in: ["locked", "inventoried"] },
    "archiveMigration.manifests.sourceSha256": { $exists: false },
  },
  {
    $set: {
      storage: { state: "hpc" },
      "archiveMigration.phase": "aborted",
      "archiveMigration.abortedBy": by,
      "archiveMigration.abortedAt": now,
    },
  },
);
```

`aborted` is added to `MIGRATION_PHASES`. Because the project returns to
`hpc`, the runbook recommends (not requires) doing this inside a quiescence
window; it is safe live because the only effect is to re-enable writes.

### 8.11 `restart` and irrecoverable attempts

When a migration past `source_sealed` cannot continue (control manifest
digest mismatch, source tree no longer matches the sealed manifest and the
operator has decided to re-baseline, or an S3 object that neither verifies nor
proves ownership):

1. `status` prints the exact inventory of migration-owned objects, foreign
   objects, and multipart uploads, and prints (never runs) the corresponding
   `aws s3api delete-object` / `abort-multipart-upload` commands under a
   heading "REVIEW BEFORE RUNNING WITH A ROLE THAT HAS DELETE".
2. A human, using a **different** role that has delete, removes the migration's
   data objects and aborts its uploads, and moves the old control objects to
   `<root>/control/projects/<projectId>/abandoned/<oldId>/` (copy + delete).
3. `restart --migration-id <old> --restarted-by … --execute` proves the data
   prefix has zero objects and zero uploads, proves the old control prefix is
   empty, then fences on the old id and sets a new id, phase `locked`,
   `restartedFrom: [...old]`, `lastError` cleared, `manifests` cleared. State
   stays `migrating`; `s3Uri`, `sourceRoot`, `sourceRelativeRoot` are kept.
   Because the project never returned to `hpc`, no quiescence window is
   needed.

No step requires editing MongoDB by hand.

---

## 9. Inventory, manifest, S3 keys, checksums, resume

### 9.1 Inventory walk

- `fs.opendir` recursion from `sourceRoot`, `lstat` for every entry,
  **never** following symlinks and never descending into a symlinked
  directory. Hidden entries are included. Nothing is excluded except that a
  `.part-<24hex>` name is a hard blocker.
- Do not use `routes/_utils.js#getActualFiles` (drops dotfiles and does not
  recurse) or any helper that can move or unlink.
- Pass 1: walk, record `{ relPath, type, size, mode, uid, gid, mtimeMs,
ctimeMs, dev, ino, nlink, linkTarget }`.
- Pass 2 (regular files only): open `O_RDONLY | O_NOFOLLOW` (reuse the pattern
  from `lib/utils/md5.js:68`; an `ELOOP` here means the path changed to a
  symlink since pass 1 → rerun), `fstat` and require `dev/ino/size/mtimeMs/
ctimeMs` equal to pass 1, stream once computing **both** SHA-256 and
  CRC-64/NVME, `fstat` again and require equality. Access time is ignored.
- Pass 3: walk again and require the set of entries and every recorded
  attribute (except atime) to be identical to pass 1. Any difference aborts
  with "source tree changed during inventory; rerun" (exit 1) and nothing is
  sealed.
- DB overlay: `Sample.find({ project })`, `Run.find({ sample: { $in } })`,
  `Read.find({ run: { $in } }).populate("file")`,
  `AdditionalFile.find({ $or: [{ project }, { sample: { $in } }, { run: { $in } }] }).populate("file")`.
  Expected disk path for a Read is `<run relative path>/raw/<file.originalName>`
  (the same rule `verifyRunMd5` uses, `md5-verification.js:216-224`); for an
  AdditionalFile it is `<parent relative path>/additional/<file.originalName>`.
  Match by NFC-normalised relative path.

### 9.2 Manifest format (`version: 1`)

```jsonc
{
  "manifestVersion": 1,
  "kind": "source",                       // "source" | "verification"
  "toolVersion": "<git commit of komondor-api>",
  "projectId": "…", "projectName": "…", "migrationId": "…",
  "sourceRoot": "/mnt/reads/tsl/wheat_blast",
  "sourceRelativeRoot": "tsl/wheat_blast",
  "dataPrefix": "s3://…/data/tsl/wheat_blast",
  "createdBy": { "komondorUser": "…", "osUser": "…", "awsArn": "…" },
  "createdAt": "…",
  "anomalyAcknowledgement": { "by": "…", "at": "…" } | null,
  "summary": { "regularFiles": 0, "totalBytes": 0, "symlinks": 0, "hardLinkGroups": 0,
               "special": 0, "emptyDirs": 0, "excluded": 0,
               "dbExpectedMissing": 0, "diskUntracked": 0, "checksumAnomalies": 0 },
  "entries": [
    {
      "relPath": "isolate_a/run_1/raw/reads_R1.fastq.gz",
      "type": "file",                     // file | symlink | dir | special
      "disposition": "copy",              // copy | skip | excluded
      "s3Key": "<data prefix without s3://bucket/>/isolate_a/run_1/raw/reads_R1.fastq.gz",
      "size": 123456789,
      "mode": 33188, "uid": 1000, "gid": 1000,
      "mtimeMs": 0, "ctimeMs": 0, "dev": 0, "ino": 0, "nlink": 1,
      "sha256": "<hex>",
      "crc64nvme": "<base64, big-endian 8 bytes, as S3 reports it>",
      "linkTarget": null,                 // raw readlink for symlinks
      "hardLinkGroup": null,              // "dev:ino" when nlink > 1
      "db": { "kind": "read" | "additionalFile" | null, "id": "…", "fileId": "…",
              "MD5": "…", "destinationMd5": "…", "md5Mismatch": null, "runStatus": "…" },
      "excludedBy": null, "excludedReason": null
    }
  ],
  "dbExpectedMissing": [ { "kind": "read", "id": "…", "expectedRelPath": "…" } ],
  "hpcSnapshot": { "dirCount": 0, "entryCount": 0 }
}
```

The verification report has the same header plus, per copied entry,
`{ relPath, s3Key, verified: true|false, contentLength, checksumCRC64NVME,
checksumType, storageClass, metadataMigrationId, headAt, error }`, the final
local re-walk result, the key-set comparison result, and
`sourceManifestSha256`. It is content-hashed the same way.

Neither document is ever stored in MongoDB; the Project holds only URIs,
digests, counts and timestamps.

### 9.3 S3 keys and ownership

- Data key: `<data prefix>` + `/` + `relPath`, `/`-joined by string
  concatenation. Never `path.join`. `relPath` segments are used verbatim
  (S3 keys are byte strings; the CLI URL-encodes as needed).
- Every data object is uploaded with
  `--metadata komondor-project-id=<id>,komondor-migration-id=<id>,komondor-source-manifest-sha256=<hex>,komondor-entry-sha256=<hex>`.
  The migration id lives in metadata, not in the key.
- An object at a manifest key is _owned_ when HEAD returns all four metadata
  values and project/migration ids match. A `restartedFrom` id also counts as
  owned for the purpose of _replacing_ (never for the purpose of _skipping_).
- Refuse to overwrite any object that is not owned. Foreign objects at
  manifest keys, or any object under the data prefix not at a manifest key,
  fail verification.

### 9.4 Upload of one entry

1. `fs.open(absPath, O_RDONLY | O_NOFOLLOW)`; on `ELOOP`/`ENOENT` → error.
2. `fstat(fd)`; require `ino, size, mtimeMs, ctimeMs` equal to the sealed
   manifest entry; else error "source changed since manifest". `dev` is
   recorded in the manifest but never compared after sealing: on a network
   mount st_dev is assigned at mount time, so a remount or reboot during a
   multi-day copy would otherwise strand the migration.
3. HEAD the key with `--checksum-mode ENABLED`. If present, owned, and
   `ContentLength === size` and `ChecksumCRC64NVME === entry.crc64nvme` and
   `ChecksumType === "FULL_OBJECT"` → mark verified-existing, close, next.
   If present but not owned → error. If present, owned, but mismatched →
   proceed to re-upload (allowed overwrite).
4. `execFile("aws", ["s3", "cp", "-", s3Uri, "--expected-size", String(size),
"--checksum-algorithm", "CRC64NVME", "--content-type",
"application/octet-stream", "--metadata", …, ...sseArgs, "--only-show-errors"])`.
   Pipe `fs.createReadStream(null, { fd, autoClose: false, highWaterMark: 8 MiB })`
   through a `PassThrough` that feeds the child's stdin **and** an SHA-256 and
   a CRC-64/NVME hasher. `--expected-size` is always passed (the CLI only
   requires it above 50 GB, but it lets the CLI size parts correctly).
5. On child exit 0: require local CRC/SHA over the streamed bytes to equal the
   manifest entry (proves the CLI was fed the sealed bytes), `fstat(fd)` again
   and require equality, then HEAD with `--checksum-mode ENABLED` and require
   `ContentLength`, `ChecksumCRC64NVME`, `ChecksumType === "FULL_OBJECT"`, and
   ownership metadata. Record `storageClass` as observed.
6. On any failure: the CLI aborts its own multipart upload on error; record
   the error, stop (v1 is sequential), set `lastError`. The next `resume`
   re-runs step 3 for every entry, so completed files are skipped and the
   failed file restarts from byte zero (D18).

### 9.5 Verification phase

1. For every `disposition: "copy"` entry: HEAD as in step 9.4.5. Record.
2. Paginated `list-objects-v2 --prefix "<data prefix>/"`: the key set must
   equal the manifest's copy-key set exactly. Extra keys or missing keys fail.
   Every listed object must be owned.
3. Local re-walk (pass 1 + pass 3 rules of §9.1, no hashing) and comparison
   against the sealed manifest: any added, removed, replaced (`ino`/`dev`),
   resized or `mtimeMs`/`ctimeMs`-changed entry fails. A changed `dev` alone
   does not (same reason as §9.4 step 2).
4. Build the verification report, seal it (`--if-none-match "*"`), HEAD it,
   record digest and URI.
5. Fenced transition to `aws_pending_hpc_deletion`.

If any step fails the project stays `migrating`/`copied` with `lastError`.
The report is still written (with `verified: false` entries) to a key
suffixed `.failed-<timestamp>.json` for the audit trail; the stored pointer is
only ever set to a fully passing report.

### 9.6 Resume semantics

| Stored phase                                                                           | What re-running does                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `locked`                                                                               | `copy` re-inventories from scratch (nothing sealed).                                                                                                                                                                                                                                                                                 |
| `inventoried`                                                                          | `copy` re-inventories (local-only state is not persisted between processes); the result must be identical anyway.                                                                                                                                                                                                                    |
| `source_sealed` orphan (object exists, MongoDB not updated, phase still `inventoried`) | `status` reports it; `copy` re-serialises the manifest from a fresh inventory and compares the bytes with the object; on equality it adopts the pointer; on inequality it records `lastError`, and `status` then prints the `aws s3 mv` that moves the orphan under `abandoned/`, after which `copy` or `abort-before-copy` proceed. |
| `copying`                                                                              | `resume` HEADs every key, skips verified-existing, re-uploads the rest.                                                                                                                                                                                                                                                              |
| `copied`                                                                               | `resume` runs verification only.                                                                                                                                                                                                                                                                                                     |
| `verified`                                                                             | nothing to do; use `deletion-command`.                                                                                                                                                                                                                                                                                               |

### 9.7 CRC-64/NVME

`lib/utils/crc64nvme.js`: reflected polynomial `0x9A6C9329AC4BC9B5`
(reflected form of `0xAD93D23594C93659`), init `0xFFFF_FFFF_FFFF_FFFF`, final
XOR `0xFFFF_FFFF_FFFF_FFFF`, 256-entry table, `BigInt`-free hot loop using two
32-bit halves (or `BigInt` if benchmarked acceptable at ≥ 200 MB/s). Output
helpers: `toBase64()` (8 bytes big-endian, matching S3's
`ChecksumCRC64NVME`) and `toHex()`. Known vector: input `"123456789"` →
`AE8B14860A799888` → base64 `rosUhgp5mIg=` (verified locally on
2026-09-07). Tests: the vector, an empty input, a multi-chunk equivalence
test, and the real-S3 smoke test (§16.4).

Justification per AWS documentation (checked 2026-09-07):
"Full object checksums in multipart uploads are only available for CRC-based
checksums"; the algorithm table lists CRC64NVME as full-object **yes**,
composite **no**, and SHA-256 as full-object **no**. `head-object` documents
`ChecksumType` ∈ {`COMPOSITE`, `FULL_OBJECT`} and notes that SHA-256/CRC32
values on multipart objects "may not be a direct checksum value of the full
object". AWS CLI v2 computes CRC64NVME by default for uploads and accepts
`--checksum-algorithm`; ETag is explicitly not an MD5 for multipart or
SSE-KMS objects. Therefore: SHA-256 is the manifest identity, CRC-64/NVME is
the S3 comparison, ETag and user metadata are never used as integrity proof.

---

## 10. Manual deletion and HPC-absence confirmation

### 10.1 `deletion-command`

Available only when the resolved state is `aws_pending_hpc_deletion`. Before
printing anything it:

1. Re-fetches the verification report, checks its SHA-256 against the stored
   digest, and re-HEADs **every** data key with `--checksum-mode ENABLED`
   (§9.4.5 rules). HEAD works on objects already transitioned to a cold class;
   the smoke test confirms checksum retrieval on a `DEEP_ARCHIVE` object.
2. Re-walks the HPC tree and compares it to the sealed source manifest
   (§9.5.3). Any drift → print the exact diff, keep the state, exit 1, and
   print the runbook instruction: preserve the drifted content elsewhere,
   restore the tree to the sealed manifest (restoring from S3 by hand if
   something was removed), then rerun. v1 does not amend a verified archive.
3. Validates the target: `sourceRoot` equals the recomputed project root,
   is ≥ 2 segments below `DATASTORE_ROOT`, `realpath(sourceRoot) ===
sourceRoot`, `lstat` says directory, and the path contains no `..`, no
   newline, no NUL.

It then prints exactly one command and never executes it:

```bash
# Project 64f1c0… "Wheat blast 2019" — migration 66d0a1… — verified in S3 2026-10-02T09:14:11Z
# 1,284 files, 3.9 TB. This removes the HPC copy. S3 is authoritative.
rm -rf -- '/mnt/reads/tsl/wheat_blast'
```

Quoting: single-quoted with `'` → `'\''` escaping, generated by one tested
function (`lib/s3-archive/shellQuote.js`) with unit tests for spaces, quotes,
`$`, backticks, newlines (rejected), and non-ASCII.

### 10.2 `confirm-absent`

Allowed only in `aws_pending_hpc_deletion`. `lstat(sourceRoot)`:

| Result                                                                                           | Outcome                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ENOENT`                                                                                         | pass                                                                                                  |
| directory (empty or not), file, symlink (even broken), `EACCES`, `ENOTDIR`, `EIO`, anything else | fail, exit 1, state unchanged, with the reason and the instruction to complete the deletion and rerun |

On pass: re-read the verification report and check its digest, then

```js
Project.findOneAndUpdate(
  {
    _id,
    "storage.state": "aws_pending_hpc_deletion",
    "archiveMigration.id": id,
    "archiveMigration.manifests.verificationSha256": digest,
  },
  {
    $set: {
      "storage.state": "aws",
      "storage.hpcVerifiedAbsentAt": now,
      "storage.archivedAt": now,
      "archiveMigration.phase": "completed",
      "archiveMigration.confirmedAbsentBy": by,
      "archiveMigration.updatedAt": now,
    },
  },
);
```

Partial manual deletion is safe to retry: the human finishes `rm -rf`, then
reruns `confirm-absent`. Nothing in the CLI ever runs the deletion.

---

## 11. komondor-web changes and UI-state matrix

### 11.1 Shared pieces

- `utils/storageState.js`: `describeStorage(summary)` → `{ badge: { show,
text, type, icon }, readOnly, authoritative, needsAttention }`; treats a
  missing summary as `hpc`; treats `state: "invalid"` as read-only with a
  danger badge "Storage state needs attention".
- `components/storage/StorageBadge.vue`: `props: { storage }`, renders the
  `b-tag` per the matrix; `size` prop for title vs card.
- `components/storage/StorageReadOnlyNotice.vue`: one-line `b-message`
  explaining why creation/upload actions are unavailable.
- `utils/apiError.js`: `readErrorBody` and `getApiErrorMessage` additionally
  expose `code` (`getApiErrorCode(error)`), and a helper
  `isStorageReadOnlyError(error)`.

| State                      | Badge                                                                                                                                             | Actions   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `hpc`                      | none                                                                                                                                              | unchanged |
| `migrating`                | "Moving to AWS" (`is-warning`, `cloud-upload`) + admin-only "AWS move needs attention" (`is-danger`) when `migrationHealth === "needs_attention"` | read-only |
| `aws_pending_hpc_deletion` | "Copied to AWS · HPC cleanup pending" (`is-info`, `cloud-check`)                                                                                  | read-only |
| `aws`                      | "Archived in AWS" (`is-info`, `archive`)                                                                                                          | read-only |
| `invalid`                  | "Storage state needs attention" (`is-danger`)                                                                                                     | read-only |

"Admin-only" uses the existing `$store.getters.isAdmin`.

### 11.2 File-by-file changes

| File                                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/project.vue`                                                                 | `StorageBadge` beside the title (lines 5-17). Replace the `/tsl/data/reads{{ project.path }}` field (line 126) with `location.baseUri`, labelled by `location.authoritative`, plus `plannedS3Uri` ("Planned S3 location, not yet verified") while migrating; add a copy button using `$copyText`. Build the additional-file list from DB records when `actualAdditionalFiles === null` (line 165), marking each `archived: true`. Pass `:project-storage="project.storage"` to `SampleList`; render `StorageReadOnlyNotice` and pass `show-new-button="false"` when read-only. Nudgeable checkbox (line 94) unchanged.                                      |
| `pages/sample.vue`                                                                  | Same badge/location/list changes (lines 5-19, 156, 193). Hide **Clone** (line 21-29, handler 302) when read-only. Pass storage to `RunList`; no New Run when read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pages/run.vue`                                                                     | Badge beside the existing MD5 tag (lines 6-17). Location field (line 129) from `location`. When read-only: MD5 tag text becomes "Checksums verified before archive" / "Checksum verification failed before archive" / hidden for pending; `mounted()` (line 299) must **not** start polling when `projectStorage.acceptsHpcWrites === false`; `fetchRunStatus` stops if a poll response comes back read-only. Hide **Clone** (lines 70-76). Pass `:location` and `:archived` to `ReadList` and `AdditionalFileList`.                                                                                                                                        |
| `components/ReadList.vue`                                                           | Accept `location` (object) and `archived` (bool) props instead of computing from `HPC_DATASTORE_ROOT` (line 213) and `runPath`; `getFullFilePath` (line 353) becomes `location.rawUri + "/" + name` (the only arithmetic). When `archived`: "Copy Path" copies the S3 URI and is labelled "Copy S3 location"; `md5Status(read)` (line 285) branches `Checking`/`Awaiting` become "Not checked before archive" (`is-light`), `Verified` becomes "Verified before archive", `Mismatch` becomes "Mismatch recorded before archive"; legend updated; the empty state (lines 3-12) says "No read files are recorded for this run" without the "processing" hint. |
| `components/AdditionalFileList.vue`                                                 | Accept `location`/`archived`; path from `location.additionalUri`; when `archived`, list DB records with an "archived" check and never show "No additional files detected in HPC" (line 4); show "No additional files were recorded" instead. Replace the `alert()` copy feedback with a toast while here.                                                                                                                                                                                                                                                                                                                                                   |
| `components/projects/ProjectCard.vue`, `samples/SampleCard.vue`, `runs/RunCard.vue` | Render `StorageBadge` (small) from `item.storage` / `item.projectStorage` / `projectStorage` prop fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `components/projects/ProjectList.vue`                                               | Fix the string-`"false"` bug (line 34) so `show-new-button="false"` hides the button (accept Boolean, coerce).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `components/samples/SampleList.vue`, `runs/RunList.vue`                             | Accept `projectStorage` prop; hide New when read-only; pass it to cards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pages/samples/new.vue`                                                             | In `asyncData` (line 171-207) after fetching the project: if `!project.storage.acceptsHpcWrites` → `error({ statusCode: 409, message: "This project's storage is read-only (…); samples cannot be added." })`. On submit, `isStorageReadOnlyError` → toast the API message and route back to the project.                                                                                                                                                                                                                                                                                                                                                   |
| `pages/runs/new.vue`                                                                | Same in `asyncData` (line 307-341) using `sample.projectStorage`; same submit handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pages/projects/new.vue`                                                            | No change (new projects are `hpc`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pages/search.vue`, `components/NavSearch.vue`                                      | Cards get badges automatically via `storage`/`projectStorage`; NavSearch options show a small cloud icon when read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pages/export.vue`                                                                  | Add the note: "For projects archived in AWS, read-file locations are `s3://` URIs."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pages/help.vue`                                                                    | Add a short "Archived projects" paragraph (what the badges mean; that files are not downloadable from the site).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `components/home/Home.vue`                                                          | Sidebar project links show the small badge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `plugins/error-handler.js`                                                          | No change (409 stays with the caller, line 105).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `utils/apiError.js`                                                                 | As above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `nuxt.config.js`, `.env.example`                                                    | `HPC_DATASTORE_ROOT` is no longer read by components; keep the variable one release for safety, mark deprecated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The web never constructs an `s3://` URI from parts other than appending a
filename, never renders download/browse/restore/presign/console actions, and
treats a 409 `PROJECT_STORAGE_READ_ONLY` as authoritative over its own
preflight.

---

## 12. komondor-power changes

| Area                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/utils/komondorApiClient.ts`       | Add `interface ProjectStorageSummary { state: string; acceptsHpcWrites: boolean; authoritativeLocation: "hpc" \| "s3" \| null; s3Uri: string \| null; … }`; add `storage?: ProjectStorageSummary` to `Project` (line 31) and `projectStorage?: ProjectStorageSummary` to `Sample` (line 53) and `Run` (line 76). Keep index signatures. Add a `KomondorApiError` shape exposing `response._data.code`. **Keep 409 out of `isRetryableError` (line 205)** and add the regression test.                                                                                                                                                                                                                       |
| `server/utils/komondorApiErrorMessage.ts` | Export `extractErrorCode(e)` reading `response._data.code`. When the code is `PROJECT_STORAGE_READ_ONLY`, `extractErrorMessage` returns the API `error` text verbatim plus " This is permanent for this project."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `validatePreExistingEntities.ts`          | After the permission check for a pre-existing project (line 207) and sample (line 256): `assessStorage(summary)` → if summary absent → writable (rolling deployment); if `acceptsHpcWrites === false` → error "Project '<name>' storage is <state>; new samples/runs cannot be added. Remove these rows or choose another project."; if state is not one of the five known values, or `acceptsHpcWrites === true` with state ≠ `hpc`, or `acceptsHpcWrites` not boolean → fail closed with "Komondor reported an unrecognised storage state (<json>); contact the administrators." Runs for **both** the pre-existing-project and pre-existing-sample paths; the sample path reads `sample.projectStorage`. |
| `insertMetadata.ts`                       | Wrap each create; on `extractErrorCode(e) === "PROJECT_STORAGE_READ_ONLY"`: mark the entry error, log `formatCreatedEntitiesSummary` with a new terminal variant that lists created IDs and says "This failure is permanent for project '<name>'. Do not resubmit the same rows; already-created entities are listed above for review.", skip `pollRunsUntilComplete` for runs of that project, and stop further creates. Remove the unconditional "You can safely resubmit the same CSV…" sentence (line 95) for **all** failures, since `checkUniqueProjectNames` contradicts it; replace with the doc's manual-cleanup guidance.                                                                         |
| `docs/CSV_UPLOAD_WORKFLOW.md`             | New subsection under "Using Pre-existing Projects and Samples": archived projects are rejected at validation; and under "How to Handle Partial Failures": storage 409 is terminal; align the example log with the code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CSV schemas                               | **No new column** (`lib/metadataValidationSchema.ts`, `lib/additionalValidationSchema.ts`); header order stays byte-identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Tests                                     | `tests/unit/komondorApiClientRetry.test.ts` (new): 409 attempted once; 503 retried. `tests/unit/preExistingEntities.test.ts`: cases for absent summary, explicit `hpc`, each of the three non-hpc states for project and for sample paths, unknown state, contradictory pair. `tests/unit/komondorApiErrorMessage.test.ts`: code extraction. New `tests/unit/insertMetadata.storageReadOnly.test.ts`: race-time 409 marks error, stops creates/polling, reports created IDs, no "safe to resubmit".                                                                                                                                                                                                         |

---

## 13. komondor-nudge changes

| Area                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models.js`                  | Add to the Project schema, read-only, **no defaults**: `storage: { state: String, s3Uri: String, s3VerifiedAt: Date, hpcVerifiedAbsentAt: Date, archivedAt: Date }`. Do not declare `archiveMigration`. Update the header comment (lines 3-8).                                                                                                                                                                                                                                                      |
| `checkNudgeUpdates.js`       | No eligibility change. Add `storageState: project?.storage?.state ?? "hpc"` to each decision's `detail`-adjacent logging only (no new `REASONS` entry, no email change).                                                                                                                                                                                                                                                                                                                            |
| `audit-nudges.js`            | `showProject` (line 215) prints `storage: <state> (<s3Uri>)`; `showNudges` adds `storage=` column. Lean queries already return the raw field; the declaration documents the contract.                                                                                                                                                                                                                                                                                                               |
| `__tests__/helpers/world.js` | `buildWorld` project spec accepts `storage` and writes it raw (lines 83-98).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Tests                        | `__tests__/nudgeStorageCompat.test.js` (new): (a) projects in `migrating`, `aws_pending_hpc_deletion`, `aws` with due dates are nudged with the same reasons as `hpc`; (b) `nudgeable: false` still yields `NOT_NUDGEABLE` for an `aws` project; (c) after a nudge run, `readProjects()` shows `storage` byte-identical to the fixture (the `$push` did not touch it); (d) `models.test.js` addition: constructing and saving a Project through the nudge model does not write any `storage` field. |
| `README.md`                  | Extend "Fields shared with komondor-api" (line 99): reads `Project.storage.*` for display only; archival in S3 is independent of ENA release and never suppresses a nudge.                                                                                                                                                                                                                                                                                                                          |

---

## 14. Security, authorisation, path safety, IAM, failure handling

- **API authorisation before disclosure**: every guard runs after the existing
  `canWriteGroup` / visibility checks, so 403 precedes 409 and an
  unauthorised caller learns nothing.
- **Public projection**: `archiveMigration` is `select: false` and stripped
  by the transform; `storage` is rewritten to the summary. A test asserts that
  no response from any entity route contains the strings `archiveMigration`,
  `sourceRoot`, `movedBy`, `control/`, or a manifest digest.
- **Path safety in the CLI**: source root and destination are derived, never
  accepted; containment via `resolveBelow`-style lexical check plus
  `realpath` equality; `lstat` everywhere; `O_NOFOLLOW` opens; descriptor
  identity before and after; no pathname is ever passed to `aws`. Shell
  quoting only in the printed deletion command, from one tested function.
- **AWS**: account-id preflight, least-privilege role without delete, SSE
  per configuration, no credentials logged, `--if-none-match "*"` on control
  writes, no `sync --delete`.
- **Process**: mutating commands require `--execute` and an audit identity;
  identities are recorded on the Project and in every manifest.
- **Failure handling**: every mutation is a fenced update; every failure
  leaves `lastError` and a stable phase; `status` is always able to describe
  the situation; recovery paths are `resume`, `abort-before-copy` (pre-seal
  only) and `restart` (post-cleanup). No path requires manual MongoDB edits.
- **Web/Power**: they never see internals; they key off `code` and
  `acceptsHpcWrites`.

---

## 15. Requirements and acceptance criteria

Priority: **P0** must ship in v1; **P1** should ship in v1 but may follow in
the same release train; **P2** nice-to-have.

### P0

**R1 Legacy normalisation.** Given a project document with no `storage`
field, when serialized or queried with `HPC_WRITABLE_FILTER`, then it is
`hpc`, `acceptsHpcWrites: true`, and matched by the filter; given
`storage: { state: "hpc" }` the same holds; given `storage.state: "aws"`
without `s3VerifiedAt`, then the summary is `invalid`, writes answer 409 with
`storageState: "invalid"`, and `[storage-integrity]` is logged.

**R2 Write guards.** For each of `POST /samples/new`, `POST /runs/new`,
`POST /runs/:id/reingest`, and for each non-hpc state: given an authorised
user, when called, then 409 with the exact envelope (§7.8), no directory is
created, no `IngestJob` is written, `sortAdditionalFiles` is not called, and a
repeated identical request also answers 409 (never the idempotent 200). Given
an unauthorised user, then 403 and the body contains no storage information.

**R3 Worker guard.** Given a claimed job whose project is non-hpc, when
`runIngestJob` runs, then no `fs` call under `DATASTORE_ROOT` occurs, the job
is `failed` with the code in `lastError`, and the run is `error` with the
stated `statusError`.

**R4 MD5.** Given runs of a non-hpc project with `md5VerificationStatus:
"pending"`, when the cron runs, then they are not selected and no `fs` call
occurs; given `verifyRunMd5` invoked directly on one, then it returns
`skipped` with reason and changes no Read/Run fields.

**R5 Detail reads.** Given a non-hpc project with Reads and AdditionalFiles
in the DB and **no files on disk**, when `GET /project|/sample|/run` are
called, then no `readdir` occurs, listings are `null`, statuses are
`NOT_APPLICABLE` with reason, and the DB-backed records are present in full.

**R6 Response shaping.** `GET /projects`, `/samples`, `/runs`, `/search`,
`/runs/:id/status`, `/runs/batch-status` carry `storage`/`projectStorage` for
every item; the number of MongoDB queries per response is bounded by a
constant (test with a query counter); `sample.project` and `run.sample`
retain today's types.

**R7 Accessions CSV.** Given one hpc project and one `aws` project each with
two reads, then the CSV has the HPC paths for the first and
`s3Uri + "/" + relative` for the second with no duplicated segment; given a
Read whose `File.path` is outside `sourceRelativeRoot`, then `unresolved:`.

**R8 CLI dry-run.** Every command without `--execute` performs zero
`updateOne/findOneAndUpdate` calls and zero `aws s3 cp`/`put-object`
invocations (asserted with spies on the Mongo driver and on `execFile`).

**R9 Lock.** Given `/ready` reachable, then `lock` refuses; given a run
`processing` or an `IngestJob` `claimed` or a `.part-` file, then refuses;
given a clean preflight and account mismatch, then refuses; given all clean,
then the fenced update succeeds exactly once and a concurrent second `lock`
gets `null` and exits 1.

**R10 Inventory.** Hidden files and files with no DB record are in the
manifest with `disposition: "copy"`; a symlink is recorded with its raw
target and skipped, and a test proves no `open` on its target; a FIFO is
recorded and skipped; a hard-link pair is two entries sharing
`hardLinkGroup`; a file that changes between pass 1 and pass 3 aborts the
inventory.

**R11 Descriptor pinning.** Given a file replaced by a symlink (or by a
different inode) after inventory, when uploaded, then the `fstat` mismatch
fails the entry and the CLI never reads the new target.

**R12 Exclusions.** An unreadable regular file blocks `copy`;
`--acknowledge-known-anomalies` does not unblock it; `--exclude-entry` with a
reason does, records it in the manifest, and the verification report lists
it; `--exclude-entry` on a readable file is refused.

**R13 Sealing.** The source manifest object is written before any data upload,
with `--if-none-match "*"`, and its SHA-256 is stored; `resume` refuses when
the object's digest differs from the stored one.

**R14 Upload verification.** Given a mocked `head-object` returning
`ChecksumType: "COMPOSITE"` or a differing CRC or size, then the entry fails;
given a matching owned object, then it is skipped without upload; given an
object without ownership metadata, then the entry fails and nothing is
overwritten.

**R15 Verification phase.** An extra object under the data prefix, a missing
key, or a local tree change after inventory each prevent the transition; on
success the report is sealed, its digest stored, and the state becomes
`aws_pending_hpc_deletion` in a single fenced update.

**R16 Abort.** Allowed only in `locked`/`inventoried` with zero objects, zero
control objects and zero multipart uploads (each condition tested
individually); refused after `source_sealed`.

**R17 Deletion command.** Refused in every state but
`aws_pending_hpc_deletion`; refused when HEAD re-verification fails; refused
with a diff when the local tree drifted; the printed command targets exactly
`sourceRoot`, is correctly quoted for spaces and quotes, and `execFile`/`exec`
are never called with it.

**R18 Absence.** `confirm-absent` passes only on `ENOENT`; an empty directory,
a broken symlink, and `EACCES` each fail; on pass the fenced update records
`hpcVerifiedAbsentAt`, `archivedAt`, `confirmedAbsentBy`, state `aws`.

**R19 Web.** Component tests: badge text per state; New/Clone hidden when
read-only; `samples/new` and `runs/new` `asyncData` error on read-only
parents; location fields come from `location`; `ReadList`/`AdditionalFileList`
archived rendering; run page does not start polling when read-only.

**R20 Power.** Validation rejects pre-existing project and sample for each
non-hpc state, accepts absent and `hpc`, fails closed on unknown/contradictory;
409 is attempted once; race-time 409 marks the entry error, stops creates and
polling, lists created IDs, and the output contains no "safely resubmit".

**R21 Nudge.** As §13 tests.

### P1

**R22** `migrationHealth` and the admin "needs attention" treatment.
**R23** `status --json`. **R24** `restart` command. **R25** `validateEnv`
warning for unset `READS_ROOT_PATH`. **R26** `ProjectList` New-button fix.

### P2

**R27** Nudge audit storage column. **R28** Help-page copy.

---

## 16. Test strategy

### 16.1 komondor-api unit/integration (Jest)

- `__tests__/lib/storage-state.test.js`: normalisation table, predicates,
  summary, `locationFor`, `attachProjectStorage` query counting.
- `__tests__/models/ProjectStorage.test.js`: transform strips
  `archiveMigration`, `select: false` honoured, `+archiveMigration` works.
- Route tests extended in `__tests__/routes/{samples,runs,projects,search,
accessions}.test.js` for R2, R5, R6, R7, with `fs` spied to prove no
  datastore access.
- `__tests__/lib/ingest-queue.test.js`, `md5-verification.test.js`,
  `background-jobs.test.js` for R3/R4.
- `__tests__/contract/openapi.test.js` unchanged and green; add
  `__tests__/contract/storage-error-envelope.test.js` asserting the 409 body
  keys and order across all guarded routes.
- `__tests__/lib/s3-archive/*.test.js` with `execFile` mocked per AWS
  subcommand and a temp datastore (`tmp`), covering R8-R18. Symlink/FIFO/
  hard-link fixtures are created in the temp tree.
- `__tests__/lib/crc64nvme.test.js`: vectors (§9.7).
- `__tests__/integration/s3-archive-cli.test.js`: spawns the real script in
  dry-run against `mongodb-memory-server`-style fixtures, exercising exit
  codes.

### 16.2 komondor-web (Vitest)

New `tests/components/StorageBadge.test.js`, `ReadList.test.js`,
`AdditionalFileList.test.js`, `ProjectCard.test.js`; extend
`tests/unit/pages/samples-new.test.js`, `runs-new.test.js`; new
`tests/unit/pages/run.test.js` for polling and location. Playwright: one spec
that stubs an archived project and checks badge, hidden actions and the copy
button.

### 16.3 komondor-power / komondor-nudge

As listed in §12 and §13.

### 16.4 Real-S3 smoke test (before the first live migration; not part of this task)

Runs on the production host with the mover role against a disposable prefix
`<root>/smoke/<timestamp>/`:

1. `aws --version`; record it in the runbook.
2. Upload via the exact §9.4 code path: one 1 KiB file, one 100 MiB file
   (> the CLI's default 8 MiB multipart threshold), one file > 5 GiB (forces
   multipart regardless of configuration), and one 1 KiB file with
   `--storage-class DEEP_ARCHIVE`.
3. For each: `head-object --checksum-mode ENABLED` must return
   `ChecksumCRC64NVME` equal to the locally computed value and
   `ChecksumType: "FULL_OBJECT"`; `ContentLength` equal; metadata present.
   The `DEEP_ARCHIVE` object confirms HEAD checksum retrieval on a cold class.
4. Conditional PUT with `--if-none-match "*"` on an existing key must fail
   with `412`.
5. `list-multipart-uploads` shows nothing after a deliberately killed upload
   (kill the child mid-stream, then assert the CLI aborted it; if it did not,
   the bucket's abort-incomplete lifecycle rule is the backstop and the
   runbook must say so).
6. Cleanup is done by a human with a delete-capable role; the mover role has
   none.

The smoke test is a checklist script in the runbook, not a Jest test.

---

## 17. Observability and success criteria

Every CLI command logs a single-line JSON record per phase to stdout and a
human summary to stderr: `projectId, migrationId, command, phase, actor
{komondorUser, osUser, awsArn, awsAccountId}, bucket, prefix, counts
{files, bytes, skipped, excluded, anomalies}, sourceSha256,
verificationSha256, durations, lastError, s3VerifiedAt,
deletionCommandPrintedAt, hpcVerifiedAbsentAt`. No secrets, no presigned
URLs.

API: `[storage-guard] 409 PROJECT_STORAGE_READ_ONLY project=<id> state=<s>
route=<r> user=<u> requestId=<id>` per refusal; `[storage-integrity]` per
invalid resolution; `[ingest] job <id> failed: PROJECT_STORAGE_READ_ONLY`.

Success criteria for the pilot: one project reaches `aws` with zero
`needs_attention` intervals; every guarded route answers 409 during the
window with no directory created (verified by `find -newer`); the web shows
the badge on all three detail pages and in search; Power rejects a CSV
naming the project; nudge's next run classifies the project unchanged.

---

## 18. Rollout, compatibility, rollback, implementation slices

### Ordered slices

1. **api-1 model + state lib**: schema fields, `lib/storage-state.js`,
   transform, predicates, tests (R1).
2. **api-2 guards + workers + reads**: route guards, worker guard, MD5
   exclusion, `NOT_APPLICABLE` reads, `location`, `projectStorage`, error
   helper `extra`, OpenAPI, BREAKING_CHANGES, CONTRACTS (R2-R6).
3. **api-3 accessions CSV** (R7) after sign-off on D14.
4. **nudge-1** (§13). **power-1** (§12). Both can start once api-2's contract
   is merged; they must tolerate an API that does not yet send the fields.
5. **web-1** shared badge/util/apiError; **web-2** pages, lists, forms,
   polling (R19).
6. **api-4 CLI**: `lib/s3-archive/*`, `scripts/move-project-to-s3.js`,
   `crc64nvme`, runbook, mocked tests (R8-R18). Not run on production data.
7. **ops-1**: bucket, IAM, lifecycle, KMS decision; smoke test (§16.4).
8. **ops-2 pilot**: `plan` on several historically messy projects; review
   reports; pick one small non-critical project; lock in a window; copy;
   review; delete; confirm; observe for an agreed period before the next.

### Compatibility gate

**No project may leave `hpc` until** the API, ingest worker and MD5 worker
processes (all in the single `komondor-api` instance) run a release containing
slices 1-2, and the deployed komondor-web and komondor-power can interpret
`storage`/`projectStorage` (slices 4-5). The `lock` command enforces the
first half mechanically by requiring the API to be _down_ during the lock and
the runbook requires the restart to be the guarded release; the CLI
additionally refuses `lock` unless `package.json` version ≥ the version that
introduced the guards and `lib/storage-state.js` is importable.

### Rollback boundaries

| Phase                                        | Rollback                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slices 1-6 deployed, every project `hpc`     | Any component may roll back freely; the fields are additive and absent values mean `hpc`.                                                                                                                                                                                                                                                        |
| Any project `migrating` (pre-seal)           | `abort-before-copy` returns it to `hpc`; then rollback is free.                                                                                                                                                                                                                                                                                  |
| Any project `migrating` (post-seal) or later | **Rolling back the API/worker to a state-unaware build is prohibited**: it would create directories and move files into a locked or deleted tree. Recovery is roll-forward (fix and redeploy) or, for a not-yet-deleted project, `restart` after manual S3 cleanup. Web/Power may roll back (they are not enforcement), at the cost of stale UI. |
| `aws`                                        | No rollback exists; the HPC copy is gone. Restoration is a manual S3 retrieval, out of scope.                                                                                                                                                                                                                                                    |

`BREAKING_CHANGES.md` records this prohibition; `validateEnv` cannot detect an
older build, so the runbook's version check and the CLI's `lock` check are
the controls.

---

## 19. Risks and mitigations

| Risk                                                                              | Mitigation                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The production AWS CLI predates full-object checksum support                      | Capability preflight (§8.3) and smoke test; deployment input.                                                                                             |
| `aws s3 cp -` from stdin buffers or sizes parts unexpectedly for very large files | `--expected-size` always passed; > 5 GiB smoke test; 10,000-part limit implies ≥ 500 MiB parts near 5 TB, well within the CLI's automatic sizing.         |
| Long copies of multi-TB projects fail midway                                      | File-granular resume; `updatedAt` heartbeat; `needs_attention` health.                                                                                    |
| Historical DB/disk inconsistencies stall archiving                                | Anomalies are reported, not blockers; only byte loss blocks.                                                                                              |
| Web shows stale state after the lock                                              | The site is restarted in the window; caches are per-request.                                                                                              |
| Power validated before the lock                                                   | API 409 is terminal and handled (§12).                                                                                                                    |
| Someone runs the deletion command on the wrong host/path                          | The command is only printed after fresh S3 + local verification, quoted, and targets the snapshot root; the runbook requires `status` first.              |
| Cold-tier lifecycle moves control manifests                                       | Rule scoped to `data/`; smoke test confirms HEAD works on cold data objects anyway.                                                                       |
| Operator role accidentally has delete                                             | IAM policy reviewed as a deployment input; `status` proves the role by attempting `get-caller-identity` and printing the ARN; no code path issues delete. |
| CSV consumers outside the repo expect POSIX paths                                 | D14 sign-off; versioned `?locations=hpc-only` fallback designed.                                                                                          |

---

## 20. Future work

Durable per-project write leases replacing the quiescence window; parallel
uploads; mid-file multipart resume; reviewed supplemental-manifest workflow
for post-verification drift; fleet-wide DB/filesystem audit tool built on the
inventory module; console deep-link on the web; optional storage-state column
in nudge emails; automated (still human-approved) deletion; retrieval
tooling; backfilling `storage.state: "hpc"` on legacy documents.

---

## 21. Remaining deployment inputs

1. `AWS_ARCHIVE_S3_ROOT` (bucket and base prefix) and the AWS region.
2. `AWS_ARCHIVE_EXPECTED_ACCOUNT_ID`.
3. Encryption choice: SSE-S3 or SSE-KMS with key ARN (affects IAM).
4. Bucket setup: ownership, versioning, abort-incomplete-multipart rule,
   cold-class transition rule and delay scoped to `data/`, chosen storage
   class (operations decision; the application is class-agnostic).
5. Mover IAM role/profile (no delete) and the separate delete-capable role
   for reviewed cleanup.
6. Production host, its AWS CLI version (minimum: a v2 release exposing
   `--checksum-algorithm CRC64NVME`, `head-object --checksum-mode`, and
   `put-object --if-none-match`; the dev machine's 2.34.1 does), and the
   `KOMONDOR_READY_URL`/`PORT` for the quiescence check.
7. Grace-period policy between `aws_pending_hpc_deletion` and manual deletion,
   and who may run the deletion.
8. Confirmation that `READS_ROOT_PATH` (API) and `HPC_DATASTORE_ROOT` (web)
   are the same value in production, since the API's value becomes the single
   displayed root.
9. **Product sign-off on D14** (mixed `s3://` and POSIX paths in the accessions
   CSV) or a named POSIX-only consumer that needs the `?locations=hpc-only`
   variant.

---

## 22. Deviations from the agreed direction

1. **`lock` is a separate command from `copy`.** The prompt's `copy --execute`
   implied locking inside copy. Splitting keeps the API-down window to
   minutes and lets the multi-hour copy run with the guarded site live. All
   safety properties (atomic fence, post-lock preflight, quiescence) are
   preserved.
2. **`data/` and `control/` sub-prefixes under the archive root.** The prompt
   said data mirrors the `DATASTORE_ROOT`-relative path "under a configurable
   bucket/base prefix" and separately required manifests excluded from cold
   lifecycle. S3 lifecycle filters are prefix-based, so the exclusion is only
   implementable if data and control are disjoint prefixes. The mirrored
   hierarchy is intact beneath `data/`.
3. **A `restart` command** is added for the post-seal irrecoverable case so
   that "never strand the Project with edit-Mongo-by-hand" holds; it is
   narrowly fenced and requires prior manual S3 cleanup with a different role.
4. **`invalid` is a derived public state**, not stored, so that a corrupt
   document is visible to operators and read-only to clients without adding a
   storable enum value.
5. **`aborted` phase value** is added so an aborted attempt remains auditable
   on the document after storage returns to `hpc`.
