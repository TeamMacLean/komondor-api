# Gulnara reassignment — read-only preflight and execution plan

**26 November 2026: data preflight passed; execution is not approved or performed.**
This records the scope and a plan for building the execution tooling, not a
tested reassignment executor. No production files, database records, services or
S3 objects were changed by the preflight. No ENA submission was made.

## Confirmed scope

Use the existing destination **Xanthoria parietina mycobiont RNAseq**,
`6ae4ac89a6b876c643741d27`, created on 30 October. Do not create another Project.
Its HPC directory and database sample list were empty at inspection. The selected
12 Samples and 12 Runs still belong to the four **Lichen CoCulture_I** source
Projects; all four remain `aws_pending_hpc_deletion` with verified archives.

| Item | Observed result |
| --- | --- |
| Independent copy required | 40 files, **41,432,635,417 bytes** (41.43 GB) |
| File types | 24 FASTQ files and 16 `MD5.txt` files |
| Database associations | 31 Read records and 9 AdditionalFile records |
| Proposed document updates | 12 Samples + 12 Runs + 40 Files = **64** |
| Existing reconciliation identity pins | **16 File documents** |
| Destination sample collisions | None |
| Selected files against sealed evidence | Exact file set, sizes, metadata and database File IDs match |
| Filesystem capacity | Approximately 65.7 TB available; quotas not established |
| MongoDB topology | Standalone; multi-document transaction unavailable |

The database relationship checks and filesystem checks reported no issues. The
12-sample mapping is retained in the [original scope](../../../evidence/release-planning-20261030/gulnara-scope.json).
The unusual `21X_BMM2_KS` / `KS21XB1` pairing is intentional and unchanged.

Derived review artifacts:

- [Preflight summary](preflight-summary.json): findings, provenance and limitations.
- [Change plan](change-plan.json): exact record identities and proposed field changes.
- [Copy manifest](copy-manifest.json): old/new paths, bytes and sealed checksums.
- [ENA FASTQ preview](ena-fastq-preview.json): the 24 intended sequence files.

## Execution sequence to implement and rehearse

1. **Repeat the read-only checks immediately before execution.** Refuse identity,
   state, path, file inventory, checksum-evidence or destination changes. Confirm
   usable space and operator permissions, including any quota. Obtain the agreed
   freeze of jobs/scripts writing the selected source or destination trees.
2. **Make independent staged copies of all 40 files.** Use a fresh staging area,
   with no overwriting of existing target paths. Copy complete sample directories,
   including the MD5 sidecars. Never move original directories or use hardlinks.
   Verify both the source bytes and independently read destination bytes using
   SHA-256 and CRC64NVME against the sealed copy manifest. Retain resumable,
   per-file receipts; a partial copy is not ready for database reassignment.
   Keep the verified copies staged until the maintenance window. Keep every
   original source file and all original S3 objects.
3. **Enter a short controlled maintenance window.** George operates services from
   his `tsldata` terminal with the recorded `PM2_HOME=/storage/.pm2`. Confirm API,
   ingest/background workers, direct API clients and relevant external writers
   are quiesced. Recheck the complete graph and filesystem observations, then
   capture fresh BSON-preserving before-images and a digest-pinned change journal.
   Publish the verified staged sample directories with atomic no-overwrite
   semantics only after the destination writers are frozen. Moving staging
   directories into place is allowed; moving the originals is not.
4. **Apply the 64 reviewed changes using compare-and-swap checks.** Update
   `samples.project`, the 12 Sample paths, the 12 Run paths and the 40 File paths.
   Runs retain their Sample IDs; there is no `runs.project` field. The executor
   must advance the 16 existing File identity pins through a reviewed migration
   mechanism, preserving the old identities and reconciliation history. The
   proposed policy also establishes identity pins on the other 48 affected rows,
   using the exact post-change identity fields in `change-plan.json`. Append
   correction history for all 64 rows; preserve `createdAt` and unrelated fields.
   Retain dated source-path checksum observations as historical evidence, linked
   to the new copy verification receipt; never rewrite their dates or paths to
   make them appear to describe the new copies.
   Do not disable guards or edit `storage.*` / `archiveMigration.*` by hand.
