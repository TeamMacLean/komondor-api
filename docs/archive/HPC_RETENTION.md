# HPC retention and storage locations

Updated 27 November 2026 from George's instructions. This page records active
manual deletion exclusions, the keep dates George is to set, and the application
feature (deployed 16 November). The retention follow-up below is also deployed
([record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)); George reported API
master `2474c4a` and web master `a470095` in production on 27 November. This
page does not verify today's filesystem or the live hosts.

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

## Active manual exclusions

**Only Gargy is still held.** George reported on 27 November 2026 that he removed the four Lichen CoCulture
Projects from HPC himself, having had no reply from Gulnara, and that the
new Project for her samples was already made. Their rows stay in the table below as history, marked released. Their verified
AWS copies remain. This page does not record whether `confirm-absent` was run
for them, and nothing here was checked against the filesystem or database.

**Do not prepare or run HPC deletion commands for Gargy.** Its keep date
(26 Nov 2027) is set in production, so the CLI also refuses.
Consult the [machine-readable register](hpc-retention-holds.json) by Project ID
and exact relative path, in addition to the normal archive checks.

No code reads this register. The CLI refuses a Project only once its
`preserveOnHpcUntil` date is set, so the held Projects also appear in the
[keep dates to set](#keep-dates-to-set-george) below. Keep this register as
the reason until the [follow-up](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md)
is deployed and every hold's requester and reason have been backfilled and
reviewed. Then the Project's `preserveOnHpcUntil`,
`hpcPreservationRequestedBy` and `hpcPreservationReason` are the current record;
`hpc-retention-holds.json` remains unchanged as history. Until then, continue
checking the manual register as well. See the
[feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md) and the
[deletion checklist](HPC_DELETION_CHECKLIST.md).

| Project | Project ID | Keep HPC path | Release condition |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` | George explicitly releases the hold; no end date supplied |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | `/tsl/data/reads/ntalbot/lichen_coculture_i_2_days/` | **Released by George, 27 Nov 2026**: reassignment done, then removed from HPC |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | `/tsl/data/reads/ntalbot/lichen_coculture_i_9_days/` | **Released by George, 27 Nov 2026** |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | `/tsl/data/reads/ntalbot/lichen_coculture_i_21_days/` | **Released by George, 27 Nov 2026** |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | `/tsl/data/reads/ntalbot/lichen_coculture_i_42_days/` | **Released by George, 27 Nov 2026** |

The [3 November completion register](evidence/transfer-completion-20261103/completed-project-register-20261103T121635Z.json)
matches all five identities and records their verified S3 copies. Gargy's
transfer was verified on **30 October 2026 at 20:18:30.550 UTC**: 59 files,
274,802,985,983 bytes. The archive host recorded the same relative tree under
`/mnt/reads/two_blades/gargy_2019_rnaseq`; George's requested HPC path is the
`/tsl/data/reads/` path above. Revalidate the host's mounts and canonical paths
before any future operation; do not assume these roots are interchangeable.

Gargy's retention request is independent of the
[Gulnara reassignment](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). Completing Gulnara
does not release Gargy. Preserve original trees and sealed archive evidence.
Gargy's hold does not expire automatically. Of the original 175 verified
Projects, 174 are outside the hold: the four Lichen Projects George has already
removed, and **170 candidates for fresh deletion review**, not approved
deletion targets. Older four-exclusion/171-candidate planning records are
superseded by this list; preserve those records unchanged as history.

The batch-wide seven-day waiting period remains removed. These are specific
Project retention instructions, not a renewed waiting period for the batch.

## Keep dates to set (George)

**Twelve are set in production**, from George's mongosh listing of every
Project with a date-typed `preserveOnHpcUntil`, pasted on 27 November 2026:
Gargy and the 11 Kamoun KEEP Projects. A date means "keep on HPC through
23:59:59.999 UTC that day". When it passes, the Project becomes eligible for
deletion *review* only, and under the 27 November policy for its AWS copy.

**The four Lichen CoCulture Projects never had a keep date.** George removed
them from HPC on his own decision (reported 27 November), so none is needed.

The 11 Kamoun KEEP Projects are still HPC-only; `lock` now refuses them until
their date passes unless given `--before-review-date "<reason>"`.

| Project | Project ID | Keep until (production, 27 Nov 2026) | Requested by | Why |
| --- | --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | 26 Nov 2027 | Sara | George's hold (13 Nov) |
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
The listing matched on BSON type `date`, so these twelve are valid dates; it
does not show whether any other Project holds a non-date value. The checklist's
type check covers that and should return `[]`.

An expired date does not by itself release Gargy: George releases it.

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

**Expiry or clearing permits fresh review only. It never deletes files or
releases the separate manual Gargy/Gulnara exclusions above.** Deployment set no
production date; George set them later (see [keep dates](#keep-dates-to-set-george)). The current UI implements dated retention;
indefinite, condition-based exclusions remain in this manual register. It does
not automatically import them or add a batch-wide waiting interval.

[Gargy production test candidate](GARGY_HPC_PRESERVATION_TEST.md) records the
exact identity and the manual checks George will perform now that the API and
web changes are deployed. No test date has been chosen on George's behalf.

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
`HPC_DUE_REPORT_TO`. Reviews are ad hoc, so the 1 January / 1 July email
schedule is optional and George installs it only if he wants the reminder. This implementation sets no production dates, installs
no schedule and sends no real email.
