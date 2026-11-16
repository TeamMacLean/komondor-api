# HPC retention and storage locations

Updated 16 November 2026 from George's instructions. This page records active
manual deletion exclusions, the keep dates George is to set, and the application
feature (deployed 16 November). It does not verify today's filesystem.

## Active manual exclusions

**Do not prepare or run HPC deletion commands for these five Projects.**
Consult the [machine-readable register](hpc-retention-holds.json) by Project ID
and exact relative path, in addition to the normal archive checks.

No code reads this register. The CLI refuses a Project only once its
`preserveOnHpcUntil` date is set, so these five also appear in the
[keep dates to set](#keep-dates-to-set-george) below. Keep this register as
the reason until the [follow-up](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md)
records requester and reason on the Project itself. See the
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

George sets these himself on each project page as administrator. **None is set
as of 16 November.** The dates below are suggestions; George chooses the actual
ones. A date means "keep on HPC through 23:59:59.999 UTC that day". When it
passes, the Project becomes eligible for deletion *review* only.

Set Gargy first: it doubles as the
[Gargy test](GARGY_HPC_PRESERVATION_TEST.md), where George suggested about a
year. The five holds matter now, because they already have verified AWS copies
and `deletion-command` would otherwise print a command for them. The 11 Kamoun
KEEP Projects are still HPC-only. Their date records the "please keep" decision
for when they are archived. Copying them to AWS stays allowed and makes them
read-only in Komondor.

| Project | Project ID | Suggested keep-until | Why |
| --- | --- | --- | --- |
| Gargy 2019 RNAseq | `5fc012bda3efcb29338b7d58` | about a year, e.g. 30 Nov 2027 | George's hold (13 Nov) |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | 30 Nov 2031; clear when released | Gulnara reassignment pending |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | 30 Nov 2031; clear when released | Gulnara reassignment pending |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | 30 Nov 2031; clear when released | Gulnara reassignment pending |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | 30 Nov 2031; clear when released | Gulnara reassignment pending |
| Sequencing of Mini-chromosomes of M. oryzae 2018 | `5fc012bda3efcb29338b7d5b` | 30 Nov 2031 | Kamoun KEEP (skamoun-006) |
| Wheat Blast - Zambia 2018-2020 | `6054ba49d7661b6ec22a06f6` | 30 Nov 2031 | Kamoun KEEP (skamoun-007) |
| Ronny_Helen_Pinfestans_Pmirabilis_timecourse | `5fc012bda3efcb29338b7d70` | 30 Nov 2031 | Kamoun KEEP (skamoun-008) |
| Pangenome of rice-infecting Magnaporthe oryzae | `61a758113545d74de71ebbec` | 30 Nov 2031 | Kamoun KEEP (skamoun-028) |
| Blast fungi collected from wild grasses in Germany | `61ee798cdecd27242ab8adb1` | 30 Nov 2031 | Kamoun KEEP (skamoun-029) |
| Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | `61fd5d59decd27242ab8adf3` | 30 Nov 2031 | Kamoun KEEP (skamoun-030) |
| Italian blast fungus isolates from wild grasses | `6502df19d32c7a7e4b174fe8` | 30 Nov 2031 | Kamoun KEEP (skamoun-033) |
| Wheat Blast - Bolivia 2023-24 | `6863b1c7dc823951803ac3a4` | 30 Nov 2031 | Kamoun KEEP (skamoun-034) |
| Wheat Blast - Zambia 2023 | `65f06e07e372f7554d754873` | 30 Nov 2031 | Kamoun KEEP (skamoun-035) |
| Wheat Blast - Paraguay 2023 | `6863e922dc823951803ac406` | 30 Nov 2031 | Kamoun KEEP (skamoun-036) |
| PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | `69a81b4920a8c93a2306efc6` | 30 Nov 2031 | Kamoun KEEP (skamoun-037) |

The KEEP IDs come from the
[batch action plan](batches/2026-10-16/action-plan.csv) (`db_project_id`).
After setting them, run the checklist's type check. It should return `[]`.
Then record the dates actually chosen here.

Until the follow-up feature makes the Project's own fields the record, an expired
date does not release Gargy or Gulnara: the manual register above still applies.

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
