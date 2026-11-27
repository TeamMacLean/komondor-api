# Completed archive deletion handover — 27 November 2026

**Current outcome at 13:44 GMT: 170 of the 175 archived Projects are AWS-only;
five remain on both HPC and AWS.** All eligible deletions, native confirmations
and final checks are complete. Nothing in the old 169-project refresh or
Slurm preparation is still running or awaiting submission.

**Do not rerun or resubmit the original single 169-project job, pilot-2, blocked 167-project
draft or released167 job.** Their sealed packages, expiry dates and submission
instructions are historical evidence. This handover supersedes every earlier
"wait for refresh", "prepare package" and "next submit" instruction.

## Completed sequence

1. George manually removed Plant Capture Enhancer. Independent mount/absence
   checks and native `confirm-absent` passed at 11:04 UTC; its website showed
   HPC removal confirmed. Server evidence:
   `/storage/komondor-plant-capture-confirm-20261127T110444Z`.
2. All remaining 169 native archive/source reviews passed at 12:22:07.856 UTC,
   with 14,883 files / 12,691,226,487,678 bytes and no issues. The final catalogue
   check passed at 12:22:37.316 UTC. Current S3 versions/checksums/ownership
   matched prior evidence. This review's original expiry was 18:22:07 GMT;
   it was never extended.
3. Pilot Slurm job **25339708** removed two small Projects with actual raw
   Reads at 12:53 UTC. Inspected logs/accounting showed `COMPLETED` / `0:0`,
   five seconds, one CPU and 16,640 KiB peak RSS. Native confirmations finished
   at 12:59:06 UTC; both live website checks passed.
4. The read-only release check passed at 13:03:11 UTC: 167 source roots present,
   five holds present, three previously completed roots absent, 14,860 catalogue
   files/references and no issues. George submitted **job 25340024** himself.
5. Job 25340024 completed at approximately 13:24:17 UTC. Its copied raw logs
   contain exactly 503 matching audit events for all 167 targets, representing
   **14,860 files / 12,690,838,486,686 bytes**, with no discrepancies or failures.
   GNU time recorded **9m46.05s**, exit **0**, **32,192 KiB peak RSS**, one CPU
   and 1 GB allocation. Final Slurm `COMPLETED` / `0:0` was supplied by George;
   the copied `scontrol` output is a startup snapshot. Runner completion and
   process exit 0 are independently verified from the raw log.
6. Independent checks proved all 167 exact roots absent and all five held
   roots present. The native helper dry-ran every Project before executing
   confirmations with four bounded workers. Final success was
   **2026-11-27T13:44:28.951Z**, exit 0 at 13:44:29 UTC: all 167 confirmed and
   verified, zero failures. Associated records and original S3 verification
   dates are unchanged. The five held and three previously completed Projects
   and their associated records are unchanged.
7. Actual Chrome checks of the largest payload (tetraploid wheat NLRs) and
   largest file count (Solanum americanum nanopore) showed AWS verified / HPC
   removal confirmed, with samples visible. Gargy still showed both locations
   and its 26 November 2027 keep date. UI checks were representative; the
   native final audit covered all 167.

## Authoritative evidence

Current execution record:
[Completed two-stage deletion](../hpc-slurm-two-project-test/README.md).
[Aggregate completion receipt and evidence hashes](../hpc-slurm-two-project-test/evidence/bulk-completion-20261127.json)
records the 170/175 outcome and unchanged 1,288 Samples, 1,563 Runs, 2,844 Reads
and 12,016 AdditionalFiles in the final 167-project job.

- [Raw-job audit](../hpc-slurm-two-project-test/evidence/job-25340024-audit.json).
- [Native completion](../hpc-slurm-two-project-test/evidence/bulk-native-confirmation.json).
- [Independent native-evidence audit](../hpc-slurm-two-project-test/evidence/bulk-native-confirmation-audit.json).
- [Evidence copy and checksums](../hpc-slurm-two-project-test/evidence/bulk-native-evidence-copy.json).
- [Full native server evidence](../PUBLICATION.md#artifact-12).
- [Website checks](../hpc-slurm-two-project-test/evidence/bulk-website-checks-20261127.json).
- Native server pack: `/storage/komondor-slurm-bulk-confirm-20261127T133428Z`.
- Released167 plan SHA-256:
  `bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7`.

The original refresh remains at `/storage/komondor-deletion-refresh-20261127-01`
and `evidence/native-refresh-20261127.tar.gz`, SHA-256
`64dd0fb8c431eb67bb5f9f93b90e24195895c2bc6466c1bfa47f5e6355258ee1`.
The original169 `job/` plan SHA-256 remains
`4f81e4b7188e3de52ea4c0eff7d26bc0925aa30f3da0bddf319f3440eac69ad9`.
These sealed packages were not rewritten. Their old commands are not current
instructions. Preserve all receipts, logs and before/after snapshots.

The native helper's launch receipt labels the Slurm result as user-reported;
its immutable provenance is unchanged. The separate raw-log audit records the
independent inspection; the helper itself did not inspect raw logs. No S3
objects were deleted, no production code
or service changes were made, and no agent submitted a scheduler job. Database
transitions used only the deployed native confirmation workflow.

## Remaining work and boundaries

- Keep `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
  `5fc012bda3efcb29338b7d58`) on HPC through **26 November 2027**.
- Keep Gulnara's four Lichen CoCulture sources (2, 9, 21 and 42 days) pending her
  reply/sign-off and a separate cleanup/archive-revision review. Do not repeat
  the completed Xanthoria reassignment or MD5 work.
- The six no-S3 manual disposals are separate; review current state before
  George deletes them. They are not part of any completed Slurm allowlist.
- Other retention presentation, stakeholder notifications and optional report
  setup remain in [STATUS.md](../../../STATUS.md). Site-visibility work is
  separate and must not change this archive/deletion evidence.
- Future deletion of a held Project requires a released hold and fresh native
  checks. Never hand-edit `storage.*` or `archiveMigration.*` and never reuse
  this historical batch to remove additional paths.

No automatic monitor needs restarting. No commit or push is included in this
completion documentation. The vault is maintained separately by the root task.
