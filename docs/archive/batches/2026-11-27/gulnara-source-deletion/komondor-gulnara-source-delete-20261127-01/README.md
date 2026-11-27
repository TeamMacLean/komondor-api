# Reviewed Gulnara four-source deletion

Exactly four old Lichen CoCulture source Projects; 452 files;
482,738,413,472 bytes. George elected to proceed without waiting
for Gulnara's reply. This releases only the four documented manual source exclusions.
Gargy, the Xanthoria destination, all 40 destination/staging copies and all S3 objects
remain protected. No database hold fields or archive metadata are edited by this job.

Source review completed 2026-11-27T14:13:23.753Z; destination verification 2026-11-27T14:20:29.491Z.
This package refuses to delete after **2026-11-27T20:13:23.753000+00:00**. Keep source trees,
destination/staging copies and preservation decisions unchanged while queued/running.
The job checks sealed local evidence; it cannot query live MongoDB from the HPC.

One node, one task, one CPU, 1 GB, two-hour limit. From this private HPC directory,
George runs `sha256sum -c SHA256SUMS`, `sbatch --test-only delete.sbatch`, then
`sbatch delete.sbatch` if accepted. The software node can copy the package;
submission belongs on the Slurm submission node. No automatic submission occurs.

All four originals are checked before the first deletion, then again before each
removal. The destination and staging files are checked for exact copied inode,
size, timestamps and link count before and after each source removal. No payload
checksum sweep is repeated inside the job; fresh native and copy checks precede it.

Preserve `komondor-gulnara-4-JOBID.log` and `deletion-JOBID.jsonl`. On any failure,
inspect the stopped/partial state before continuing; never rerun blindly. After
success, independently prove all four roots absent and use native confirm-absent
before the website records AWS-only. Keep all source S3 snapshots unchanged.
