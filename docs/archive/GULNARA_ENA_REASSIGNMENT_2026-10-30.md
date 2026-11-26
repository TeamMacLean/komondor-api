# Gulnara ENA project reassignment

Recorded 30 October; updated 26 November 2026. **The HPC copy and database
reassignment are complete.** The 12 Samples and 12 Runs now resolve under the
existing Xanthoria destination, with all 40 files verified and published. All
four applications were restored at **13:25:06 UTC**. The scoped ENA CSV is
validated but has not been submitted. Original source HPC trees, manual deletion exclusions
and sealed S3 archives remain intact; AWS revision and hold release are separate
future reviews.

## Execution completed — 26 November 2026

The [fresh preflight and execution plan](batches/2026-11-26/gulnara/README.md)
confirmed the 12 Samples and 12 Runs, an initially empty existing destination,
and **40 files / 41,432,635,417 bytes**. Independent copies completed at 12:45
UTC, with every source and separately reread staged copy matching sealed
SHA-256 and CRC64NVME values. After two safely restored attempts, the reviewed
r3 publisher completed on the actual NFS mount and the executor applied all
64 conditional changes with zero divergent records. The controller independently
verified the completed graph and copies before restoring services.

The **64 document updates** affected 12 Samples, 12 Runs and 40 Files, advancing
16 existing identity pins and establishing 48 more while preserving history.
No Project, Read or AdditionalFile document was written. The live website showed
the 12 destination Samples and the correct representative Sample/Run paths.
A published 100-byte MD5 file transferred over SSH to the Mac matched its
sealed size and both checksums; no browser HTTP download was available in the
current UI. Final native verification passed at **13:28:15 UTC**.

The [validated ENA review CSV](batches/2026-11-26/gulnara/evidence/completion-r3/ena-export-20261126-01/gulnara-ena.csv)
contains **12 rows / 24 paired FASTQs**. It excludes seven `MD5.txt` Read entries
only from the output, preserving all 40 files and existing associations. The
native exporter still includes those sidecars; no application export fix or
ENA submission was performed. See the [completion receipt](batches/2026-11-26/gulnara/evidence/completion-r3/COMPLETED.json)
and [execution record](batches/2026-11-26/gulnara/EXECUTION.md) for seals,
checks and both earlier safely restored attempts.

## HPC retention todo — clarified 26 November 2026

Gulnara needs **one destination Project** for longer-term use, under the normal
five-year archive-age policy. The four old source Projects are not five-year
retention requests. Keep their original HPC trees temporarily until independent
copies, reassignment checks and explicit release review are complete. The copy
and reassignment checks have now passed; **release/archive-revision review is
still outstanding**. Editing the sample associations does not itself release or
delete their source trees.

**Gargy is separate:** preserve `/tsl/data/reads/two_blades/gargy_2019_rnaseq/`
(Project `5fc012bda3efcb29338b7d58`) for the one year George told Sara, unless
she asks otherwise. The saved keep date was verified on 26 November as
26 November 2027. Finishing Gulnara does not release Gargy.

The [current retention register and application requirements](HPC_RETENTION.md)
cover the five current exclusions. The application safeguards were reportedly
deployed on 16 November; George confirmed retention functionality on 26 November.
The four Gulnara source exclusions remain manual instructions. Their
`preserveOnHpcUntil` values were null in the baseline and remain unchanged;
no database hold or keep date was added by the reassignment.

## Destination and confirmed scope

Destination: **Xanthoria parietina mycobiont RNAseq**, project
`6ae4ac89a6b876c643741d27`, reused for the completed reassignment and still `hpc`.
No duplicate Project was created. It is outside
the completed 175-Project archive batch. Its normal archive eligibility is the
later Project/newest Run creation date plus five years. After reassignment the
live page showed **30 October 2031** (creation-based timestamp 14:41:13.635 UTC).
No `preserveOnHpcUntil` override was added, and the normal rule does not
automatically populate that field.
Its stored path is `/ntalbot/xanthoria_parietina_mycobiont_rnaseq`.
On v1333's verified `/mnt/reads` mount, the completed destination is
`/mnt/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq/`.
George confirmed this is the same HPC storage exposed as `/tsl/data/reads` to
the likely ENA transfer consumer. Test that consumer's access during submission.

