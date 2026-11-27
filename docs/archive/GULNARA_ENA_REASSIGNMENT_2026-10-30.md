# Gulnara ENA project reassignment

Recorded 30 October; updated 27 November 2026. **Reassignment, MD5 verification,
four source HPC deletions and native database confirmations are complete.**
The old source Projects are now AWS-only. George waived waiting for Gulnara's
reply for source cleanup; no reply or scientific sign-off has been received.
The 12 Samples, 12 Runs and all 40 verified files remain under the existing
Xanthoria HPC destination. Staging links, the ENA review CSV and all S3 archives
remain intact. Do not repeat completed jobs, reassignment or confirmation.
No Gulnara reply, chasing or other action is due for this archival task.
Scientific review, ENA submission, staging/CSV cleanup and any AWS revision are
separate ad-hoc decisions if later requested, not outstanding requirements.
The evidence is published on master and the production documentation was
synced on 27 November; the final read-only checks passed.

## Source deletion completed — 27 November 2026

After being told the reply checkpoint could be waived while fresh checks remain
required, George instructed **“lets do gulnara's 4 now”**. This superseded the
26 November requirement to await a reply for the four source HPC trees only;
it did not imply Gulnara had approved the scientific result.

The four native source/archive checks passed at **14:13:23.753 UTC**:
**452 files / 482,738,413,472 bytes**. Fresh checksum verification of all
40 destination copies passed at **14:20:29.491 UTC**, including 31 stored Read
MD5 values and unchanged post-MD5 records. The exact package passed mounted
source validation and independent review before George submitted job
**25340876**. It completed at **14:25:04 UTC**. The raw logs matched all 14
expected events, the sealed four-target plan and process exit 0; George reported
Slurm `COMPLETED / 0:0` in 32 seconds.

All four source absences and protected destination/staging copies were checked,
then native `confirm-absent` and final database checks completed at
**14:42:13.902 UTC**. All four are `aws` / `completed`, with original S3
verification dates, archive identities and associations unchanged. Live source
pages show HPC removal confirmed / AWS verified; Xanthoria remains on HPC with
12 Samples. No S3 mutation or manual storage-field edit occurred. The all-175
cohort audit at **14:42:35.192 UTC** found 174 AWS-only; Gargy alone remains on
HPC and AWS, held through 26 November 2027. The completed deletion package must
not be resubmitted.
[Execution and evidence](batches/2026-11-27/gulnara-source-deletion/README.md),
[native completion](batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/completed.json).

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
During that reassignment, no Project, Read or AdditionalFile document was
written; the separate MD5 follow-up below subsequently updated checksum/status
fields on 31 Reads and 12 Runs. The live website showed
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

## Earlier sign-off checkpoint and retained material

George confirmed that he sent the review email to Gulnara on **26 November
2026**. At that point her reply was required before the separate source/staging
cleanup review, and nothing was released. His **27 November instruction above
supersedes the reply wait for source-tree deletion only**. It does not claim
Gulnara has replied or approved the result, and it does not authorize staging
or CSV cleanup.

The original source HPC trees were removed on 27 November; their verified AWS
archives are unchanged. Retrieving those archived originals will involve restore
waiting time and charges. The new destination HPC copies remain available and
were unaffected by the source cleanup. Keep all 40 staging links until their own reviewed cleanup;
they share the destination's copied inodes and use no extra 41.43 GB of payload
space. Any link removal changes the recorded inode metadata and must preserve
the destination files and an auditable before/after record.

Retain the working CSV for now; no cleanup or reply-chasing task is due.
Any later cleanup requires an explicit ad-hoc decision. If a working copy is
then removed, preserve the sealed repository CSV, completion receipts, checksum
registers and other execution evidence as the permanent audit record. This
does not authorize changing or removing the S3 archives.

## MD5 follow-up completed — 26 November 2026

The SHA-256/CRC64NVME copy checks did not themselves clear legacy MD5 status.
George authorized a separate verification and reviewed import. The **16
original `MD5.txt` sidecars** matched sealed sizes/SHA-256; their preserved
entries provided unambiguous expected MD5 values for all 24 FASTQs, with
agreeing duplicates and no extra entries.

Fresh hashing completed at **14:24:18.645 UTC**. All **24 FASTQs /
41,432,633,829 bytes** matched both their original expected MD5 values and
sealed SHA-256 values. The seven sidecar files represented as auxiliary Read
records also matched retained original files on distinct inodes by fresh MD5
and sealed SHA-256. The 16 sidecars total 1,588 bytes; the complete published
scope remains 40 files / 41,432,635,417 bytes.

The production import completed at **14:26:15.692 UTC**: **43 exact conditional
writes, comprising 31 Reads and 12 Runs**. A separate verification at
**14:26:39.564 UTC** found all 43 records in the expected after-state, zero
divergent records and no control-record changes; the journal contains 86 events.
Only reviewed checksum/status fields and `updatedAt` changed. No hooks, jobs,
emails, service changes or payload deletion were triggered. See the
[MD5 completion receipt](batches/2026-11-26/gulnara/evidence/md5-completion-20261126/COMPLETED.json).

