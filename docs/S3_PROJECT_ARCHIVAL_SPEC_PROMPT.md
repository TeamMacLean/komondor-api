# Task: finalise the project-to-S3 archival specification

You are working in the `komondor-api` checkout. The sibling repositories `../komondor-web`, `../komondor-power`, and `../komondor-nudge` are part of the same change.

This is a **specification task only**. Inspect the current code in all four repositories, then create or replace:

`docs/S3_PROJECT_ARCHIVAL_SPEC.md`

Do not implement the feature, edit application code, add dependencies, or create migrations in this task. The only repository file you should change is the specification document. Read local code/configuration and current official AWS documentation; local `aws --version`/help inspection is acceptable, but do not contact AWS, MongoDB, production services, or mutate any filesystem data while writing the spec. Every S3 smoke test and migration command described below is a future implementation/rollout requirement, not an action for this task. At the end, give me a concise summary of the spec and call out only genuine remaining deployment inputs.

The earlier proposal was directionally useful but contained factual and design errors. Use the decisions and corrections below as the baseline. Verify every code claim against the current checkout before citing it. If line numbers have moved, cite the current file, symbol, and line. If code evidence requires a material deviation from this prompt, make the smallest defensible change and record it in a short “Deviations from the agreed direction” section rather than silently changing the product decisions.

## Outcome

We need a safe, deliberately manual v1 workflow for archiving an old Komondor project from the canonical HPC datastore to Amazon S3. A project, all of its samples and runs, and all content beneath its project directory must visibly become read-only for storage-bearing operations and S3-backed in Komondor. Unrelated metadata workflows remain available where explicitly allowed. S3 retrieval is deliberately outside the application.

The specification must be decisive and implementation-ready. It should let a developer divide the work into reviewable changes across the four repositories without reopening settled questions.

## Fixed product and operational decisions

Treat these as settled:

1. **Project-only granularity.** A project moves as one unit. Samples and runs never move independently and do not own separate storage state.
2. **AWS means Amazon S3.** This is archival storage intended for rare, slow, expensive, ad hoc retrieval.
3. **No retrieval feature.** Komondor does not browse, restore, proxy, download, or create presigned URLs for S3 objects. A future retrieval is a separate manual operation.
4. **Only `DATASTORE_ROOT` is in scope.** `HPC_TRANSFER_DIRECTORY` is temporary inbound staging. It is not tracked, audited, backed up, copied, or checked by this workflow.
5. **The mover is a Node CLI in `komondor-api/scripts/`.** It reuses the repository’s environment and Mongoose setup. It is not a separate application, web page, background service, or HTTP endpoint.
6. **No admin flag-toggle route or checkbox.** Storage state may change only through the verified CLI workflow. A generic mutation route would allow the database to claim “AWS” without proving the copy.
7. **HPC deletion is separate and manual in v1.** The mover must never delete HPC data. Once the S3 copy is verified, it may print one exact, safely quoted CLI deletion command for a human to inspect and run.
8. **Absence confirmation is separate.** After manual deletion, a CLI subcommand must verify that the exact canonical project root itself is absent and only then record the final state. Checking only database-known files is insufficient.
9. **Filesystem reality drives the archive manifest.** Recursively inventory the exact project tree, including hidden and untracked regular files. Overlay database expectations to produce an audit; do not limit the copy to `Read` records.
10. **Historical discrepancies are expected.** Unexpected files, database/filesystem mismatches, and symlinks must be reported, not treated as a reason that an old project can never be archived. This feature must not attempt the separate, fleet-wide cleanup of historic Komondor data-quality problems.
11. **The S3 data prefix mirrors the logical HPC hierarchy.** Under a configurable bucket/base prefix, retain the path relative to `DATASTORE_ROOT` (normally group/project/sample/run/etc.). Resolve and store the project’s destination prefix at migration time; never recompute an archived URI from names that may later change.
12. **Show location, do not offer retrieval.** The website should display and allow copying a canonical `s3://...` location. An AWS-console link is not required for v1.
13. **The application is storage-class agnostic.** Let bucket configuration/lifecycle policy move data objects to the selected cold archival class, preferably after the manual verification/deletion window. Do not make application behavior depend on Glacier/Deep Archive class names. Record an observed class in the manifest only if useful. Small control manifests needed for status, resume, deletion approval, and audit must remain immediately readable and be excluded from a deep-archive lifecycle that would require restoration.
14. **Dry-run first.** Planning is read-only. Every command capable of changing MongoDB or S3 requires an explicit `--execute` flag and clear operator identity.
15. **Do not rewrite existing file records.** Keep `File.path` in its existing datastore-root-relative logical convention (current values commonly carry a leading `/`) and preserve legacy `Read.destinationMd5` and related history. Do not add per-Read/per-File S3 keys or checksum fields in v1; a project manifest must cover Reads, AdditionalFiles, and untracked content consistently.
16. **All four repositories change.** `komondor-api`, `komondor-web`, `komondor-power`, and `komondor-nudge` must have explicit compatibility work and tests.
17. **S3 archival does not mean ENA release.** `komondor-nudge` must continue to use `nudgeable` and its existing publication logic. AWS/migrating projects are not silently excluded from nudges merely because their storage changed.

## Important corrections to the earlier proposal

Confirm these in the current code and reflect the corrected facts in the final spec:

- Project, Sample, and Run paths are computed during validation, but their directories are created by post-save hooks, not `pre("validate")`. Guards still need to run before any `.save()` that could trigger those hooks. Starting points: `models/Project.js`, `models/Sample.js`, and `models/Run.js`.
- The Read post-save hook is not the only active movement path. Current ingest code can move files first and save with hook suppression; AdditionalFile has analogous behavior. Inspect `models/Read.js`, `models/AdditionalFile.js`, `lib/file-utils.js`, and `lib/ingest-queue.js`.
- Scheduled MD5 work selects completed runs whose verification is still pending, and ingest can invoke verification directly. More importantly, project, sample, and run detail requests perform live filesystem reconciliation. Archival therefore needs route, worker, and read-path behavior—not merely a flag that old completed rows happen not to revisit.
- `GET` detail handlers currently scan `DATASTORE_ROOT` and can turn missing HPC files into mismatch results. Inspect `routes/projects.js`, `routes/samples.js`, `routes/runs.js`, and `routes/_utils.js`. Non-HPC states must skip normal HPC reconciliation explicitly and return an unambiguous “not applicable because of project storage state” result rather than an empty list or false mismatch.
- `routes/accessions.js` currently constructs local paths with `READS_ROOT_PATH`. `File.path` already contains the logical group/project hierarchy, so naïvely appending it to a project-level `s3Uri` can duplicate path segments.
- Project list responses naturally carry Project fields, but sample, run, search, hand-built status, and some detail shapes do not consistently expose ancestor Project storage. Inspect all response builders. Do not denormalise mutable state onto Sample or Run just to solve response shaping, and do not turn an existing relationship ID into an object as an accidental breaking change.
- There is no standalone “attach an additional file to an existing project” API route. Additional files travel inside the existing project/sample/run create and run-reingest workflows. Generic TUS uploads are unassociated staging data until attachment; do not invent a project-aware TUS preflight or scan `HPC_TRANSFER_DIRECTORY`.
- The earlier assertion that `komondor-power` retries HTTP 409 was wrong. Its API client retries network/timeouts and selected transient statuses, but 409 is already terminal. Preserve that behavior and add regression coverage; the required change is early, friendly storage-state validation and correct terminal/partial-upload advice.
- `komondor-nudge` directly reads the shared Project collection and `$push`es `nudges`. An additive field probably would not break that write, but the repository still needs an explicit read-only schema declaration, documentation, and compatibility tests because it is a direct database consumer.
- `aws-sdk` v2 was deliberately removed. A CLI-based mover may use an installed AWS CLI v2 without adding an S3 client to the API runtime. If one small checksum-only package is required, name and justify it separately; do not casually restore `aws-sdk` v2.
- ETag is not a whole-file MD5 for multipart uploads. Likewise, copying `Read.destinationMd5` into S3 user metadata proves only that metadata survived and omits AdditionalFiles and untracked files. It is not archive verification.
- AWS multipart SHA-256 may be composite, so do not compare it blindly with ordinary `SHA256(localFile)`. The design must use checksum semantics that are correct for large multipart objects and prove them with a real-S3 test above the configured multipart threshold.

Useful current-code starting points include:

- `lib/background-jobs.js`, `lib/md5-verification.js`, `lib/ingest-queue.js`, `lib/active-transfers.js`
- `lib/utils/safePath.js`, `lib/utils/md5.js`, `lib/file-utils.js`
- `models/Project.js`, `models/Sample.js`, `models/Run.js`, `models/Read.js`, `models/AdditionalFile.js`, `models/IngestJob.js`
- `routes/projects.js`, `routes/samples.js`, `routes/runs.js`, `routes/accessions.js`, `routes/search.js`, `routes/_utils.js`
- `openapi.yaml`, `BREAKING_CHANGES.md`, `docs/CONTRACTS.md`, existing script patterns such as `scripts/inspect-ingest-backlog.js`
- `../komondor-web/pages/project.vue`, `pages/sample.vue`, `pages/run.vue`, the new/clone forms, `components/ReadList.vue`, `components/AdditionalFileList.vue`, and the Project/Sample/Run cards
- `../komondor-power/server/services/csvOrchestrator/validateMetadata/validateMultipleEntriesAgainstSchema/validatePreExistingEntities.ts`, `server/services/csvOrchestrator/insertMetadata.ts`, `server/utils/komondorApiClient.ts`, `server/utils/komondorApiErrorMessage.ts`, `server/utils/entryProcessor.ts`, tests, and `docs/CSV_UPLOAD_WORKFLOW.md`
- `../komondor-nudge/models.js`, `checkNudgeUpdates.js`, `audit-nudges.js`, test-world fixtures, tests, and `README.md`

## Required lifecycle and invariants

Use one Project-owned storage lifecycle as the source of truth. The recommended public state machine is:

```text
hpc
  └─ atomic migration lock ─> migrating
                                  └─ complete S3 verification ─> aws_pending_hpc_deletion
                                                                        └─ exact root is ENOENT ─> aws
```

Define these semantics precisely:

- `hpc`: the normal legacy state; HPC data writes and reconciliation are allowed.
- `migrating`: the project is locked while it is inventoried, copied, or recovered from a failed attempt. HPC remains the authoritative source until S3 verification completes, but new storage-bearing writes and ordinary background/UI reconciliation are forbidden so that source can remain stable.
- `aws_pending_hpc_deletion`: S3 contains a completely verified archive and is authoritative, while the deliberately retained HPC copy awaits manual deletion. Normal application-level HPC reconciliation and MD5 work are no longer applicable. Storage-bearing writes remain forbidden.
- `aws`: S3 is authoritative and the exact HPC project root has been verified absent. Storage-bearing writes remain forbidden.

A failed attempt remains durably locked as `migrating` with an explicit failed phase/error until it is safely resumed or handled through a narrowly specified recovery procedure. Do not fall back to `hpc` automatically after any S3 object may have been written.

The migration lock must be an atomic compare-and-set from the expected prior state. All subsequent database transitions must be fenced by project ID plus migration ID plus expected state/phase. Do not use `project.save()` from the mover if doing so could invoke directory-creation hooks; use targeted conditional updates.

Legacy Project documents with no storage field must behave as `hpc` in API serialization **and in database predicates**. Mongoose defaults alone do not make exact Mongo queries include missing fields. Specify whether a backfill is needed and how rolling deployment remains safe.

Missing legacy state is the only writable fallback. An explicit unknown state, invalid state/field combination, or missing required S3 evidence must fail closed for storage writes and surface an operator-visible integrity error; it must never be silently normalised to `hpc`.

Separate the safe public storage summary from CLI-only operational state. A stored shape along these lines is a useful starting point:

```js
storage: {
  state,                       // lifecycle enum above
  s3Uri,                       // immutable project data prefix
  s3VerifiedAt,
  hpcVerifiedAbsentAt,
  archivedAt
},
archiveMigration: {            // operator/CLI only; never serialize wholesale
  movedBy,
  id,
  phase,
  startedAt,
  updatedAt,
  lastError,
  manifests: {
    sourceS3Uri,
    sourceSha256,
    verificationS3Uri,
    verificationSha256,
    version,
    fileCount,
    totalBytes
  }
}
```

Choose exact names, visibility controls, and nullability in the spec; do not copy this sketch without resolving timestamp semantics. A bounded embedded migration summary is preferred for lean v1 because a project moves once. If current code provides a compelling reason for a separate migration collection, explain it. Never put the potentially huge per-entry manifest in MongoDB: store immutable, versioned source and verification documents in a dedicated, immediately readable S3 control location and retain only their pointers, digests, counts, and current operational summary on Project.

Current Project routes often serialize Mongoose documents directly. The final design must introduce an explicit sanitized public projection/serializer: Project responses expose only the safe `storage` summary plus derived fields; descendant responses expose the same safe summary as `projectStorage` or the exact chosen additive contract. Migration ID, operator identity, manifest control URIs/digests, phase internals, and `lastError` are CLI/admin-log data and must not leak through ordinary API responses.

Expose derived `acceptsHpcWrites` and `authoritativeLocation` values, or equivalently unambiguous public rules, so clients do not independently guess which lifecycle phases are writable or which URI is effective. If the web must distinguish an active migration from one needing intervention, expose only a safe derived health enum such as `migrationHealth: "active" | "needs_attention"` (optionally admin-scoped), never `lastError` or operator/control-manifest details. Every state other than `hpc` is storage-read-only; the authoritative location changes from HPC to S3 only at `aws_pending_hpc_deletion`.

Distinguish storage-bearing data writes from unrelated metadata. The spec must explicitly enumerate what is forbidden and what remains allowed. For example, ENA accession and nudge metadata may remain editable because they do not recreate archived data, while sample/run creation, reingest, file attachment, and ingest-worker moves must be blocked.

## Migration CLI and runbook requirements

Specify one Node entry point in `scripts/`, with a command interface close to:

```text
node scripts/move-project-to-s3.js plan \
  --project-id <ObjectId>

node scripts/move-project-to-s3.js copy \
  --project-id <ObjectId> \
  --moved-by <operator> \
  [--acknowledge-known-anomalies] \
  --execute

node scripts/move-project-to-s3.js status \
  --project-id <ObjectId>

node scripts/move-project-to-s3.js resume \
  --project-id <ObjectId> \
  --migration-id <migration-id> \
  --resumed-by <operator> \
  --execute

node scripts/move-project-to-s3.js abort-before-copy \
  --project-id <ObjectId> \
  --aborted-by <operator> \
  --execute

node scripts/move-project-to-s3.js deletion-command \
  --project-id <ObjectId>

node scripts/move-project-to-s3.js confirm-absent \
  --project-id <ObjectId> \
  --confirmed-by <operator> \
  --execute
```

You may refine command names, but preserve the separation and safety properties. `resume` must be explicitly fenced to the currently stored migration ID and original source-manifest digest; it must never adopt a new source baseline silently. Include a tightly constrained pre-copy abort so a race discovered after locking does not deadlock the project: it may return to `hpc` only while the migration is still in a pre-copy phase and a fresh check proves that this migration owns no completed objects, control manifest, or incomplete multipart upload. Once copy has begun, recovery is resume/repair rather than automatic unlock. There must be no unrestricted “set state” escape hatch.

The runbook must cover all of the following.

### Configuration and identity

