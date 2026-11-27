# Archive status — updated 27 November 2026

This is the current position of the HPC-to-S3 archive work. Older plans,
previews and snapshots under `docs/archive/` are historical; where they disagree
with this page, this page and the records it links to win.

**The approved work is complete.** All 175 archive Projects have verified S3
copies; 174 now have their HPC removal confirmed through the native archive
CLI. Gargy is the one original-batch Project still on HPC and AWS, retained
through **26 November 2027**. The six separate Kamoun no-S3 disposals also
completed, with their metadata and history retained. No further disposal or
owner email is due from this batch.

The completion evidence below comes from scoped live checks and execution
receipts on 26–27 November. Deployment heads remain attributed to George's
27 November report; a checkout observation alone does not prove which code a
running process has loaded. This documentation reconciliation performs no new
production operation. Publication is on a review branch pending merge.

## Done

- **Production code, as George reported on 27 November.** API master
  `2474c4a` and web master `a470095` are deployed. Power `d98fab1` and Nudge
  `3791969` are unchanged since 3 November
  ([record](DEPLOYMENT_2026-11-03.md)). Earlier records: the keep-date feature
  ([16 November](DEPLOYMENT_2026-11-16.md)) and the retention follow-up, first
  deployed that evening as API `48bcd53` and web `284f762`
  ([record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md),
  [review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md)).
- **New in the 27 November API deployment.** The archive CLI's `lock` refuses a
  Project not yet due for AWS (see the first standing rule), and the
  per-Project website visibility flag `displayOnSite`
  ([notes](../PROJECT_SITE_VISIBILITY.md)).
- **New in the 27 November web deployment (`a470095`).** Since `284f762` it adds the project-page redesign
  (`6905b26`, `7cc01c7`, `84af546`), retires HPC-only controls once a
  Project's HPC copy is gone and locks accession editing on archived Projects
  (`89cadf1`), and shows "In AWS · verified <date>" on archived file lists in
  place of the arrival MD5 columns (`d29cc35`). Later commits fix nav search
  (`521dbc4`), fold the AWS retention details into a collapsible (`21ac1ba`)
  and move HPC removal details under the HPC status (`a470095`). The deployment
  note records web unit tests and a production build. Separate live archived
  Project observations accompany the execution records below; they do not
  independently identify the loaded web commit.
- **Database reconciliation (22 October).** 22 unregistered directories were
  registered as Projects, then 26,724 operations corrected paths, added
  13,052 File/AdditionalFile pairs, retired two empty Projects and recorded
  original values and history. The 69-operation Project 2178 consolidation
  followed. [Record](batches/2026-10-16/reconciliation-production-2026-10-22/README.md).
  Do not rerun that plan; any later correction needs a fresh preview.
- **Every batch entry has a database outcome.**
  [197-entry outcome table](batches/2026-10-16/reconciliation-production-2026-10-22/OUTCOMES.md):

  | Outcome | Entries |
  | --- | ---: |
  | Archive to S3 | 175 |
  | Manual disposal completed (no S3 copy) | 6 |
  | KEEP on HPC, unchanged | 11 |
  | Empty directory recorded | 2 |
  | Empty Project retired | 2 |
  | Consolidated into an existing Project | 1 |

- **S3 transfer.** All 175 archive Projects (13.45 TB) were uploaded and
  verified by 2 November 20:55 GMT. The
  [completion receipt and three companion files](evidence/transfer-completion-20261103/README.md)
  are now preserved unchanged in the repository, with provenance and checksums.
- **174 HPC removals and native confirmations completed on 27 November.**
  Plant Capture was confirmed at 11:04 UTC, the two-project Slurm test by
  12:59 UTC, the next 167 by 13:44 UTC and Gulnara's four sources by 14:42 UTC.
  Job `25340024` removed the exact 167 reviewed targets in 9m46s; the log audit
  and all native confirmations passed. Job `25340876` removed the four Lichen
  sources (452 files / 482,738,413,472 bytes), with the destination and staging
  copies preserved. The all-175 audit at **14:42:35 UTC** found 174 `aws` /
  `completed` and Gargy still held; archive identities and original S3 transfer
  dates were unchanged. No S3 objects were deleted.
  [167-project completion](batches/2026-11-27/hpc-slurm-two-project-test/README.md),
  [four-source completion](batches/2026-11-27/gulnara-source-deletion/README.md),
  [all-175 audit](batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/cohort-final.json).
- **Gulnara's reassignment and MD5 follow-up completed on 26 November.**
  The existing destination `6ae4ac89a6b876c643741d27` now has the 12 Samples,
  12 Runs and 40 verified files / 41,432,635,417 bytes. The 64 association/path
  changes and subsequent 43 checksum/status changes passed independent checks.
  George sent the review email, then waived the reply wait for source deletion
  on 27 November. There has been no scientific sign-off or ENA submission.
  The destination, 40 staging links, working ENA CSV and all S3 archives remain;
  no Gulnara follow-up or chasing task is due.
  [Execution](batches/2026-11-26/gulnara/EXECUTION.md),
  [MD5 receipt](batches/2026-11-26/gulnara/evidence/md5-completion-20261126/COMPLETED.json),
  [current Gulnara record](GULNARA_ENA_REASSIGNMENT_2026-10-30.md).
