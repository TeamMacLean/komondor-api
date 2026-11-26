# Gulnara reassignment — preflight, execution and outcome

**26 November 2026: reassignment completed; services restored at 13:25:06 UTC.**
All **40 files / 41.43 GB** were independently copied, verified and published to
the existing destination. All **64 reviewed document changes** were applied and
verified with zero divergent records. George's `tsldata` controller independently
verified the graph and copies, then restored all four services and confirmed API
readiness. The live website showed all 12 destination Samples and the correct
representative Sample/Run paths. The scoped ENA review export passed at
**13:25:25 UTC**, containing **12 rows and 24 FASTQs**. It has not been submitted.
A final native verification passed at **13:28:15 UTC**, and a small published
file transferred over SSH to the Mac matched its sealed size and both checksums.
See the [completion receipt](evidence/completion-r3/COMPLETED.json).

The separate **MD5 follow-up also completed on 26 November**: all 24 FASTQs
matched original expected MD5 and sealed SHA-256 values, and seven auxiliary
Reads matched their retained original sidecars. All 31 Read results and 12 Run
statuses were saved and independently verified; all 12 application summaries
pass. See [MD5 completion evidence](evidence/md5-completion-20261126/COMPLETED.json).
George has sent the review email. The technical Gulnara work is done for now,
awaiting her reply/sign-off before separately reviewed cleanup. Keep the ENA
review CSV and all source/destination/staging files; no exclusion is released.
The original r3 database snapshot predates these legitimate checksum updates;
do not rerun the completed reassignment or its old full-database verifier.

During the previous second operator window the old publisher
created one empty directory, but NFS returned UID 11449 (`tsldata`) and mode
`0770` despite `deeks` requesting `0700`. The safety assertion stopped execution
before any child publication or database write. An inspected abort removed only
that new empty directory and preserved its evidence. The original native checks
confirmed all 64 documents unchanged and all 40 files staged; API, Web, Power and
Nudge were restored at **13:12:10.575 UTC**.

The original runtime, prepared BSON plan and abort history remain unchanged.
R3 used a fresh runtime seal and freshly checked BSON plan, then atomically
linked the independently copied staging files to final paths without overwriting
anything. It retains all 40 staging links until separate cleanup review. These
links share the copied inodes and therefore do not consume another 41.43 GB;
original source inodes remain independent. **Do not rerun the completed operation
or the old pack's commands.** All originals and S3 archives remain intact;
no source-preservation instruction was released, and no archive change or ENA
submission occurred. The four source protections are documented manual deletion exclusions, not database
holds: their `preserveOnHpcUntil` values remain null and no dates were added.
See [execution outcomes and seals](EXECUTION.md).

## Confirmed scope

Use the existing destination **Xanthoria parietina mycobiont RNAseq**,
`6ae4ac89a6b876c643741d27`, created on 30 October. Do not create another Project.
Its HPC directory and database sample list were empty at preflight. The selected
12 Samples and 12 Runs now resolve beneath this destination. The four original
**Lichen CoCulture_I** source Projects remain `aws_pending_hpc_deletion` with
their verified archives and original HPC trees preserved.

| Item | Observed result |
| --- | --- |
| Independent copy verified and published | 40 files, **41,432,635,417 bytes** (41.43 GB); all 40 staging links retained |
| File types | 24 FASTQ files and 16 `MD5.txt` files |
| Database associations | 31 Read records and 9 AdditionalFile records |
| Verified document updates | 12 Samples + 12 Runs + 40 Files = **64**, zero divergent |
| Reconciliation identity pins | 16 advanced; 48 established; history preserved |
| Destination sample collisions | None |
| Selected files against sealed evidence | Exact file set, sizes, metadata and database File IDs match |
| Preflight filesystem capacity | Approximately 65.7 TB available then; quotas not established |
| MongoDB topology | Standalone; multi-document transaction unavailable |

The database relationship checks and filesystem checks reported no issues. The
12-sample mapping is retained in the [original scope](../../../evidence/release-planning-20261030/gulnara-scope.json).
The unusual `21X_BMM2_KS` / `KS21XB1` pairing is intentional and unchanged.

Derived review artifacts:

- [Preflight summary](preflight-summary.json): findings, provenance and limitations.
- [Change plan](change-plan.json): exact record identities and proposed field changes.
- [Copy manifest](copy-manifest.json): old/new paths, bytes and sealed checksums.
- [ENA FASTQ preview](ena-fastq-preview.json): the 24 intended sequence files.

## Reviewed execution sequence

The copy, publication, 64 document updates, independent reopening checks, live
navigation checks, scoped ENA export, small-file SSH transfer and final native
verification have completed. No browser HTTP download or actual ENA submission
is claimed. The original step-3 design was safely aborted, then replaced by the
reviewed r3 method. The sequence below records the execution boundaries, not
instructions to repeat the operation.

1. **Repeat the read-only checks immediately before execution.** Refuse identity,
   state, path, file inventory, checksum-evidence or destination changes. Confirm
   usable space and operator permissions, including any quota. Obtain the agreed
   freeze of jobs/scripts writing the selected source or destination trees.
2. **Make independent staged copies of all 40 files.** Use a fresh staging area,
   with no overwriting of existing target paths. Copy complete sample directories,
   including the MD5 sidecars. Never move original directories or use hardlinks
   from original source files. R3's later publication links only the verified,
   independently copied staging inodes.
   Verify both the source bytes and independently read destination bytes using
   SHA-256 and CRC64NVME against the sealed copy manifest. Retain resumable,
   per-file receipts; a partial copy is not ready for database reassignment.
   Keep the verified copies staged until the maintenance window. Keep every
   original source file and all original S3 objects.
3. **Enter a short controlled maintenance window.** George operates services from
   his `tsldata` terminal with the recorded `PM2_HOME=/storage/.pm2`. Confirm API,
   ingest/background workers, direct API clients and relevant external writers
   are quiesced. Recheck the complete graph and filesystem observations against the freshly
   sealed BSON-preserving before-images, then start the digest-pinned change
   journal with the actual execution time.
   Publish only after the destination writers are frozen. This mount rejects
   `RENAME_NOREPLACE` and did not provide the private `0700` ownership requested
   by the original substitute, so that publisher correctly stopped. R3 instead
   creates directories under exact operation receipts and checks their observed
   NFS identity. Each atomic hardlink publishes an independently copied inode
   without overwriting an existing path; original source inodes remain separate.
   Retain all 40 staged links after publication until separate cleanup review.
   Existing paths must never be adopted without matching operation evidence.
   An interrupted link without its final receipt requires a fresh SHA-256 and
   CRC64NVME check before adoption; normal publication reuses the existing byte
   verification and current inode metadata. A directory created before its claim
   receipt is written requires separate inspection, not blind recovery.
4. **Apply the 64 reviewed changes using compare-and-swap checks.** Update
   `samples.project`, the 12 Sample paths, the 12 Run paths and the 40 File paths.
   Runs retain their Sample IDs; there is no `runs.project` field. The executor
   must advance the 16 existing File identity pins through a reviewed migration
   mechanism, preserving the old identities and reconciliation history. The
   reviewed procedure also establishes identity pins on the other 48 affected rows,
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
   newer Runs, its archive-age date remains **30 October 2031 at
   14:41:13.635 UTC**; the live page showed 30 October 2031 after reassignment.

## ENA output result and submission gate

The 31 Read records include **seven `MD5.txt` sidecars**. The current
`routes/accessions.js` export follows those Read associations and would include
them as sequence files. The data preflight therefore does **not** mean the
ordinary ENA export is ready for submission.

For this operation, the [scope-specific CSV](evidence/completion-r3/ena-export-20261126-01/gulnara-ena.csv)
was generated and validated with exactly **24 FASTQ files**, paired to the 12
reviewed Runs. All existing Read/File/AdditionalFile records were preserved;
their classification was not changed. An automatic export fix remains a separate
code change. Its full server path and checksum are in [EXECUTION.md](EXECUTION.md).
Review the CSV with the actual ENA workflow and test consumer access before
submission. Neither the JSON preview nor the generated CSV has been submitted.

