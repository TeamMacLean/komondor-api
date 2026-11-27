# HPC retention and storage locations

Updated 27 November 2026 from George's instructions and the completed scoped
execution checks. This page records the retained Projects, verified keep dates
and application safeguards. The feature was deployed on 16 November; George
reported API master `2474c4a` and web master `a470095` in production on
27 November ([deployment](DEPLOYMENT_2026-11-03.md),
[retention follow-up](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)).
Deployment reports and dated live observations are distinguished below.
This documentation reconciliation makes no production change; its review-branch
publication is approved for master and the production documentation sync.

## Policy from 27 November 2026: AWS only after the HPC date has passed

George's instruction, 27 November 2026. **A Project is copied to AWS only once
its HPC deletion-review date has passed**: the later of its age-based archive
date (`HPC_RETENTION_YEARS`, default 5) and its keep date, if one is set. The
copy and the HPC deletion review then happen together in the same batch. A
Project with a future keep date therefore stays HPC-only, and writable, until
that date passes.

The archive CLI enforces this at `lock`, the first step that changes anything
(API `2474c4a`, deployed 27 November). `lock` refuses a Project whose date is still
ahead, unknown, or blocked by an invalid keep date. George can still send a
Project to AWS early as a deliberate exception by adding
`--before-review-date "<reason>"`; the reason is printed in the lock output, so
save that output in the batch record. `plan` never refuses but reports the date
and whether it has passed under `reviewDate`. The keep date itself still blocks
`deletion-command` and `confirm-absent` as before.

It applies from now on. The 175 Projects of the October 2026 batch are already
on AWS and stay as they are, including Gargy, the one remaining hold, which is on both
AWS and HPC.

## Current retention and completed exclusions

**Gargy is the only retained HPC copy from the original 175-Project archive
batch.** All other 174 have completed HPC removal and native confirmation,
including Gulnara's four source Projects. Their verified S3 copies are unchanged.
The all-175 audit at **14:42:35 UTC on 27 November** found no discrepancy.
[Final cohort check](batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/cohort-final.json).

**Thirteen Projects remain protected in the wider work:** Gargy, Joe Win's
11 Kamoun KEEP Projects and the Xanthoria destination. All thirteen roots were
present in the independent check at **15:21:57 UTC**, after the separate six
Kamoun no-S3 disposals. Those six disposals are complete, with their metadata
retained, and no further removal is due.
[Protected-root observation](batches/2026-11-27/kamoun-direct-disposal/evidence/job-25342010-observation-01.json),
[disposal completion](batches/2026-11-27/kamoun-direct-disposal/evidence/COMPLETED.json).

**Do not prepare or run deletion commands for Gargy or the other retained
Projects.** Gargy's saved date is **26 November 2027**; Joe's eleven dates are
**26 November 2031**. The Xanthoria destination follows the normal age-based
policy, currently **30 October 2031**, without a keep-date override. Expiry
permits fresh review only; George still controls any eventual deletion.

The Project's `preserveOnHpcUntil`, `hpcPreservationRequestedBy` and
`hpcPreservationReason`, together with the documented current decisions, are
the retention record. All twelve explicit dates, requesters and retained
history were independently re-read at **14:54 UTC on 27 November**.
The [original machine-readable register](hpc-retention-holds.json) is preserved
unchanged as historical evidence; no application code reads it, and its old
Gulnara exclusions are superseded by the completed source release below.
Use the [deletion checklist](HPC_DELETION_CHECKLIST.md) and fresh live checks
for any later operation.