- **All twelve specific keep dates verified.** A fresh scoped production
  query at **14:54 UTC on 27 November** confirmed Sara's Gargy date of
  **26 November 2027** and Joe Win's eleven dates of **26 November 2031**,
  with their requesters and history retained. No dates were changed. Xanthoria
  remains on HPC under its normal five-year age policy, currently showing
  **30 October 2031**, with no extra keep-date override. All thirteen protected
  roots were still present after the final disposal job.
  [Retention register](HPC_RETENTION.md),
  [final protected-root observation](batches/2026-11-27/kamoun-direct-disposal/evidence/job-25342010-observation-01.json).
- **The six Kamoun manual-disposal entries completed without an S3 copy.**
  Metadata retirement completed at **15:06:00 UTC**, retaining all **2,459
  records**, before-images and history, without changing storage/archive fields.
  George submitted job **25342010**, which completed in **52 seconds** with
  exit `0:0`: **six targets, 1,217 files / 790,004,575,062 bytes**, plus the
  reviewed internal symlink. Independent checks at **15:21:57 UTC** found
  all six roots absent and all thirteen protected roots present; the database
  check at **15:23:13 UTC** matched all 2,459 retired records. The raw job-log
  audit passed at **15:26:36 UTC**. No archive `confirm-absent` applies to this
  no-S3 disposal, and the completed package must not be resubmitted.
  [Completion receipt](batches/2026-11-27/kamoun-direct-disposal/evidence/COMPLETED.json),
  [job-log audit](batches/2026-11-27/kamoun-direct-disposal/evidence/job-25342010/job-25342010-audit.json).
- **The 22 registered Project titles/descriptions were reviewed on 26 November.**
  Across two approved passes, 21 titles, 22 short descriptions and 11 long
  descriptions were improved; Courville kept its title. All 919 File and 919
  AdditionalFile records, physical paths, archive state and keep dates were
  unchanged. Prior names and history were retained. No naming entries remain
  deferred. [First pass](batches/2026-11-26/project-wording/README.md),
  [last seven](batches/2026-11-26/project-wording-followup/README.md).
- **Owner contact: none needed.** The discrepancies the
  [action plan](batches/2026-10-16/ACTION_PLAN.md) would have taken to owners
  (unregistered directories, missing or misplaced files, empty projects) were
  all resolved in the database without contact. The 22 registered Projects have
  an administrative custodian (17 `shrestha`, 5 `winj`) because their original
  owner is unknown ([list](batches/2026-10-16/reconciliation-preview-2026-10-22/OWNERSHIP_AND_NEXT_STEPS.md)).
  Naming the real owners is optional and blocks nothing.

## What remains

1. **Preserve the thirteen retained Projects.** Gargy stays on both HPC and
   AWS through 26 November 2027; Joe's eleven KEEP Projects stay HPC-only
   through 26 November 2031; Xanthoria stays on HPC under the normal age policy.
   These dates permit a future review, never automatic deletion. There is no
   further removal due from the completed batch.
2. **Merge the reviewed execution evidence.** This reconciliation retains the
   current master deployment/policy updates and adds the completed execution
   records. Publication is on a review branch; merging it is still pending.
   Preserve original sealed receipts, logs and historical plans. Do not rerun
   old deletion packages, reassignment scripts or native confirmations.
3. **Reports and optional cleanup are ad hoc.** George reported that API
   `HPC_DUE_REPORT_TO` and web `HPC_RETENTION_CONTACT_EMAIL` use his address.
   A hand-run report check is optional. No report/email schedule is requested,
   and no owner email or Gulnara reply/chasing task is due. Keep the Xanthoria
   destination, staging links, working ENA CSV and all S3 copies. Any future
   staging/CSV cleanup, ENA submission or AWS revision needs its own scope and
   decision; none blocks completion of this archival task.
4. **Optional housekeeping.** Pin API `READS_ROOT_PATH` if desired. The
   recorded fallback is `/tsl/data/reads` for HPC display paths; the archive
   host uses the separately verified `/mnt/reads` mount. Review mounts again
   before future filesystem operations.

## Standing rules

- **AWS only after the HPC date has passed (George, 27 November 2026).** A
  Project is selected for copying to AWS only once its deletion-review date,
  the later of its 5-year archive date and any keep date, has passed. `lock`
  refuses earlier copies unless given `--before-review-date "<reason>"`
  (API `2474c4a`, deployed 27 November). The October batch is unaffected.
  [Details](HPC_RETENTION.md#policy-from-27-november-2026-aws-only-after-the-hpc-date-has-passed).
- Silence is consent for projects on the three plus-5-years exports. Owners are
  contacted only about a genuine new discrepancy, with a short deadline.
  Joe's confirmed keep dates need no further email for this task.
- Deletion is always manual. Never hand-edit `storage.*` or `archiveMigration.*`.
  Fresh source/archive and retention checks are required for each later batch.
  George removed the blanket seven-day hold on 23 October; the live pilot
  restore passed that day. No waiting interval is being reintroduced here.
- **Reviews are ad hoc (George, 27 November 2026).** There is no formal
  twice-yearly check. George runs a batch when he chooses, somewhere between
  twice a year and once every five years; twice a year is the ideal. He intends
  to make this semi-automated at some point; nothing is built yet.
- Kamoun's "keep on HPC" decisions stand, including *Wheat Blast - Zambia
  2018-2020* and *Ronny_Helen_Pinfestans_Pmirabilis_timecourse*.
