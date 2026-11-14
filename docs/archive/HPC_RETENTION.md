# HPC retention and storage locations

Updated 13 November 2026 from George's instructions. This page records active
manual deletion exclusions and the application feature prepared locally for review.
It does not install a production/database hold or verify today's filesystem.

## Active manual exclusions

**Do not prepare or run HPC deletion commands for these five Projects.**
Consult the [machine-readable register](hpc-retention-holds.json) by Project ID
and exact relative path, in addition to the normal archive checks.

No code reads this register. Once the preservation feature is deployed, also set
`preserveOnHpcUntil` on all five (a far-future date for open-ended holds) so the
CLI refuses them, keeping this register as the reason. See the
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

## Application feature — implemented locally, deployment pending

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
releases the separate manual Gargy/Gulnara exclusions above.** No production date
has been set by this implementation. The current UI implements dated retention;
indefinite, condition-based exclusions remain in this manual register. It does
not automatically import them or add a batch-wide waiting interval.

[Gargy production test candidate](GARGY_HPC_PRESERVATION_TEST.md) records the
exact identity and the manual checks George will perform after deploying the
reviewed API and web changes. No test date has been chosen on George's behalf.

Implementation references:
[Project schema](../../models/Project.js),
[date validation](../../lib/hpc-preservation.js),
[read-only location observations](../../lib/project-storage-locations.js),
[public summaries](../../lib/storage-state.js),
[native deletion checks](../../lib/s3-archive/cli.js), and
[API contract](../../openapi.yaml).
