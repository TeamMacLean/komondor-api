# Gulnara ENA project reassignment

Recorded 30 October 2026. **Pending manual CLI work; no reassignment or file
movement has been performed by this planning work.** George is willing to run
the procedures manually later. The purpose is to gather the samples for
Gulnara's paper into one project for ENA submission, with consistent website,
HPC and eventual S3 locations.

## HPC retention todo — updated 13 November 2026

Keep the four source Projects below on HPC until the independent destination
copies are verified and release is explicitly reviewed/recorded. **Also preserve
`/tsl/data/reads/two_blades/gargy_2019_rnaseq/` on HPC until George explicitly
releases it; no end date was supplied.** Gargy is Project
`5fc012bda3efcb29338b7d58` and is a separate retention request, not part of the
12-sample reassignment. Finishing Gulnara does not release Gargy's hold.

The [current retention register and application requirements](HPC_RETENTION.md)
cover all five exclusions. These remain manual review instructions; no
production database flag, CLI guard or filesystem protection is installed.

## Destination and confirmed scope

Destination: **Xanthoria parietina mycobiont RNAseq**, project
`6ae4ac89a6b876c643741d27`, currently `hpc`.
Its stored path is `/ntalbot/xanthoria_parietina_mycobiont_rnaseq`.
On the archive host's recorded `/mnt/reads` mount, the proposed destination is
`/mnt/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq/`.
Verify that mount and destination before use.

The source workbook `data_for_release.xlsx`, `Sheet1!A1:C13`, specifies 12 samples
and 12 runs. George ran the read-only coverage check in production `komondor` and
supplied its output on 30 October. Each project/name resolved uniquely; each
sample had exactly its listed run. `unexpectedRuns`, `missingOrAmbiguous` and
`invalidReferences` were empty. Repeat this check immediately before execution;
any newly discovered run must be flagged before the move proceeds.

| Source project suffix | Sample | Run |
| --- | --- | --- |
| 21 days | `21X_BMM1_KS` | `S_21XB1` |
| 21 days | `21X_BMM2_KS` | `KS21XB1` |
| 21 days | `21X_BMM3_KS` | `S_21XB3` |
| 42 days | `42X_BMM1_KS` | `S_42XB1` |
| 42 days | `42X_BMM2_KS` | `S_42XB2` |
| 42 days | `42X_BMM3_KS` | `S_42XB3` |
| 2 days | `48X_BMM1_KS` | `KS48XB1` |
| 2 days | `48X_BMM2_KS` | `KS48XB2` |
| 2 days | `48X_BMM3_KS` | `KS48XB3` |
| 9 days | `9X_BMM1_KS` | `KS9XB1` |
| 9 days | `9X_BMM2_KS` | `KS9XB2` |
| 9 days | `9X_BMM3_KS` | `KS9XB3` |

All source names start with `Lichen CoCulture_I `. The apparently unusual
`21X_BMM2_KS` to `KS21XB1` pairing matches both the workbook and production output.
The [scope snapshot](evidence/release-planning-20261030/gulnara-scope.json) retains
the exact sample/run IDs, existing paths, source archive identities and target.
Use those IDs when constructing the eventual commands.

## Source archive state

All four sources were `aws_pending_hpc_deletion`, with archive phase `verified`,
in the supplied production output. All sources, selected samples/runs and the
destination share group `5fc012bda3efcb29338b7cf2` (`ntalbot`).

| Source suffix | Project ID | S3 verification date UTC |
| --- | --- | --- |
| 2 days | `61204424e788b405b6ce6bde` | 27 October 2026 |
| 9 days | `611ff26de788b405b6ce6a4c` | 27 October 2026 |
| 21 days | `5fd1ed55d8dd4a63058cc1c9` | 29 October 2026 |
| 42 days | `5fdb2d62d7661b6ec22a0571` | 27 October 2026 |

S3 is already authoritative for these source projects. The website blocks normal
ingest writes before HPC deletion; ordinary archival is not a backup-only upload.
The pending state means HPC absence has not been confirmed, not proof the files
are still present. The requested per-sample disk check has no result recorded here.

The sources belong to the initial archive selection. The separate
[coverage note](INITIAL_MIGRATION_COVERAGE_2026-10-30.md) records the batch's
47.8% share of all project records. George accepts early S3 uploads and wants
HPC deletion to remain a separate, hands-on decision. This active paper and ENA
request must be considered during that review; no production hold or automated
deletion exclusion has been installed by this note.

## Procedure to prepare for manual execution

1. Recheck project states, complete run coverage, source directories, destination
   collisions and space. Inventory linked reads, sample/run additional files and
   File records, including records beneath the sample paths and references from
   outside the move. Save the affected DB documents and old-to-new path mapping.
2. Independently copy the 12 complete sample directories to the destination and
   verify their contents against the sealed source manifests and DB inventory.
   Include run raw files and sample/run additional files. Source-project-only
   attachments remain with their source project. If HPC originals are absent,
   retrieve the selected S3 objects and verify them first.
3. During a short maintenance window with relevant writers and jobs quiesced,
   update the existing records together: `samples.project`, `samples.path`,
   `runs.path` and associated `files.path`. Runs retain their sample IDs; there is
   no `runs.project` field. Preserve IDs, accessions, other associations and group
   membership. Mongosh does not run Mongoose hooks or move physical files.
4. Check website navigation, all new paths and the ENA export/submission. Keep
   the destination in `hpc` while active ENA work requires that behaviour. Backups
   and old-path copies provide the recovery basis until verification succeeds.
5. Prepare the AWS revision separately so its final layout follows the corrected
   projects. Create and verify the destination archive and any required revised
   source manifests before retiring redundant payload copies. Retain provenance
   linking the old and replacement archives. Exact AWS commands and the handling
   of retained object versions remain to be designed; the current CLI has no
   operation for editing a completed archive in place. Do not reset storage
   fields manually or silently rewrite sealed evidence.

Temporary HPC duplication is deliberate. Preserve the original trees during
the copy; `mv` or hardlink copies change the metadata checked by the existing
archive deletion workflow. Archiving the new project while keeping the old S3
snapshots would also duplicate these samples in S3. Permanent S3 duplication has
not been chosen as the final outcome. Removing old S3 keys invalidates their
existing manifests, so cleanup belongs to the verified AWS revision, not a simple
rename/delete step. Normal archival of the destination will make it S3-authoritative.

Waiting until Tuesday **3 November 2026** was discussed because the rest of the
initial batch was expected to finish then. That date is an estimate, not an
execution appointment: confirm actual completion and ENA timing. These four
source uploads were already verified, so waiting for the whole batch is an
operational convenience. No reminder or future execution has been scheduled.

## Evidence and implementation references

- Planning conversation: `Plan production sample migration`,
  `01a18d95-6c20-7f01-8fe8-21999f9cb0a6`, 30 October 2026.
- [Scope snapshot](evidence/release-planning-20261030/gulnara-scope.json): selected
  fields transcribed from George's production coverage output, with the original
  workbook digest. File inventory and byte verification remain outstanding.
- [Storage state and inherited locations](../../lib/storage-state.js).
- [Sample relationships](../../models/Sample.js), [run relationships](../../models/Run.js),
  [file paths](../../models/File.js) and [additional files](../../models/AdditionalFile.js).
- [Sealed tree checks](../../lib/s3-archive/cli.js) and
  [exact S3 key-set verification](../../lib/s3-archive/upload.js).
- [Archive and retrieval runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md).