| Project | Project ID | Keep HPC path | Release condition |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` | Retain through **26 Nov 2027**; later deletion requires fresh review and George's manual action |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | `/tsl/data/reads/ntalbot/lichen_coculture_i_2_days/` | **Completed 27 Nov 2026**: reassignment verified, source removed and native absence confirmed |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | `/tsl/data/reads/ntalbot/lichen_coculture_i_9_days/` | **Completed 27 Nov 2026**: source removed and native absence confirmed |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | `/tsl/data/reads/ntalbot/lichen_coculture_i_21_days/` | **Completed 27 Nov 2026**: source removed and native absence confirmed |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | `/tsl/data/reads/ntalbot/lichen_coculture_i_42_days/` | **Completed 27 Nov 2026**: source removed and native absence confirmed |

The [3 November completion register](evidence/transfer-completion-20261103/completed-project-register-20261103T121635Z.json)
matches all five identities and records their verified S3 copies. Gargy's
transfer was verified on **30 October 2026 at 20:18:30.550 UTC**: 59 files,
274,802,985,983 bytes. The archive host recorded the same relative tree under
`/mnt/reads/two_blades/gargy_2019_rnaseq`; George's requested HPC path is the
`/tsl/data/reads/` path above. Revalidate the host's mounts and canonical paths
before any future operation; do not assume these roots are interchangeable.

Gargy's retention request is independent of the
[Gulnara reassignment](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). Completing Gulnara
does not release Gargy. Preserve Gargy's HPC tree and all sealed archive evidence.
The four source exclusions were released only after fresh native source/archive
checks, fresh destination checksums and George's explicit waiver of the reply
wait. Job `25340876` removed them, and native confirmations completed at
**14:42:13.902 UTC**. Their `aws` / `completed` state is recorded; there is no
outstanding source hold or confirmation task.
[Completed source release](batches/2026-11-27/gulnara-source-deletion/README.md).

Earlier 170/171-candidate lists are historical. All 174 released HPC copies
have now been removed; do not reuse those path lists or job packages.
The batch-wide seven-day waiting period remains removed. These are specific
Project retention instructions, not a renewed waiting period for the batch.

## Keep dates to set (George)

**All twelve dates are already set and independently verified.** George
supplied the original 26 November read-back; the scoped live query at
**14:54 UTC on 27 November** confirmed all twelve BSON dates, requesters and
retained history without changing them. No repeat date save or Joe email is
due. The heading is retained for existing links; this is now a completed register.
A date means "keep on HPC through 23:59:59.999 UTC that day". When it passes,
the Project becomes eligible for review only and, under the 27 November policy,
for its AWS copy where one does not already exist.

**The four Lichen CoCulture Projects never had a keep date.** Their temporary
manual exclusions were separately released; deletion and native confirmations
are complete. No date needs to be added to them.

The 11 Kamoun KEEP Projects are still HPC-only; `lock` now refuses them until
their date passes unless given `--before-review-date "<reason>"`.

| Project | Project ID | Keep until (production, 27 Nov 2026) | Requested by | Why |
| --- | --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | 26 Nov 2027 | Sara | One year agreed with Sara; saved 26 Nov |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | none; removed from HPC | — | Released by George, 27 Nov 2026 |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | none; removed from HPC | — | Released by George, 27 Nov 2026 |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | none; removed from HPC | — | Released by George, 27 Nov 2026 |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | none; removed from HPC | — | Released by George, 27 Nov 2026 |
| Sequencing of Mini-chromosomes of M. oryzae 2018 | `5fc012bda3efcb29338b7d5b` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-006) |
| Wheat Blast - Zambia 2018-2020 | `6054ba49d7661b6ec22a06f6` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-007) |
| Ronny_Helen_Pinfestans_Pmirabilis_timecourse | `5fc012bda3efcb29338b7d70` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-008) |
| Pangenome of rice-infecting Magnaporthe oryzae | `61a758113545d74de71ebbec` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-028) |
| Blast fungi collected from wild grasses in Germany | `61ee798cdecd27242ab8adb1` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-029) |
| Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | `61fd5d59decd27242ab8adf3` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-030) |
| Italian blast fungus isolates from wild grasses | `6502df19d32c7a7e4b174fe8` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-033) |
| Wheat Blast - Bolivia 2023-24 | `6863b1c7dc823951803ac3a4` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-034) |
| Wheat Blast - Zambia 2023 | `65f06e07e372f7554d754873` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-035) |
| Wheat Blast - Paraguay 2023 | `6863e922dc823951803ac406` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-036) |
| PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | `69a81b4920a8c93a2306efc6` | 26 Nov 2031 | Joe Win | Kamoun KEEP (skamoun-037) |

The KEEP IDs come from the
[batch action plan](batches/2026-10-16/action-plan.csv) (`db_project_id`).
The scoped read-back confirms BSON type `date` for these twelve; it is not a
claim about every other Project's raw date type. Later deletion checks must
still reject malformed dates and uncertain eligibility.

Xanthoria (`6ae4ac89a6b876c643741d27`) is the thirteenth retained Project,
outside the original archive batch. The existing Project was reused for the
12 Samples and 12 Runs; no duplicate was created. Its normal age-based archive
date is **30 October 2031**. No `preserveOnHpcUntil` override is required.
[Reassignment and retention](GULNARA_ENA_REASSIGNMENT_2026-10-30.md).

## Application feature — deployed 16 November

The project page shows separate HPC and AWS locations. HPC shows the result and
time of a directory presence check; it does not claim every payload file was
verified. AWS shows the recorded S3 transfer verification time. Unknown storage
or mount/access/path errors are shown as unknown, never as proof of deletion.
An `aws_pending_hpc_deletion` Project can therefore display both locations
without conflating lifecycle with physical presence. S3 remains authoritative
and archived sources remain protected against ingest writes.

An administrator can set or clear **`preserveOnHpcUntil`** on any project page.
The chosen calendar date means retain through **23:59:59.999 UTC** on that date.
All project readers see the date and a message to contact **George Deeks** if
HPC retention is needed for longer. A passed date is labelled expired without
claiming the copy has been deleted. Setting a date on an absent copy does not
restore it.

The date is a top-level Project field, separate from `storage.*` and
`archiveMigration.*`, so it survives archiving. The admin-only
`PUT /project/hpc-preservation` validates canonical UTC timestamps, uses the
previous date to prevent stale updates, and atomically records a private audit
entry with operator/time/old/new values. A separate Clear action removes a dated
policy. Ordinary project creation cannot inject it or its audit history.

The native CLI reports the date and whether it is active in `status`. While the
date is in the future, `deletion-command` refuses to print a destructive command
and `confirm-absent` refuses routine finalization. Invalid stored dates also stop
those operations. The CLI reloads the Project after lengthy checks; finalization
additionally fences the date in its database update. A held Project missing from
HPC is a discrepancy to investigate. Do not reuse earlier printed commands:
manual review must always check the latest date and exclusions.

**Expiry or clearing permits fresh review only. It never deletes files.**
The four Gulnara source exclusions were separately released and completed;
this does not release Gargy, Joe's eleven Projects or the Xanthoria destination.
Deployment set no production dates. George subsequently saved the dates above,
and their current values were independently checked. Future condition-based
exclusions need their own current record; the application does not import the
historical manual register or add a batch-wide waiting interval.

The [Gargy production test](GARGY_HPC_PRESERVATION_TEST.md) identifies the exact
Project and original test plan. Its database date/history checks passed; the
live page on 27 November showed both HPC/AWS locations and the saved keep date.
This observation does not claim a rerun of the whole feature test matrix.

Implementation references:
[Project schema](../../models/Project.js),
[date validation](../../lib/hpc-preservation.js),
[read-only location observations](../../lib/project-storage-locations.js),
[public summaries](../../lib/storage-state.js),
[native deletion checks](../../lib/s3-archive/cli.js), and
[API contract](../../openapi.yaml).


## Retention follow-up — deployed

The follow-up API and web are deployed. The API requires a
requester (1–200 non-blank characters) and reason (1–1000) when setting a keep
date, including a metadata-only edit of the current date. A clear requires a
fresh release reason in a separate, initially empty field, removes both public
metadata fields, and retains that explanation in the private history. Each entry
records the token's administrator, requester, reason, old/new dates and time. Existing expired holds can have their metadata
backfilled without extending the date; setting a different date requires a
future canonical end-of-day UTC timestamp. The public form explains that the
date, requester and reason are visible to every project reader.

Raw stored values other than BSON Date, null or a missing field are invalid,
including strings that Mongoose would cast into dates. They block deletion and
are visibly flagged. Administrators repair them through the same form using an
explicit invalid-value expectation; history retains the previous value as a
string. Stale expected dates still return 409.

Archiving is due after `HPC_RETENTION_YEARS` (default **5**) calendar years from
the later of Project creation and its newest Run's creation (Run → Sample →
Project). A missing or unreadable `createdAt` uses that record's ObjectId
timestamp. UTC calendar arithmetic clamps 29 February to 28 February where necessary. Dates
are computed in the asynchronous storage-locations response and never stored.
The date is visible from project creation. Invalid `HPC_RETENTION_YEARS` fails
startup. If a later date lookup/calculation fails, the page retains project and
storage details with unavailable dates; it never treats missing dates as
permission to delete. Before 27 November, keep dates blocked HPC deletion
only. By
[policy since 27 November](#policy-from-27-november-2026-aws-only-after-the-hpc-date-has-passed),
a Project is not copied to AWS until its deletion-review date has passed, and
`lock` refuses it without a recorded reason. Archiving makes the project
read-only.

For HPC/migrating projects, deletion review is due at the later of the archive
date and keep date; an AWS copy is still required first. For verified copies
awaiting HPC deletion, it is the later of `s3VerifiedAt` and the keep date;
newer age calculations do not undo the October batch decisions. An invalid
keep date has no deletion eligibility; completed `aws` projects have no HPC
copy to remove. Every date permits **review only**, never automatic deletion.

Read-only action buttons remain visible, disabled with an explanatory tooltip
and accessible reason; the banner and API write guards remain in force.
`HPC_RETENTION_CONTACT_EMAIL` is web runtime configuration for the George Deeks
mailto link, with the project name and URL filled in. When unset, the name is
shown without a link. Owners email George; there is no self-service approval
flow and no owner email from the report.

The [deletion-due report](../S3_PROJECT_ARCHIVAL_RUNBOOK.md#deletion-due-review-report)
lists overdue and upcoming review candidates plus invalid/unknown-eligibility
attention rows (not counted as due in email subjects), including
existing manual-disposal dispositions. It can email George using
`HPC_DUE_REPORT_TO`; George reported that this and the web contact address now
use his address. **Reviews are ad hoc.** The earlier January/July schedule is
not requested and must not be installed as part of this work. A manual report
check remains optional; no report email was sent by this completion update.

Gulnara's technical work is complete for this task. No reply, chasing, Joe email
or other stakeholder action is due. Preserve the destination, staging links,
working ENA CSV and sealed evidence. Any optional cleanup, future archive batch
or report is a separate ad-hoc decision. The completed execution evidence is
being published on a review branch pending merge.
