# pilot-2 — reviewed HPC deletion

2 Projects; 23 files; 388,000,992 bytes.
Release status: **ready-for-user-submission**.
Original native review: 2026-11-27T12:22:07.856Z; expires 2026-11-27T18:22:07.856000+00:00.
The five held paths and completed Plant Capture are excluded.

Only the pilot is ready for George's manual submission. The remaining-167
runner is deliberately blocked even if its releaseStatus field is edited.
After inspecting pilot logs, actual source absence, native confirmations and
website state, prepare a newly released remainder pack with fresh checks as
needed. Never auto-chain the two stages or submit the old 169-project job.

Keep source trees and keep-date decisions unchanged while queued/running.
The guard checks file identities, sizes, timestamps, paths and permissions
against the reviewed manifest; it cannot query live database keep dates.
No AWS objects or database records are changed by this job.
Requires Linux, Python 3.7+, GNU rm and the usual HPC filesystem access.
Evidence must remain outside the deletion targets. Do not submit duplicates.

Pilot only: verify SHA256SUMS, then use `sbatch --test-only delete.sbatch`
to validate the request without submitting. If accepted, `sbatch delete.sbatch`
submits the job. Supply your usual account/partition options to both commands
only if the cluster requires them. No cluster-specific partition is assumed.

Inspect `komondor-pilot-2-JOBID.log` and `deletion-JOBID.jsonl`, plus:

```bash
sacct -j JOBID --format=JobID,JobName,State,ExitCode,Elapsed,AllocCPUS,TotalCPU,MaxRSS,ReqMem,NodeList
```

Include the `.batch` step (do not use `-X`). Scheduler accounting may lag or
omit metrics depending on cluster configuration. The job also records actual
allocation and GNU time resource use when available. One CPU, one task and
1 GB are requested, with a two-hour ceiling, for serial filesystem operations.
The pilot tests allocation and permissions; it cannot establish the full
batch's wall time from only 23 files.

Preserve all logs. A job ID alone is not deletion success. If it stops, do not
rerun blindly: inspect any completed removals first. Native `confirm-absent`
must follow independent mounted-source absence checks before the website
records AWS-only. No deletion or scheduler submission occurred in preparation.