The technical reassignment and MD5 follow-up are complete. Preserve the review
CSV, new destination HPC copies, staging links and original S3 archives. The
four original HPC source trees were removed by George's manual Slurm submission
and their native database confirmations are complete. Staging/CSV cleanup and
ENA submission remain separate and have not occurred.

## HPC retention — current position after 27 November completion

Gulnara needs **one destination Project** for longer-term use, under the normal
five-year archive-age policy. The four old source Projects are not five-year
retention requests. Their temporary exclusions were released after fresh
source/archive/destination checks and George's waiver of the reply checkpoint.
His separate manual job removed the source trees, and native confirmations
recorded AWS-only status. No source hold or confirmation task remains. Any AWS
revision, staging-link cleanup or CSV cleanup remains outside that completed
source-deletion scope.

**Gargy is separate:** preserve `/tsl/data/reads/two_blades/gargy_2019_rnaseq/`
(Project `5fc012bda3efcb29338b7d58`) for the one year George told Sara, unless
she asks otherwise. The saved keep date of **26 November 2027** was
independently re-read on 27 November at 14:54 UTC, along with Joe Win's eleven
**26 November 2031** dates. Finishing Gulnara does not release those Projects.
All thirteen retained roots, including Xanthoria, were still present after the
separate six Kamoun disposals at 15:21:57 UTC.
[Final retained-root observation](batches/2026-11-27/kamoun-direct-disposal/evidence/job-25342010-observation-01.json).

The [current retention register and application requirements](HPC_RETENTION.md)
record Gargy's active hold and the four sources' completed release. The
application safeguards were reportedly deployed on 16 November; George
confirmed retention functionality on 26 November. The source exclusions were
manual instructions, now superseded by the reviewed deletion above. Their
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

All four sources are now `aws`, with archive phase `completed`, after native
confirmation on 27 November. They were `aws_pending_hpc_deletion` / `verified`
in the earlier production snapshots. All sources, selected samples/runs and the
destination share group `5fc012bda3efcb29338b7cf2` (`ntalbot`).

| Source suffix | Project ID | S3 verification date UTC |
| --- | --- | --- |
| 2 days | `61204424e788b405b6ce6bde` | 27 October 2026 |
| 9 days | `611ff26de788b405b6ce6a4c` | 27 October 2026 |
| 21 days | `5fd1ed55d8dd4a63058cc1c9` | 29 October 2026 |
| 42 days | `5fdb2d62d7661b6ec22a0571` | 27 October 2026 |

S3 remains authoritative for these source Projects. The 26 November execution
independently copied the selected files while retaining source originals and
their metadata. On 27 November George deleted the old source trees after fresh
verification; native confirmation now records their absence. The original S3
verification dates above and sealed archives are unchanged.

The sources belong to the initial archive selection. The historical
[coverage note](INITIAL_MIGRATION_COVERAGE_2026-10-30.md) records that batch's
47.8% share of the then-existing Project records. The October batch and its
verified S3 archives remain unchanged by the **27 November policy**: future
Projects are copied to AWS only after the later of their age-based archive date
and keep date. The archive CLI enforces this at `lock`; an early exception needs
`--before-review-date "<reason>"`. HPC deletion remains George's manual step.
[Current policy](HPC_RETENTION.md#policy-from-27-november-2026-aws-only-after-the-hpc-date-has-passed).

## Completed procedure and boundaries for any future work

Steps 1–3 and the website/scoped-export checks in step 4 completed on 26 November.
The separately reviewed source-tree deletion and native confirmation completed
on 27 November under George's waiver of the reply wait. No follow-up is due
for this archival task. Scientific sign-off, optional staging/working-CSV
cleanup, actual ENA submission and the historical step 5 proposal require their
own future scope if requested. Do not repeat the completed copy or reassignment;
the list below preserves the reviewed procedure and its boundaries.

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
5. If a future AWS revision is requested, design it separately so its final
   layout follows the corrected projects. Apply the current archive-date policy
   to the destination. Create and verify any destination archive and required
   revised source manifests before retiring redundant payload copies. Retain provenance
   linking the old and replacement archives. Exact AWS commands and the handling
   of retained object versions remain to be designed; the current CLI has no
   operation for editing a completed archive in place. Do not reset storage
   fields manually or silently rewrite sealed evidence.

The temporary original/destination HPC duplication was deliberate. The source
originals had independent inodes and were deleted only in the reviewed
27 November job; no original was moved or hardlinked. R3 published
hardlinks **from the already independently copied staging files**, retaining all
40 staging links until separate cleanup review. Staging/final links share each
copied inode, so retaining them does not consume another 41.43 GB of payload
space. Removing either link changes its verification metadata and must not be
done as an unreviewed cleanup. Archiving the new project while keeping the old S3
snapshots would also duplicate these samples in S3. Permanent S3 duplication has
not been chosen as the final outcome. Removing old S3 keys invalidates their
existing manifests, so cleanup belongs to the verified AWS revision, not a simple
rename/delete step. Normal archival of the destination will make it S3-authoritative.

Historically, Tuesday **3 November 2026** was discussed as a possible start
because the bulk transfer was expected to finish then. The actual reassignment
completed on 26 November and the source removal on 27 November. That old estimate
is not an appointment or outstanding task. No reminder, report schedule or
future execution is requested; reviews and optional cleanup are ad hoc.

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
