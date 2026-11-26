# HPC retention and storage locations

Updated 26 November 2026 from George's instructions and the deployment record.
This page records active manual deletion exclusions, keep dates still needing
confirmation or entry, and the application feature. George reported the
retention follow-up deployed on 16 November: API `48bcd53`, web `92d6794` then
web-only `284f762` ([record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)).
This update makes no live production or filesystem check. The current saved
keep dates, requesters and reasons must be read back before acting.

## Active manual exclusions

**Do not prepare or run HPC deletion commands for these five Projects.**
Consult the [machine-readable register](hpc-retention-holds.json) by Project ID
and exact relative path, in addition to the normal archive checks.

No code reads this register. The CLI's automatic retention fence blocks an
active or malformed `preserveOnHpcUntil` value; the manual JSON exclusion alone
does not trigger it. These five therefore also appear in the
[keep dates to set](#keep-dates-to-set-george) below. Keep this register as
the reason until every hold's date, requester and reason have been checked,
backfilled where needed and reviewed on the deployed
[follow-up](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md). Then the Project's `preserveOnHpcUntil`,
`hpcPreservationRequestedBy` and `hpcPreservationReason` are the current record;
`hpc-retention-holds.json` remains unchanged as history. Until then, continue
checking the manual register as well. See the
[feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md) and the
[deletion checklist](HPC_DELETION_CHECKLIST.md).

| Project | Project ID | Keep HPC path | Release condition |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` | George explicitly releases the hold; no end date supplied |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | `/tsl/data/reads/ntalbot/lichen_coculture_i_2_days/` | Gulnara copies independently verified and release explicitly reviewed/recorded |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | `/tsl/data/reads/ntalbot/lichen_coculture_i_9_days/` | Same Gulnara condition |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | `/tsl/data/reads/ntalbot/lichen_coculture_i_21_days/` | Same Gulnara condition |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | `/tsl/data/reads/ntalbot/lichen_coculture_i_42_days/` | Same Gulnara condition |

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
No hold expires automatically for these five Projects. Of the original 175
verified Projects, **170 remain candidates for fresh deletion review**, not
approved deletion targets. Older four-exclusion/171-candidate planning records
are superseded by this list; preserve those records unchanged as history.

The batch-wide seven-day waiting period remains removed. These are specific
Project retention instructions, not a renewed waiting period for the batch.

## Keep dates to set (George)

George sets these himself on each project page using the local `admin`
account. His LDAP/ENA-admin login does not have this permission. The 16 November
notes recorded no dates set; **current production values are unconfirmed**.
Read them back first and preserve any decisions already recorded.

On 26 November George said the dates still need asking for or placing, and
suggested a **five-year default followed by telling each stakeholder**. He
explicitly described this as pencilled in. It is a proposal, not adopted policy
or an instruction to fill dates or send messages. Before using it, decide its
scope, when the five years starts, whether stakeholders are asked first or
informed after assignment, and any exceptions. No exact dates are chosen here.
This must not silently grant every archived Project another five years on HPC.

This proposed preservation period is separate from the implemented
`HPC_RETENTION_YEARS` default of 5, which calculates archive eligibility from
the later Project/newest Run creation date. It does not populate
`preserveOnHpcUntil` or resolve the outstanding manual holds.

A chosen keep date means "keep on HPC through 23:59:59.999 UTC that day".
Expiry permits deletion *review* only and does not release the explicit
Gargy/Gulnara conditions above. The deployed form also asks **Requested by**
(who asked) and **Reason**; the "Why" column below is a starting point. All
project readers see these fields. Backfill or correct them only after reading
and confirming the current record.

Use Gargy first as the [manual test](GARGY_HPC_PRESERVATION_TEST.md) once its
actual date is chosen. George's earlier suggestion of about a year and the
16 November example dates were planning examples, not saved dates or an
adopted default. They are replaced below with "To decide" to avoid treating
them as instructions.

The five holds matter now because their AWS transfers are recorded as verified;
without an active date the retention fence alone would not stop command
preparation. The 11 Kamoun KEEP Projects were recorded as HPC-only; recheck
their current state. Their date records the "please keep" decision for when
they are archived. Copying them to AWS stays allowed and makes them
read-only in Komondor.

| Project | Project ID | Keep-until decision | Why |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | To decide; explicit release still required | George's hold (13 Nov) |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | To decide; explicit release still required | Gulnara reassignment pending |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | To decide; explicit release still required | Gulnara reassignment pending |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | To decide; explicit release still required | Gulnara reassignment pending |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | To decide; explicit release still required | Gulnara reassignment pending |
| Sequencing of Mini-chromosomes of M. oryzae 2018 | `5fc012bda3efcb29338b7d5b` | To decide | Kamoun KEEP (skamoun-006) |
| Wheat Blast - Zambia 2018-2020 | `6054ba49d7661b6ec22a06f6` | To decide | Kamoun KEEP (skamoun-007) |
| Ronny_Helen_Pinfestans_Pmirabilis_timecourse | `5fc012bda3efcb29338b7d70` | To decide | Kamoun KEEP (skamoun-008) |
| Pangenome of rice-infecting Magnaporthe oryzae | `61a758113545d74de71ebbec` | To decide | Kamoun KEEP (skamoun-028) |
| Blast fungi collected from wild grasses in Germany | `61ee798cdecd27242ab8adb1` | To decide | Kamoun KEEP (skamoun-029) |
| Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | `61fd5d59decd27242ab8adf3` | To decide | Kamoun KEEP (skamoun-030) |
| Italian blast fungus isolates from wild grasses | `6502df19d32c7a7e4b174fe8` | To decide | Kamoun KEEP (skamoun-033) |
| Wheat Blast - Bolivia 2023-24 | `6863b1c7dc823951803ac3a4` | To decide | Kamoun KEEP (skamoun-034) |
| Wheat Blast - Zambia 2023 | `65f06e07e372f7554d754873` | To decide | Kamoun KEEP (skamoun-035) |
| Wheat Blast - Paraguay 2023 | `6863e922dc823951803ac406` | To decide | Kamoun KEEP (skamoun-036) |
| PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | `69a81b4920a8c93a2306efc6` | To decide | Kamoun KEEP (skamoun-037) |

The KEEP IDs come from the
[batch action plan](batches/2026-10-16/action-plan.csv) (`db_project_id`).
After setting them, run the checklist's type check. It should return `[]`.
Then record the dates actually chosen here.

An expired or cleared date does not release Gargy or Gulnara. Their explicit
release conditions must remain recorded and be checked even after their
Project fields have been backfilled.

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
production date; George sets them (see [keep dates to set](#keep-dates-to-set-george)). The current UI implements dated retention;
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


## Retention follow-up — deployment reported 16 November

The [deployment record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md) reports
API `48bcd53` and web `284f762` after the same-day web correction. Confirm the
running versions before relying on these controls. On any redeploy, deploy API
and web together, **API first**. The API now requires a
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
permission to delete. Keep dates block HPC deletion only; they never delay
copying to AWS. Archiving makes the project read-only.

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
`HPC_DUE_REPORT_TO`; its proposed 1 January / 1 July schedule must be installed
by George separately. This implementation sets no production dates, installs
no schedule and sends no real email.
