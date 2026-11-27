#!/bin/bash
#SBATCH --job-name=komondor-pilot-2
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=02:00:00
#SBATCH --output=komondor-pilot-2-%j.log
set -euo pipefail
umask 077
cd -- "$SLURM_SUBMIT_DIR"
sha256sum -c SHA256SUMS
printf 'Job=%s Tasks=%s CPUsPerTask=%s Nodes=%s MemoryPerNodeMB=%s
'   "$SLURM_JOB_ID" "${SLURM_NTASKS:-unknown}" "${SLURM_CPUS_PER_TASK:-unknown}"   "${SLURM_JOB_NUM_NODES:-unknown}" "${SLURM_MEM_PER_NODE:-unknown}"
hostname
python3 --version
rm --version | head -n 1
if command -v scontrol >/dev/null 2>&1; then
  scontrol show job "$SLURM_JOB_ID"
fi
runner=(python3 delete-reviewed-projects.py --plan deletion-plan.json --sha256 79778948f8d92ae888a3c8ba275c2245d248bbdf41c717c094a1043a23269489 --execute --log "deletion-${SLURM_JOB_ID}.jsonl")
if test -x /usr/bin/time; then
  /usr/bin/time -v "${runner[@]}"
else
  "${runner[@]}"
fi
