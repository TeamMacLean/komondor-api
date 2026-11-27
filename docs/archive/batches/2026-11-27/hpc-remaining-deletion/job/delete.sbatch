#!/bin/bash
#SBATCH --job-name=komondor-hpc-delete
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=02:00:00
#SBATCH --output=komondor-hpc-delete-%j.log
set -euo pipefail
umask 077
cd -- "$SLURM_SUBMIT_DIR"
sha256sum -c SHA256SUMS
python3 delete-reviewed-projects.py --plan deletion-plan.json --sha256 4f81e4b7188e3de52ea4c0eff7d26bc0925aa30f3da0bddf319f3440eac69ad9 --execute --log "deletion-${SLURM_JOB_ID}.jsonl"