- A required setting such as `AWS_ARCHIVE_S3_ROOT=s3://bucket[/base-prefix]`.
- An expected AWS account ID and preflight using the caller identity, so a typo or wrong credential cannot archive into an unintended account.
- AWS CLI v2 presence and minimum checksum capability, credentials, bucket/prefix access, required `HeadObject`/checksum permissions, encryption/KMS implications, and failure messages.
- Bucket lifecycle/configuration for aborting stale incomplete multipart uploads as well as eventual cold-tier transition; status/recovery must make any upload owned by the migration visible to the operator.
- A lifecycle exclusion that keeps the small source/verification control manifests immediately readable even after data objects enter a cold archival tier.
- The source root and destination prefix are always derived from database/configuration values, never accepted as arbitrary paths from the operator.
- The project ObjectId is the unambiguous CLI selector. Store the resolved source path and destination URI immutably when taking the lock.
- `--moved-by`/`--confirmed-by` are audit identities, not authentication. Define the real authority boundary as access to the production host, scoped MongoDB credentials, and scoped AWS role; validate/record the named Komondor user and effective OS/AWS identities where feasible.
- Every child process is invoked with an argument array (`spawn`/`execFile`), never an interpolated shell command.
- Do not use `aws s3 sync --delete` or any behavior capable of deleting remote objects.

### Lock, active-work preflight, and races

There may be an initial read-only plan, but a database flag plus a post-lock rescan is not by itself an atomic interlock with the current multi-query create/reingest flows. For lean v1, require a short, documented maintenance/quiescence window for the lock transition: gracefully stop every API instance and ingest/MD5 worker that can perform a storage write, confirm active requests/jobs have drained, atomically set `migrating`, repeat preflight, and restart only the already-deployed guard-aware release. The long inventory/copy may then run while the guarded website/API is available, with storage-bearing operations read-only for that project. Durable per-project write leases may replace this maintenance window in a later automation phase, but do not claim that “check state, then later save” is race-free.

Hard blockers should be limited to conditions that mean data can still change or cannot be copied safely, such as:

- a related Run is actively pending/processing;
- a related IngestJob is pending/claimed (inspect its actual relation chain; it may identify only a Run);
- checksum verification is currently in progress;
- a recognised active/incomplete internal transfer artifact such as `.part-<FileId>` is present;
- the canonical project root cannot be proven to lie beneath `DATASTORE_ROOT`;
- AWS identity/prefix checks fail; or
- the destination contains foreign/conflicting objects not owned by the same migration.

Do not make all historical runs, ingest jobs, or MD5 rows “green” as a blanket precondition. Old failed/error/pending verification states, missing legacy MD5s, `md5Mismatch`, and database/filesystem differences must be reported. Serious known anomalies may require `--acknowledge-known-anomalies`, recorded with operator and manifest, but they must not make historic projects permanently unarchivable.

The script cannot rely on another API process’s in-memory active-transfer registry. Specify the quiescence procedure, route guards, synchronous AdditionalFile paths, ingest-worker guards, MD5-worker guards, job checks, and a final source-tree comparison. Explain how a worker that encounters a newly locked project remains recoverable rather than writing into it. Generic, unattached TUS staging uploads do not block a project migration.

### Complete inventory and audit overlay

Walk the exact canonical project tree recursively. Do not reuse a shallow UI helper if it omits hidden files, and do not invoke a helper that moves/unlinks files.

Inventory is not a filesystem snapshot by magic: stat each entry before and after streaming its hashes, then repeat the tree-entry comparison before sealing the source manifest. Compare identity, size, modification/change time, and content as appropriate, but exclude access time because hashing itself may update it. Any addition, removal, replacement, or relevant metadata/content change during that window must make the operator rerun rather than sealing an internally inconsistent baseline.

The versioned manifest must account for:

- every in-scope regular file, including hidden and untracked files;
- logical path relative to the project root and the resulting S3 key;
- entry type, size, relevant filesystem metadata, streaming SHA-256, and the chosen upload-verification checksum;
- matching Read/AdditionalFile/database references where present;
- expected database entries absent from disk;
- filesystem entries absent from the database;
- historical checksum/status anomalies;
- symlink path, target/provenance, and disposition;
- hard-link identity and the disposition of non-regular entries such as sockets, FIFOs, and devices;
- aggregate entry count and byte count; and
- the migration ID, project ID, source-root snapshot, destination prefix, actor, timestamps, tool/manifest version, and anomaly acknowledgement.

Mere presence of an untracked file, symlink, hard link, or other unexpected entry is a warning, not a blocker. Copy every readable regular file physically present in the exact project tree; archive a hard-linked file under each logical key while recording its shared inode identity. For lean v1, inventory with `lstat` and **never follow or dereference symlinks**. Record each link path and raw target in the manifest and skip it with a prominent non-blocking warning. Do not reuse inbound-staging `ALLOWED_LINK_ROOTS` to escape the project root, and never inspect a link target in `HPC_TRANSFER_DIRECTORY`. Record and skip sockets, FIFOs, devices, and other non-regular special entries as non-blocking warnings. A genuine I/O, upload, or verification failure for regular-file bytes must never be silently reported as success: resolve it, or require an explicit per-entry operator exclusion with reason in the sealed manifest. Do not let a blanket anomaly flag hide uncopied regular-file data.

Record directories/symlinks in the manifest when useful for future manual reconstruction; S3 data objects represent file bytes and do not natively preserve POSIX symlinks or empty directories.

### S3 keying, copy, resume, and verification

The data key for each manifest entry is the immutable project S3 prefix plus its path relative to the exact project root, using `/` URI separators. Do not use filesystem `path.join` to build `s3://` URIs.

