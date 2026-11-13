# HPC retention and storage locations

Updated 13 November 2026 from George's instructions. This page records active
manual deletion exclusions and the application feature still to implement.
It does not install a production/database hold or verify today's filesystem.

## Active manual exclusions

**Do not prepare or run HPC deletion commands for these five Projects.**
Consult the [machine-readable register](hpc-retention-holds.json) by Project ID
and exact relative path, in addition to the normal archive checks.

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

## Application requirement — pending implementation

Represent three separate facts: the archive lifecycle, the locations of copies,
and permission to remove the HPC copy.

1. **Show AWS and HPC independently.** A Project can show both “AWS verified”
   and “HPC present,” with both paths and the relevant check times. Preserve
   `storage.s3VerifiedAt` as the transfer verification time. Provide an unknown
   or unchecked HPC status and a confirmed-absent status. Do not infer present
   merely because absence has not been recorded. The current
   `aws_pending_hpc_deletion` state covers verified S3 plus unconfirmed HPC
   removal; it is not a live existence check. Presence alone is not proof of a
   complete, unchanged HPC copy; fresh native checks remain necessary.
2. **Support exceptional HPC retention.** Store a Project-level policy with
   either an explicit retain-until date or “until explicitly released,” a
   reason, who set it and when, and an audit history of changes/releases.
   A duration after transfer must use the verified transfer time, not the copy
   start time; show the resulting deadline unambiguously. Gargy is indefinite
   until George supplies a date or releases it. Gulnara uses the release
   conditions above. A passed deadline permits review; it never deletes data.
3. **Keep lifecycle and retention separate.** Retaining an HPC copy does not
   revert an archived Project to writable `hpc`. S3 remains authoritative after
   verified transfer; existing ingest/write guards remain. A dedicated
   `hpcRetention` field is a possible implementation: the current archive lock
   replaces `storage`, so a policy placed there would need preservation at
   every lifecycle transition. Do not hand-edit `storage.*` or
   `archiveMigration.*` to represent a hold.
4. **Enforce retention in the deletion workflow.** Add controlled, authorized,
   audited set/release operations. An active or malformed hold must prevent
   `deletion-command` from emitting a destructive command. Recheck for policy
   changes after long archive checks and immediately before issuing commands.
   A held Project found absent during `confirm-absent` is a discrepancy to
   investigate, not routine successful cleanup. Existing source/S3 integrity
   checks and George's manual deletion step still apply. Previously printed
   commands cannot enforce a later hold, so they must never be reused.
5. **Make the distinction visible.** Project details/list badges should show
   both locations and “Keep on HPC until [date]” or “Keep on HPC until
   released,” plus the reason and a filter for held Projects. Avoid describing
   a deliberately retained HPC copy simply as cleanup pending. Inherited
   sample/run summaries must agree with the Project and preserve access rules.

Before release, cover dated/indefinite/expired/invalid policies, observed versus
unknown locations, policy survival through archive transitions, unauthorized
updates, concurrent policy changes during checks, blocked deletion-command
output, held-but-missing sources, and unchanged archive write protections.
The existing five exclusions must be imported through the reviewed management
operation and checked before relying on application enforcement.

Current implementation references:
[Project schema](../../models/Project.js),
[public storage summary and locations](../../lib/storage-state.js),
[archive lifecycle writes](../../lib/s3-archive/state.js), and
[native deletion checks](../../lib/s3-archive/cli.js).
