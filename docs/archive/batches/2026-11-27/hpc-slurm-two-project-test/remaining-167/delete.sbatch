#!/bin/bash
#SBATCH --job-name=komondor-remaining-167
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=02:00:00
#SBATCH --output=komondor-remaining-167-%j.log
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
runner=(python3 delete-reviewed-projects.py --plan deletion-plan.json --sha256 038bad960ea1a3fca7b9c445a9f3d603500aadee9c6725978dcccdefc474155c --execute --log "deletion-${SLURM_JOB_ID}.jsonl")
if test -x /usr/bin/time; then
  /usr/bin/time -v "${runner[@]}"
else
  "${runner[@]}"
fi