Use an isolated prefix, identify objects with project and migration IDs for ownership, and refuse to overwrite an object that does not verify as belonging to the same migration. Data keys must remain exactly under the agreed mirrored `base/group/project/...` hierarchy; the migration ID belongs in object metadata/tags and the separate control-manifest key, not as an extra directory in the visible data prefix. Resume at **file granularity**: re-HEAD and skip an already completed object only after its key, size, and checksum verify. A mismatched object may be replaced only when immutable ownership metadata proves it belongs to the same project, migration ID, and source-manifest entry; foreign or ambiguous objects are never overwritten. State plainly that a failed multipart file restarts from byte zero in lean v1; true mid-file multipart resume is future automation.

Resumability needs a durable original source snapshot. After the post-lock inventory succeeds but before the first data upload, serialize the immutable source manifest to the dedicated S3 control prefix, record its exact-byte digest/pointer conditionally on Project, and treat that as the boundary after which automatic abort is forbidden. A rerun must load and verify that original manifest rather than silently inventing a new baseline from a changed source tree. The status command must also be able to recover the migration record if the S3 control write succeeded immediately before a MongoDB update failed.

Do not validate a pathname and then let a child process reopen it later. For lean v1, have Node `lstat`/open each regular file with `O_NOFOLLOW`, `fstat` the descriptor against the sealed source-manifest identity, stream that pinned descriptor to `aws s3 cp -` with the exact expected size where required, compute the local verification checksum over the same byte stream, and `fstat` again afterwards. The AWS CLI invocation must not follow a path that can be swapped to a symlink between validation and upload. If the installed CLI cannot meet the streaming/checksum/large-object contract, the spec must choose and validate an equally strong read-only filesystem snapshot mechanism rather than weakening the guarantee.

Prefer explicit per-manifest-file AWS CLI v2 uploads rather than a blind broad `sync`. The checksum design must work for files large enough to trigger multipart upload. A reasonable baseline to validate is:

- retain an ordinary streaming SHA-256 for every file in the durable manifest as its cryptographic identity;
- upload with a full-object checksum algorithm whose multipart semantics allow a direct whole-file comparison, with CRC64NVME the current preferred candidate;
- independently compute the local upload-verification checksum;
- request stored checksums using `head-object --checksum-mode ENABLED` or an equally precise operation;
- require exact key, content length, full-object checksum type, and checksum equality;
- list the destination and require the data-object key set to equal the regular-file manifest key set, excluding the separately defined control manifest location; and
- repeat the local tree comparison after upload so added, removed, or changed source content prevents the verified transition.

Do not use ETag, caller-supplied user metadata, or legacy Read MD5 as proof of object integrity. If CRC64NVME needs a small official checksum utility package, the spec must name it, distinguish it from an S3 client dependency, and require a fixture/known-vector test. The final design must also include a real-S3 acceptance test whose file crosses the actual multipart threshold; mocked `HeadObject` tests are not sufficient to validate checksum assumptions.

