#!/usr/bin/env python3
"""Split the sealed 169-project review; never extend its review window."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
PARENT = BASE.parent / 'hpc-remaining-deletion/job/deletion-plan.json'
spec = importlib.util.spec_from_file_location('deletion', HERE / 'delete-reviewed-projects.py')
deletion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deletion)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def split(parent, parent_raw, selection):
    assert sha(parent_raw) == deletion.PARENT_SHA256
    projects = parent['projects']
    assert len(projects) == 169 and len({p['projectId'] for p in projects}) == 169
    live = {p['projectId']: p for p in selection['projects']}
    assert set(live) == deletion.PILOT_IDS
    groups = {'pilot-2': [], 'remaining-167': []}
    for p in projects:
        stage = 'pilot-2' if p['projectId'] in deletion.PILOT_IDS else 'remaining-167'
        if stage == 'pilot-2':
            q = live[p['projectId']]
            assert q['path'] == '/' + p['relativeRoot'] and q['migrationId'] == p['migrationId']
            assert q['storage']['state'] == 'aws_pending_hpc_deletion'
            assert q['storage']['s3Uri'] == p['s3Uri'] and q['storage']['s3VerifiedAt'] == p['s3VerifiedAt']
            assert q['preserveOnHpcUntil'] is None and q['counts']['unfinishedJobs'] == 0
            assert q['counts']['samples'] >= 1 and q['counts']['runs'] >= 1 and len(q['reads']) == 2
            sample_ids = {s['id'] for s in q['samples']}
            runs = {r['id']: r for r in q['runs']}
            files = {f['path'] for f in p['files']}
            for read in q['reads']:
                assert read['fileId'] and runs[read['run']]['sample'] in sample_ids
                prefix = '/' + p['relativeRoot'] + '/'
                assert read['path'].startswith(prefix) and read['path'][len(prefix):] in files
                assert '/raw/' in read['path'] and read['path'].endswith(('.fastq.gz', '.fq.gz'))
        groups[stage].append(p)
    assert len(groups['pilot-2']) == 2 and len(groups['remaining-167']) == 167
    assert {p['projectId'] for group in groups.values() for p in group} == {p['projectId'] for p in projects}
    return {stage: dict(parent, projects=group, stage=stage, parentPlanSha256=sha(parent_raw),
                        releaseStatus='ready-for-user-submission' if stage == 'pilot-2' else 'blocked-pending-pilot-review')
            for stage, group in groups.items()}


def build(stage, plan):
    out = BASE / stage
    out.mkdir(exist_ok=False)
    raw = (json.dumps(plan, indent=2) + '\n').encode()
    (out / 'deletion-plan.json').write_bytes(raw)
    digest = sha(raw)
    shutil.copyfile(HERE / 'delete-reviewed-projects.py', out / 'delete-reviewed-projects.py')
    projects = plan['projects']
    (out / 'HPC_PATHS.txt').write_text(''.join(p['hpcPath']+'\n' for p in projects))
    (out / 'HELD_PATHS.txt').write_text(''.join('/tsl/data/reads/'+p['relativeRoot']+'\n' for p in plan['held']))
    with (out / 'PROJECTS.tsv').open('w') as f:
        writer = csv.writer(f, delimiter='\t')
        writer.writerow(['projectId', 'name', 'hpcPath', 'bytes', 'files', 's3Uri'])
        for p in projects:
            writer.writerow([p[k] for k in ['projectId', 'name', 'hpcPath', 'bytes', 'fileCount', 's3Uri']])
    script = '''#!/bin/bash
#SBATCH --job-name=komondor-STAGE
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=02:00:00
#SBATCH --output=komondor-STAGE-%j.log
set -euo pipefail
umask 077
cd -- "$SLURM_SUBMIT_DIR"
sha256sum -c SHA256SUMS
printf 'Job=%s Tasks=%s CPUsPerTask=%s Nodes=%s MemoryPerNodeMB=%s\n' \
  "$SLURM_JOB_ID" "${SLURM_NTASKS:-unknown}" "${SLURM_CPUS_PER_TASK:-unknown}" \
  "${SLURM_JOB_NUM_NODES:-unknown}" "${SLURM_MEM_PER_NODE:-unknown}"
hostname
python3 --version
rm --version | head -n 1
if command -v scontrol >/dev/null 2>&1; then
  scontrol show job "$SLURM_JOB_ID"
fi
runner=(python3 delete-reviewed-projects.py --plan deletion-plan.json --sha256 PLAN_HASH --execute --log "deletion-${SLURM_JOB_ID}.jsonl")
if test -x /usr/bin/time; then
  /usr/bin/time -v "${runner[@]}"
else
  "${runner[@]}"
fi
'''.replace('STAGE', stage).replace('PLAN_HASH', digest)
    (out / 'delete.sbatch').write_text(script)
    (out / 'README.md').write_text(f'''# {stage} — reviewed HPC deletion

{len(projects)} Projects; {sum(p['fileCount'] for p in projects):,} files; {sum(p['bytes'] for p in projects):,} bytes.
Release status: **{plan['releaseStatus']}**.
Original native review: {plan['reviewCompletedAt']}; expires {plan['expiresAt']}.
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

Inspect `komondor-{stage}-JOBID.log` and `deletion-JOBID.jsonl`, plus:

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
''')
    names = sorted(p.name for p in out.iterdir() if p.is_file())
    (out / 'SHA256SUMS').write_text(''.join(sha((out/n).read_bytes())+'  '+n+'\n' for n in names))
    return {'stage': stage, 'projects': len(projects), 'files': sum(p['fileCount'] for p in projects),
            'bytes': sum(p['bytes'] for p in projects), 'planSha256': digest,
            'releaseStatus': plan['releaseStatus'], 'reviewCompletedAt': plan['reviewCompletedAt'],
            'expiresAt': plan['expiresAt']}


if __name__ == '__main__':
    raw = PARENT.read_bytes()
    plans = split(json.loads(raw), raw, json.loads((BASE/'evidence/selection-live.json').read_text()))
    deletion.fresh(plans['pilot-2'])
    deletion.check_stage(plans['pilot-2'])
    results = [build(stage, plan) for stage, plan in plans.items()]
    output = {'parentPlanSha256': sha(raw), 'stages': results, 'disjointAndComplete': True}
    (BASE/'evidence/split-validation.json').write_text(json.dumps(output, indent=2)+'\n')
    print(json.dumps(output, indent=2))
