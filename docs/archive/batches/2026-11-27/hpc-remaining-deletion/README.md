# Remaining HPC deletion review — 27 November 2026

**Submission superseded:** George requested a two-project raw-read pilot, then
inspection before the other 167. Use the [two-stage instructions](../hpc-slurm-two-project-test/README.md).
Do not submit this original 169-project job; its sealed files remain historical evidence.

George manually removed Plant Capture Enhancer and its native confirmation
passed at 11:04 UTC. The live website was checked and shows HPC removal
confirmed / transfer verified in AWS. See
[the first-deletion evidence](../../2026-11-26/hpc-first-deletion/README.md).

George explicitly requested the remaining eligible Projects and selected a
**Slurm job**. HPC deletion remains his own submitted action. No further
Projects have been removed or finalized by this preparation.

## Verified scope and submission

All **169 remaining Projects / 14,883 files / 12,691,226,487,678 bytes** passed
fresh native deletion checks at **12:22:07 UTC on 27 November**. The final
catalogue check passed at 12:22:37 UTC: 14,883 file records and references,
zero issues, no active scoped ingest, correct ownership and location states.
The package builder additionally matched every current payload object version,
full CRC64NVME and ownership metadata to the sealed manifests and previous
independent review. There were no unarchived non-directory entries.

- [Exact remaining HPC paths](job/HPC_PATHS.txt)
- [Project names, IDs and sizes](job/PROJECTS.tsv)
- [Five excluded paths](job/HELD_PATHS.txt)
- [Slurm script](job/delete.sbatch) and [job instructions](job/README.md)
- [Native result](evidence/summary.json), [catalogue result](evidence/catalogue-final.json)
  and [package validation](evidence/package-validation.json)
- [Full native evidence archive](../PUBLICATION.md#artifact-11)

The reviewed package is staged at **`/storage/komondor-hpc-delete-20261127-01`**
on v1333; [all staged file checksums passed](evidence/server-package-checks.txt).
It has **not been submitted or executed** and is now superseded by the
separate two-project pilot and blocked 167-project draft. Both retain this
review's **27 November 2026 at 18:22:07 UTC** expiry. Keep source trees and
preservation decisions unchanged during execution; refresh checks if delayed.

Use the normal Slurm account/partition options if the cluster requires them.
The job requests one CPU, 1 GB and a two-hour limit. Submission only queues
work; it is not proof of deletion. Preserve the job ID and both output logs,
then independently verify absence and perform native database confirmations.

The completed native refresh is in `/storage/komondor-deletion-refresh-20261127-01`.
The original 170-project review remains unchanged
[here](../../2026-11-26/hpc-deletion-review/README.md); its list includes the
now-completed pilot and is historical. Use the two-stage instructions linked at the top for submission.
Gargy, the four Gulnara sources and the six separate no-S3 disposals are not in
the deletion package. There is no blanket seven-day retention wait.

## Slurm preparation

`tools/delete-reviewed-projects.py` only removes explicitly reviewed HPC
roots. It checks all targets before any deletion, then checks each target
again. It rejects path traversal, symlinks, nested mounts, changed/missing/extra
files, changed source inodes/timestamps, duplicate/overlapping roots and all
five held Projects. Execution requires explicit `--execute`, Linux and Slurm;
otherwise it is a read-only preflight. The plan digest is pinned in the wrapper.
A six-hour review validity bounds time in the scheduler queue. Keep decisions
and source trees must remain unchanged during the review/execution window;
the HPC runner cannot query live database preservation dates.

It logs a durable intent before each removal and completion after proving the
root absent. Any failure stops the job. It never updates AWS or MongoDB.
After George reports the job result, independently verify the mounted HPC
absence and run native confirm-absent dry run and execute for each removed
Project, preserving per-Project receipts and unchanged associated records.
Do not blindly rerun a partially completed deletion job.

Eleven safeguard tests passed on v1333 Linux Python 3.9.25 using only newly
created temporary fixtures. These cover successful exact-target removal with
a retained neighbour, unexpected and missing files, same-size file changes,
symlinks, nested mounts, path traversal, review expiry and rm failure. The
initial Mac run passed nine checks but could not run GNU rm's
`--one-file-system`; the intended Linux execution passed all ten. An additional directory-deletion permission check was then added;
[all eleven Linux tests passed](evidence/slurm-guard-tests-r2.txt). The runner
explicitly rejects execution on the Mac.

The Slurm guard was also run in read-only mode against all 169 real source
trees through the VM mount (mapping only `/tsl/data/reads` to `/mnt/reads`).
All 169 passed at 11:44:27 UTC, including expected file identities and deletion
permissions. [Result](evidence/guard-source-preflight-vm.json). No removal
function was called. The actual HPC Slurm job repeats these checks under its
own user and mount before deleting anything.