On `v1333`, the verified filesystem root is **`/mnt/reads`**. The API's
`DATASTORE_ROOT` uses it. `READS_ROOT_PATH` is unset, so display/consumer paths
default to **`/tsl/data/reads`**, which is absent on this host. George confirmed on 26 November that these are two mounts of the same HPC
storage and that the likely transfer consumer is HPC. The scoped export uses
`/tsl/data/reads`; the VM path list uses `/mnt/reads`. No
production environment change is required. Consumer access remains to be tested
when the ENA transfer is actually run.

## Execution readiness and completed operator window

The copy and BSON-preserving database executors have been built. The isolated
real-Mongo rehearsal using the actual scoped records passed 64 conditional
updates, idempotent adoption, interrupted updates, safe continuation and reversal.
The initial 70-test suite and separate real-Mongo rehearsal passed, but the
earlier copy tests did not establish the mount's ownership/mode semantics.
R3's 75 combined tests and synthetic on-mount rehearsal now cover its replacement
publication method, interrupted-link recovery and refusal of foreign collisions.
The synthetic rehearsal completed at 13:22:12 UTC and removed all its test files;
production payloads were untouched. The earlier controller attempts and their
restoration/abort evidence remain preserved in the original pack.
The separate service controller is operated by George as `tsldata`; it requires
sealed readiness evidence, checks work before stopping services and permits
reopening only after an independent consistent-graph check. An elapsed deadline
alone cannot reopen a partial reassignment. Both earlier windows restored
services. The new r3 readiness, runtime and prepared-plan hashes are recorded in
[EXECUTION.md](EXECUTION.md). Fresh preparation checked the complete unchanged
baseline against the preserved original BSON plan. The controller requires the
old restoration proof, exited prior processes and absent old mutation fences.
George ran the r3 controller, which paused at 13:23:39.566 UTC. The reviewed
runner completed the operation and the controller restored services at
13:25:06.331 UTC only after its independent applied-state check. Service control
remained George's terminal step throughout. No further execution retry is needed.

## Evidence and limits

The initial read-only preflight observations are `database-02.json`, `filesystem-02.json` and
`environment-01.json` in the private Mac evidence directory
`/Users/deeks/.codex/artifacts/gulnara-preflight-20261126/`. Component receipts
record output/script/scope SHA-256 digests. Database/filesystem observations were
made around **11:34 UTC on 26 November** and were not a transaction or filesystem
snapshot. Raw database evidence is retained privately; the linked derived files
contain the review scope. The clean API checkout observed was `550074e`; this
read-only check did not independently establish the process's loaded code head.

Four local sealed source/verification evidence sets were checked against their
recorded digests and identities during that initial preflight. **That preflight
did not rehash payloads or request fresh AWS inventory/objects.** The subsequent
completed copy independently hashed every source and staged destination against
the sealed checksums; its receipts are linked in [execution progress](EXECUTION.md).
No AWS request was needed for this HPC-to-HPC copy. Capacity observations exclude
user/group quotas and later allocations. George confirmed the writer freeze;
live project/sample/run navigation subsequently passed. The copy-path button
showed a success notice, but clipboard bytes could not be read through the
in-app browser. No HTTP download control was exposed in that UI; the small-file
transfer was checked separately over SSH. Actual ENA consumer access remains a
later submission check.

The four source HPC exclusions remain in force. Reassignment does not release
them. A completed archive cannot be edited in place by the existing CLI: design
the destination archive, revised source evidence and eventual duplicate cleanup
separately, retaining provenance and every sealed original. This pack authorizes
no deletion, archive finalization, hold release or ENA submission. See the
[overall Gulnara plan](../../../GULNARA_ENA_REASSIGNMENT_2026-10-30.md).

## Historical read-only preflight commands

These commands record the original pre-change checks. The sealed scope describes
the former source associations, so it is no longer a post-completion status
checker. Use the reviewed r3 verification and completion evidence for the
completed operation. The original runner refuses to overwrite evidence and
writes no server files; always use fresh output names if inspecting its
historical assumptions:

```bash
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component environment --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/environment-review-01.json
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component database --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/database-review-01.json
python3 docs/archive/batches/2026-11-26/gulnara/run-preflight.py --component filesystem --output /Users/deeks/.codex/artifacts/gulnara-preflight-20261126/filesystem-review-01.json
```