Validate this part against current official AWS documentation, especially [S3 upload integrity and full/composite checksum types](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html), the [AWS CLI S3 checksum FAQ](https://docs.aws.amazon.com/cli/latest/topic/s3-faq.html), [`head-object` checksum behavior](https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html), and [AWS SDK/tool data-integrity defaults](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html). Do not rely on the prose in this prompt if installed CLI behavior or current primary documentation differs; record the verified version/capability in the spec and smoke test.

Write a final immutable verification report to its dedicated S3 control key. It must reference the original source-manifest digest, record every object result and the final source comparison, and itself be content-hashed. Conditionally transition the Project to `aws_pending_hpc_deletion` only after every required object and the complete key set verify. No failure path may set that state or make a deletion command available.

Define an operator-reviewed recovery for an irrecoverable partial attempt (for example, damaged control state or a source that can no longer match its sealed manifest). The production mover must not gain a broad S3 delete switch: status must enumerate exact migration-owned objects/incomplete uploads, cleanup must be a separately reviewed manual action, and any restart must conditionally prove the old migration prefix/control state is clean before assigning a new migration ID. Never strand the Project with “edit Mongo by hand” as the only recovery.

### Manual deletion and absence confirmation

`deletion-command` is available only in `aws_pending_hpc_deletion`. Before printing anything, it must reverify the S3 archive against the immutable manifest and confirm the current HPC tree still matches the locked source manifest. It must validate path containment and reject root-like, traversal, mismatched, changed, or unresolved targets.

If the retained HPC tree drifted after S3 verification, keep the project in `aws_pending_hpc_deletion`, print the exact diff, and refuse deletion. Lean v1 does not silently amend the verified archive. The runbook must require a human to preserve and resolve the drift separately, then restore the secondary HPC tree to the sealed manifest (including manual S3 restoration if something was removed) before retrying. A later version may support a reviewed supplemental-manifest workflow.

It prints—but never executes—one fully resolved, shell-quoted command targeting only the exact project root beneath `DATASTORE_ROOT`. The specification should show an illustrative command while making clear that implementation must generate and test the quoting.

After the human runs that command, `confirm-absent` must use `lstat` on the exact project root. Only `ENOENT` passes; an empty directory, partial tree, broken symlink, permission error, or any other result counts as present/error. A conditional database update records `hpcVerifiedAbsentAt`, `archivedAt`, confirming actor, and final state `aws`. The CLI must explain how to retry safely after partial manual deletion.

## `komondor-api` behavior and contract

The spec must define the exact stored schema, derived public storage summary, endpoint response shape, machine-readable errors, and every affected route/worker.

At minimum:

- Project remains the only database source of storage truth. Sample and Run responses derive the ancestor project summary efficiently; avoid per-row queries and avoid stored duplication.
- Project responses expose storage directly. Sample/Run/search/status responses receive an additive, consistently named summary such as `projectStorage` if their existing relationship fields cannot safely carry it. Preserve existing relationship shapes.
- The public summary exposes lifecycle state, S3 URI when available, relevant timestamps, and an unambiguous “accepts HPC writes” signal. Do not expose internal errors or operator-only detail unnecessarily.
- Authorise and resolve the real project first, then reject every storage-bearing write for any state other than `hpc` with HTTP 409 and one stable machine code, recommended `PROJECT_STORAGE_READ_ONLY`. Preserve the existing error fields Power consumes and make the additive envelope exact—for example `{ error, detail, requestId, code: "PROJECT_STORAGE_READ_ONLY", projectId, storageState }`. Add `code` and the new fields to the shared OpenAPI error schema, and produce the shape through a shared error helper rather than ad hoc route bodies. Clients must key off the code/writeability signal, not prose.
- The 409 must occur before idempotent-existing-result branches, `.save()`, directory creation, queueing, or attachment side effects. Repeated requests therefore remain terminal after a lock rather than returning an old 200.
- Cover `POST /samples/new`, `POST /runs/new`, run reingest, the embedded AdditionalFile flows, and any other storage-bearing route found during inspection. Do not invent a standalone attach route that does not exist.
- Recheck the Project state in ingest/file-move workers as well as at HTTP entry. Define recoverable handling for a job that was accepted just before the lock.
- Scheduled and direct MD5 verification must not touch `DATASTORE_ROOT` for `migrating`, `aws_pending_hpc_deletion`, or `aws` projects. Preserve historical checksum facts; expose a derived “not applicable for current storage” reason rather than rewriting old verification history.
- Project/sample/run detail handlers must not perform ordinary live HPC reconciliation in non-HPC states. They must still return DB-backed Read/AdditionalFile records so archived content does not disappear from the UI, together with explicit reconciliation applicability/state.
- Treat the accessions CSV as an explicit product-contract decision, not a mechanical path substitution. The recommended v1 is to preserve its current columns and emit the effective authoritative URI in `list_of_read_files`: local paths for `hpc`/`migrating`, correctly derived `s3://` URIs for `aws_pending_hpc_deletion`/`aws`, without duplicating group/project segments. This deliberately introduces mixed URI schemes and may affect external ENA tooling even though no in-repo consumer was found. Put that choice prominently in the decision log for George’s sign-off; if inspection finds a real consumer that requires POSIX paths, propose a backward-compatible/versioned alternative rather than silently adding columns, blanking values, or emitting nonexistent HPC paths. Test the final agreed behavior across mixed lifecycle rows.
- S3 URIs are derived from the immutable stored project prefix plus paths relative to the project root. Centralise this logic and never recompute the prefix from current mutable names.
- Update `openapi.yaml`, `BREAKING_CHANGES.md`, `docs/CONTRACTS.md`, environment/configuration documentation, and an operator runbook. Existing contract-drift tests must continue to pass.

Also state explicitly which metadata-only updates remain legal. Do not accidentally make `Project` wholly immutable merely because its data storage is read-only.

## `komondor-web` behavior

Specify the exact web surfaces and shared behavior rather than only the three detail titles.

Use these labels unless the existing design system strongly suggests a clearer equivalent:

| State                      | User-facing treatment                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `hpc`                      | Existing behavior; no extra badge required                                                                                    |
| `migrating`                | “Moving to AWS” badge; if the safe derived health is `needs_attention`, an admin-visible “AWS move needs attention” treatment |
| `aws_pending_hpc_deletion` | “Copied to AWS · HPC cleanup pending” badge                                                                                   |
| `aws`                      | “Archived in AWS” badge                                                                                                       |

The state must be visible on Project, Sample, and Run detail pages and on their shared cards/list/search surfaces where those records appear. Use one shared badge/presentation component rather than reproducing state logic.

For every state other than `hpc`:

- hide or disable new-sample, new-run, clone, reingest, and storage-bearing upload/attach actions with concise explanatory copy;
- guard direct form navigation and submission as well as hiding buttons, while treating API 409 as authoritative for races;
- display/copy API-provided effective authoritative locations rather than concatenating `/tsl/data/reads` in Vue: HPC remains effective during `migrating`, while `aws_pending_hpc_deletion` and `aws` use S3. The planned immutable S3 project destination may be shown separately during migration, clearly labelled as not yet verified;
- update both `ReadList.vue` and `AdditionalFileList.vue` so archived database records remain visible and do not claim that files are missing from HPC;
- label old MD5 information as historical (for example, “Verified before archive”) and show current HPC reconciliation as not applicable;
- stop run-page MD5/filesystem polling that no longer applies; and
- do not render download, browse, restore, presigned-link, or AWS-console actions.

Inventory home/sidebar/search/admin/export/help surfaces and list every file that needs an update. The API should provide already-correct effective URIs; the browser should not duplicate S3 path arithmetic.

## `komondor-power` compatibility

Power’s change is both proactive UX and race-safe interpretation; it is not the enforcement boundary.

Specify:

- additive TypeScript types for the public Project storage summary and the Project storage available through pre-existing Sample lookup;
- early validation in `validatePreExistingEntities` after permission checks, so an existing project or sample whose project reports `acceptsHpcWrites === false` fails the whole CSV before any creates are attempted. Treat a wholly absent legacy storage summary as writable/HPC during rolling deployment, but fail closed on an unknown state or a contradictory state/writeability pair;
- no new storage column in Power’s upload CSV—archive state is an administrative lifecycle fact, not user input;
- API-side 409 remains authoritative if the project locks after Power’s preflight;
- preserve the existing rule that 409 is not retried and add a regression test proving one attempt;
- parse the stable machine error code and replace/suppress the current blanket “same CSV is safe to resubmit” advice for storage-read-only partial failures; instead explain that it is terminal, stop subsequent creates and run-status polling for that entry/workflow, and report any entity IDs that were already created so the operator can review them; and
- update `docs/CSV_UPLOAD_WORKFLOW.md` and relevant unit tests.

Cover both “pre-existing project” and “pre-existing sample” paths, including AdditionalFiles embedded in the same create payloads. Do not add a fictitious separate upload route.

## `komondor-nudge` compatibility

Specify a small explicit compatibility change while preserving the product meaning of nudges:

- declare the agreed Project storage summary as read-only in nudge’s Mongoose model, with no default that could be written back to legacy documents;
- preserve storage fields in test-world fixtures;
- continue to assess and nudge due `migrating`, pending-deletion, and `aws` projects according to the existing ENA/publication and `nudgeable` rules;
- prove that `nudgeable: false` still suppresses a moved project;
- prove that the existing `$push` to `nudges` does not remove or overwrite storage;
- document that internal S3 archival is independent of ENA release; and
- optionally show storage state in the operator audit command if useful, but do not add a new skip reason, change email copy, or make nudge call the HTTP API.

## Required tests and acceptance criteria

Turn each P0 requirement into concrete Given/When/Then acceptance criteria. At a minimum include:

### Model, API, and race safety

- Legacy missing storage behaves exactly like `hpc`, including Mongo predicates.
- Every non-HPC state blocks each storage-bearing API/worker path before filesystem or queue side effects.
- Authorisation happens before storage details are disclosed.
- The same additive 409 envelope (`error`, `detail`, `requestId`, `code`, `projectId`, and `storageState`) is stable across every guarded endpoint, create, retry, and race path.
- The documented writer-quiescence window plus atomic lock and post-lock preflight prevents an already-authorised synchronous request or queued worker from writing after the source baseline begins.
- Non-HPC detail reads and background jobs make no `DATASTORE_ROOT` reconciliation/hash calls.
- Archived detail responses retain DB-backed Reads and AdditionalFiles and explicitly describe reconciliation as not applicable.
- List/detail/search/status response shapes carry the correct derived project storage without N+1 behavior or relationship-shape breakage.
- Accessions CSV handles mixed HPC and S3 projects and never duplicates the S3 prefix.

### CLI and data integrity

- Dry runs change neither MongoDB nor S3; mutating modes require `--execute` and operator identity.
- Source and destination are derived and containment/expected-account checks fail closed.
- Pre-copy abort can unlock a project only when its fenced phase and a fresh S3/multipart check prove that copying never began; it refuses after any archive write.
- A pathname-to-symlink/replacement race after inventory cannot make the uploader read a different file; descriptor identity and before/after checks fail closed.
- Hidden and untracked regular files are copied and audited.
- An unreadable/unverifiable regular file blocks unless that exact entry has a separately recorded operator exclusion; a blanket anomaly acknowledgement cannot omit bytes.
- Symlinks are detected with `lstat`, never followed in v1, and recorded with their targets as non-blocking audit entries; tests prove no target outside the exact project root is read.
- Active work and incomplete-transfer artifacts block; acknowledged historical anomalies are durably recorded.
- Source additions, removals, or content changes after inventory prevent the verified transition.
- A failed file/object/key-set/manifest verification cannot reach `aws_pending_hpc_deletion` or print a deletion command.
- Existing verified objects resume without upload; conflicting/foreign objects are never overwritten.
- Large multipart objects use full-object checksum semantics rather than ETag or composite-SHA assumptions.
- The original source manifest is durably written and content-hashed before the first data upload; resume reuses it rather than rebasing after a source change.
- The final immutable verification report references that source digest, is stored outside MongoDB, and covers every object/final source result; both control documents remain immediately readable after data cold-tiering.
- The generated deletion command targets exactly one validated project root and the script never executes it.
- Absence confirmation passes only when `lstat(projectRoot)` returns `ENOENT`; partial deletion and empty/recreated roots fail.
- The final transition is conditional and records actor/timestamps.

### Consumers

- Web badges, effective paths, archived file lists, disabled/direct actions, historical MD5 copy, and polling behavior are covered at component/page level.
- Power rejects both pre-existing-project and pre-existing-sample cases for `migrating`, `aws_pending_hpc_deletion`, and `aws`; permits a missing summary and explicit `hpc`; fails closed on unknown/contradictory summaries; and attempts a race-time storage 409 only once.
- A race-time Power storage 409 marks the entry as an error, stops subsequent creates/status polling, reports already-created entity IDs, and never gives blanket “safe to resubmit the same CSV” advice.
- Nudge continues normal eligibility for `migrating`, `aws_pending_hpc_deletion`, and `aws`, still honors `nudgeable: false`, and preserves storage during `$push`.

Include a production-like S3 smoke test using a disposable prefix and at least one object above the real multipart threshold before the first live migration. The test must clean up through a separately reviewed operator action; the production mover itself must not gain delete capability merely for test cleanup.

## Rollout and operational safety

Give an ordered, dependency-aware implementation sequence. The expected direction is:

1. Land the additive Project model/public contract, legacy normalization, guards, worker/read-path behavior, OpenAPI, and API tests first, while all existing projects still behave as HPC.
2. Land nudge’s schema-awareness/regressions and Power’s proactive validation/error handling.
3. Land web response consumption, badges, read-only UX, file-location handling, and polling changes.
4. Land the mover, manifest/checksum implementation, command documentation, and mocked/local tests, but do not run it on production data.
5. Validate AWS identity/IAM/encryption/lifecycle configuration and run the real multipart smoke test.
6. Run `plan` against historically messy candidates, inspect discrepancy reports, then pilot one small non-critical project through copy verification, manual deletion, and absence confirmation.
7. Observe the pilot before scaling to larger projects. Automation, retrieval, and fleet-wide reconciliation remain later projects.

Make this a hard compatibility gate: no Project may leave `hpc` until **every** API, ingest, and MD5-worker instance is running the guard-aware release and the web/Power consumers can interpret its public state. Once any Project is non-HPC, rolling back any writer to an older state-unaware build is prohibited; recovery must roll forward or first return all affected projects through an explicitly safe recovery path.

Include rollback/recovery boundaries for each lifecycle phase. “Change Mongo by hand” is not an adequate normal recovery plan. State which versions can be rolled back safely once any Project leaves `hpc`.

Define useful operational logging and audit data: project/migration IDs, actor, phase, counts/bytes, anomaly summary, checksum/manifest digest, AWS account/bucket/prefix, timings, last error, S3 verification timestamp, deletion-command generation, and HPC absence confirmation. Do not log secrets or presigned credentials.

## Explicit non-goals for v1

- moving a Sample, Run, or individual file independently;
- automated HPC deletion;
- S3 retrieval, restore orchestration, browsing, downloads, or presigned URLs;
- a web/admin control that changes storage state;
- inspecting or cleaning `HPC_TRANSFER_DIRECTORY` or generic TUS staging;
- fixing historic database/filesystem discrepancies or building the fleet-wide audit tool;
- rewriting legacy checksums or file paths;
- denormalising Project state onto child MongoDB documents;
- per-file S3 bookkeeping in Read/File rows;
- a daemon, queue, or fully automated migration service;
- true mid-file multipart resume;
- application-owned storage-class transitions; and
- treating S3 archival as ENA/publication completion.

## Required specification structure

Write `docs/S3_PROJECT_ARCHIVAL_SPEC.md` with these sections:

1. Executive summary
2. Problem statement and current behavior, with verified code citations
3. Goals, non-goals, assumptions, and terminology
4. User/operator stories
5. Decision log and invariants
6. Project data model and exact state-transition table
7. Public API schema, endpoint/worker behavior matrix, and error contract
8. Migration CLI contract and phase-by-phase operational runbook
9. Filesystem inventory, symlink, discrepancy, manifest, S3 key, checksum, and resume design
10. Manual deletion and HPC-absence confirmation
11. `komondor-web` changes and UI-state matrix
12. `komondor-power` changes
13. `komondor-nudge` changes
14. Security, authorisation, path-safety, IAM, and failure handling
15. P0/P1/P2 functional requirements, each with acceptance criteria
16. Test strategy, including real-S3 multipart validation
17. Observability and measurable success criteria
18. Rollout, compatibility, rollback, and ordered implementation slices
19. Risks and mitigations
20. Future work
21. Remaining deployment inputs

Use tables where they materially clarify state transitions, route behavior, or cross-repository responsibilities. Keep P0 to the smallest safe v1 described here; put nice-to-have console linking, automation, restoration, and the broader database/filesystem audit in future work rather than quietly expanding scope.

“Remaining deployment inputs” should contain only values that genuinely must be supplied later, such as the S3 root URI, expected AWS account ID, bucket encryption/IAM/lifecycle setup, operator/grace-period policy, and chosen production host. The unsettled storage class is an operations/configuration input, not a reason to block the spec. Separately flag the recommended mixed-URI accessions CSV semantics for explicit product sign-off if no real consumer evidence settles it. Do not ask again about project granularity, `DATASTORE_ROOT`, manual deletion, retrieval, the CLI location, S3 hierarchy, or whether Power/Nudge change; those are settled above.

Before finishing, run a consistency pass over the document and make sure:

- no state permits a storage write after the migration lock;
- “copied and S3-verified” cannot be confused with “HPC deletion confirmed”;
- no normal web/API read falsely reports archived files missing from HPC;
- no deletion command is available before a fresh S3 verification;
- every actual consumer sees one stable, additive storage contract;
- every claimed route, hook, job, and UI surface is backed by current code evidence; and
- the proposal remains a lean, manually supervised v1 rather than an automated archive platform.
