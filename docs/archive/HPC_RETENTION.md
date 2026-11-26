# HPC retention and storage locations

Updated 26 November 2026 from George's instructions and the deployment record.
This page records active manual deletion exclusions, keep dates still needing
production confirmation or entry, and the application feature. George reported the
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
does not trigger it. The five IDs remain excluded today. The
[26 November decisions](#keep-dates-to-set-george) distinguish Gargy's one-year
retention from the four temporary Gulnara source holds and supersede the JSON
snapshot's unspecified Gargy duration. Preserve that snapshot unchanged. Read
the current Project date/requester/reason as well as these manual conditions;
no production date is established by this documentation. See the
[feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md) and the
[deletion checklist](HPC_DELETION_CHECKLIST.md).

| Project | Project ID | Keep HPC path | Release condition |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` | One year for Sara; planned through 26 Nov 2027, then fresh manual review |
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
No files are deleted automatically when a date expires. Of the original 175
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

George clarified the plan on 26 November:

- **Sara / Gargy:** one year, unless Sara asks otherwise. The working date is
  **26 November 2027**, measuring from today; the date of George's earlier
  message to Sara was not supplied. Check that it matches the intended promise
  before saving.
- **Joe Win / the 11 Kamoun KEEP Projects:** **26 November 2031**, five years
  from today. George intends to email Joe shortly. No email has been sent by
  this task, and no production dates have been set or verified here.
- **Gulnara:** one destination Project under the normal five-year archive-age
  policy. The four old source Projects need temporary protection during the
  reassignment, not five-year keep dates.

This is **13 long-term Projects** (Sara 1, Joe 11, Gulnara 1), with **12 specific
manual dates** and Gulnara's destination following the normal policy. The four
source exclusions remain in addition until the work is verified and their
release recorded. No original-batch exclusion is released by this update.

The implemented `HPC_RETENTION_YEARS=5` rule calculates archive eligibility from
the later Project/newest Run creation date. It does not populate
`preserveOnHpcUntil`. Gulnara's computed date must be read from live records;
26 November 2031 is not assumed to be that date or a chosen manual override.

A chosen keep date means "keep on HPC through 23:59:59.999 UTC that day".
Expiry permits fresh deletion review only, never automatic deletion. The
form also asks **Requested by** and **Reason**, visible to all project readers.
Use Gargy first as the [manual test](GARGY_HPC_PRESERVATION_TEST.md).

| Project | Project ID | Requested by | Planned keep-until / policy |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | Sara | 26 Nov 2027; one-year working date above |
| Xanthoria parietina mycobiont RNAseq | `6ae4ac89a6b876c643741d27` | Gulnara | Normal five-year archive-age policy; read live computed date |
| Sequencing of Mini-chromosomes of M. oryzae 2018 | `5fc012bda3efcb29338b7d5b` | Joe Win | 26 Nov 2031 |
| Wheat Blast - Zambia 2018-2020 | `6054ba49d7661b6ec22a06f6` | Joe Win | 26 Nov 2031 |
| Ronny_Helen_Pinfestans_Pmirabilis_timecourse | `5fc012bda3efcb29338b7d70` | Joe Win | 26 Nov 2031 |
| Pangenome of rice-infecting Magnaporthe oryzae | `61a758113545d74de71ebbec` | Joe Win | 26 Nov 2031 |
| Blast fungi collected from wild grasses in Germany | `61ee798cdecd27242ab8adb1` | Joe Win | 26 Nov 2031 |
| Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | `61fd5d59decd27242ab8adf3` | Joe Win | 26 Nov 2031 |
| Italian blast fungus isolates from wild grasses | `6502df19d32c7a7e4b174fe8` | Joe Win | 26 Nov 2031 |
| Wheat Blast - Bolivia 2023-24 | `6863b1c7dc823951803ac3a4` | Joe Win | 26 Nov 2031 |
| Wheat Blast - Zambia 2023 | `65f06e07e372f7554d754873` | Joe Win | 26 Nov 2031 |
| Wheat Blast - Paraguay 2023 | `6863e922dc823951803ac406` | Joe Win | 26 Nov 2031 |
| PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | `69a81b4920a8c93a2306efc6` | Joe Win | 26 Nov 2031 |

The KEEP IDs come from the
[batch action plan](batches/2026-10-16/action-plan.csv) (`db_project_id`). They
were recorded as HPC-only; recheck their current state. Copying a held Project
to AWS is allowed, but ordinary archival makes it read-only in Komondor.

Gulnara's destination already existed in the 30 October scope snapshot. Verify
and use that exact identity rather than creating a duplicate. It is outside
the completed 175-Project batch. The four temporary source holds are listed
above and remain until independent copies, reassignment checks and explicit
release review are complete; see the [Gulnara plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md).

After saving the agreed dates, run the checklist's type check (expected `[]`)
and record the actual production values and test results. Earlier five-year
suggestions for all 16 Projects are superseded by this scoped decision.

George requested a single manual mongosh batch for the twelve explicit dates.
The [prepared batch and separate verification](batches/2026-11-26/README.md)
preserve history, refuse unexpected prior values and leave Gulnara's five
records untouched. Preparation and local tests do not establish execution or
saved production dates.

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

**Expiry or clearing permits fresh review only. It never deletes files. The
four Gulnara source exclusions require the separate verified release above.** Deployment set no
production date; George sets them (see [keep dates to set](#keep-dates-to-set-george)). The current UI implements dated retention;
indefinite, condition-based exclusions remain in this manual register. It does
not automatically import them or add a batch-wide waiting interval.

[Gargy production test candidate](GARGY_HPC_PRESERVATION_TEST.md) records the
exact identity and the manual checks George will perform now that the API and
web changes are deployed. The planned one-year date is recorded above; the production result is still pending.

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
