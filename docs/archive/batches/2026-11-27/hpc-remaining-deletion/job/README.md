# Reviewed manual HPC deletion batch

169 Projects; 14,883 files; 12,691,226,487,678 bytes.
Plant Capture is already completed. The five paths in HELD_PATHS.txt are excluded.

Native archive/source checks completed 2026-11-27T12:22:07.856Z.
This job refuses to delete after 2026-11-27T18:22:07.856000+00:00; request a fresh review if delayed.
Keep these Project trees and preservation decisions unchanged during this window.
Do not submit concurrent copies of this job or run other deletion commands on these paths.

On the HPC, change into this folder, inspect HPC_PATHS.txt/PROJECTS.tsv and run:

```bash
sha256sum -c SHA256SUMS
sbatch delete.sbatch
```

Use your usual Slurm account/partition options if the cluster requires them.
Requires Python 3.7+ and GNU rm on the Linux HPC. Uses your existing permissions.
All targets are checked before deletion starts, then each is checked again just
before removal. Source path, inode, size, timestamps, unexpected files, symlinks
nested mounts and deletion permissions are checked. It does not recompute payload hashes; the native
review already verified archive checksums. The job checks the exact reviewed
allowlist, not live database preservation dates; do not change keep dates after
review or while this job is queued/running. If any do change, stop the job and
request a fresh review. No AWS data or database records are modified by this job.

Logs: komondor-hpc-delete-JOBID.log and deletion-JOBID.jsonl in this directory.
If anything stops, preserve these logs and tell Codex. Do not rerun blindly:
some earlier Projects may already be removed. If it completes, send the job ID
and final log lines. Codex must independently verify the mounted HPC absence
and use native confirm-absent for each removed Project before the website shows
its final AWS-only state. Keep this folder as the execution evidence.