The source workbook `data_for_release.xlsx`, `Sheet1!A1:C13`, specifies 12 samples
and 12 runs. George ran the read-only coverage check in production `komondor` and
supplied its output on 30 October. Each project/name resolved uniquely; each
sample had exactly its listed run. `unexpectedRuns`, `missingOrAmbiguous` and
`invalidReferences` were empty. Fresh checks on 26 November confirmed the exact
scope before execution; the unusual sample/run pairing below was preserved.

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
Those IDs were retained throughout the completed operation.

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
are still present. The 26 November execution checked the source trees and
independently copied all selected files; originals were retained and their
metadata remained unchanged after publication.

The sources belong to the initial archive selection. The separate
[coverage note](INITIAL_MIGRATION_COVERAGE_2026-10-30.md) records the batch's
47.8% share of all project records. George accepts early S3 uploads and wants
HPC deletion to remain a separate, hands-on decision. This active paper and ENA
request must be considered during that review; no production hold or automated
deletion exclusion has been installed by this note.

## Completed procedure and remaining AWS review

Steps 1–3 and the website/scoped-export checks in step 4 completed on 26 November.
Actual ENA consumer access/submission and step 5 remain separate work. Do not
repeat the copy or reassignment; the list records the reviewed boundaries.

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
4. Check website navigation, all new paths and the ENA review export; perform
   the actual submission separately. Keep
   the destination in `hpc` while active ENA work requires that behaviour. Backups
   and old-path copies provide the recovery basis until verification succeeds.
5. Prepare the AWS revision separately so its final layout follows the corrected
   projects. Create and verify the destination archive and any required revised
   source manifests before retiring redundant payload copies. Retain provenance
   linking the old and replacement archives. Exact AWS commands and the handling
   of retained object versions remain to be designed; the current CLI has no
   operation for editing a completed archive in place. Do not reset storage
   fields manually or silently rewrite sealed evidence.

Temporary HPC duplication is deliberate. The original trees remain independent
of the new copied inodes; no original was moved or hardlinked. R3 published
hardlinks **from the already independently copied staging files**, retaining all
40 staging links until separate cleanup review. Staging/final links share each
copied inode, so retaining them does not consume another 41.43 GB of payload
space. Removing either link changes its verification metadata and must not be
done as an unreviewed cleanup. Archiving the new project while keeping the old S3
snapshots would also duplicate these samples in S3. Permanent S3 duplication has
not been chosen as the final outcome. Removing old S3 keys invalidates their
existing manifests, so cleanup belongs to the verified AWS revision, not a simple
rename/delete step. Normal archival of the destination will make it S3-authoritative.

Historically, waiting until Tuesday **3 November 2026** was discussed because the rest of the
initial batch was expected to finish then. That date is an estimate, not an
execution appointment: confirm actual completion and ENA timing. These four
source uploads were already verified, so waiting for the whole batch is an
operational convenience. The actual reassignment was completed on 26 November.
No reminder or future execution has been scheduled.

## Evidence and implementation references

- Planning conversation: `Plan production sample migration`,
  `01a18d95-6c20-7f01-8fe8-21999f9cb0a6`, 30 October 2026.
- [Scope snapshot](evidence/release-planning-20261030/gulnara-scope.json): selected
  fields transcribed from George's production coverage output, with the original
  workbook digest. File inventory, byte verification and reassignment were
  subsequently completed in the linked 26 November execution record.
- [Storage state and inherited locations](../../lib/storage-state.js).
- [Sample relationships](../../models/Sample.js), [run relationships](../../models/Run.js),
  [file paths](../../models/File.js) and [additional files](../../models/AdditionalFile.js).
- [Sealed tree checks](../../lib/s3-archive/cli.js) and
  [exact S3 key-set verification](../../lib/s3-archive/upload.js).
- [Archive and retrieval runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md).