5. **Verify before reopening services.** Confirm all 64 results, exact file
   resolution beneath the destination, unchanged IDs/accessions/Read and
   AdditionalFile associations, and no unexpected field changes. Preserve
   before/after evidence and the completed journal. Because MongoDB is standalone,
   this is not atomic across all records: on any failure, keep the window closed
   and inspect the journal. Recovery must conditionally finish or roll back only
   records whose current state matches the expected journal state. Never restart
   applications automatically into a partially reassigned graph or blindly retry.
   A reversal restores the previous business fields and active identity while
   appending reversal history; it does not erase the attempted operation or
   delete either copy. A deadline alone must never reopen a partial graph.
6. **Check the application and ENA output.** Confirm project/sample/run navigation,
   inherited HPC locations, access and file download behaviour. Validate the actual
   submission CSV and the paths as seen by its transfer consumer, as detailed below.
   The destination stays `hpc`; its normal five-year archive eligibility is based
   on the later Project/newest Run creation date. No manual keep-date override is
   introduced by this reassignment. With the observed creation dates and no
   newer Runs, its expected archive-age date remains **30 October 2031 at
   14:41:13.635 UTC**. Recompute it after the actual change.

## ENA output gate

The 31 Read records include **seven `MD5.txt` sidecars**. The current
`routes/accessions.js` export follows those Read associations and would include
them as sequence files. The data preflight therefore does **not** mean the
ordinary ENA export is ready for submission.

For this operation, prepare and validate a scope-specific submission file list
containing exactly the **24 FASTQ files**, paired to the 12 reviewed Runs. Preserve
the existing Read/File/AdditionalFile records; do not repair their classification
as an unreviewed side effect. An automatic export fix is a separate code change.
The actual CSV must be inspected and validated against the agreed ENA workflow
before any submission; the JSON FASTQ preview is not a submitted or validated CSV.

On `v1333`, the verified filesystem root is **`/mnt/reads`**. The API's
`DATASTORE_ROOT` uses it. `READS_ROOT_PATH` is unset, so display/consumer paths
default to **`/tsl/data/reads`**, which is absent on this host. Check the actual
consumer's mount before using exported paths; do not assume a v1333 path works
on another machine or silently change production configuration.

## Work required before execution approval

Build the copy/verification executor and BSON-preserving, journalled database
executor, including explicit identity-pin transitions. Rehearse against isolated
fixtures or a restored scoped database: missing files, checksum mismatch, target
collision, concurrent record change, failure after partial writes, safe resume
and conditional rollback. Independently review the exact commands and test
receipts. Prepare the bounded service window, including a failure path that keeps
services paused when the graph is incomplete. Only then present the concrete
execution pack to George; the read-only tools here are not that pack.

## Evidence and limits

The final observations are `database-02.json`, `filesystem-02.json` and
`environment-01.json` in the private Mac evidence directory
`/Users/deeks/.codex/artifacts/gulnara-preflight-20261126/`. Component receipts
record output/script/scope SHA-256 digests. Database/filesystem observations were
made around **11:34 UTC on 26 November** and were not a transaction or filesystem
snapshot. Raw database evidence is retained privately; the linked derived files
contain the review scope. The clean API checkout observed was `550074e`; this
read-only check did not independently establish the process's loaded code head.

Four local sealed source/verification evidence sets were checked against their
recorded digests and identities. **No payload was rehashed and no fresh AWS
inventory/object request was made.** Metadata equality is not fresh content
verification; the planned copy phase supplies that check. Capacity excludes user
or group quotas and later allocations. External writer inactivity, application
behaviour and ENA consumer path access remain execution-time checks.

The four source HPC exclusions remain in force. Reassignment does not release
them. A completed archive cannot be edited in place by the existing CLI: design
the destination archive, revised source evidence and eventual duplicate cleanup
separately, retaining provenance and every sealed original. This pack authorizes
no deletion, archive finalization, hold release or ENA submission. See the
[overall Gulnara plan](../../../GULNARA_ENA_REASSIGNMENT_2026-10-30.md).

## Repeat the read-only preflight

From this API checkout on the Mac, with renewed VPN/SSH access, use fresh local
output names. The runner refuses to overwrite evidence and writes no server files:

```bash
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component environment --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/environment-review-01.json
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component database --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/database-review-01.json
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component filesystem --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/filesystem-review-01.json
```
