#!/usr/bin/env python3
"""Build a new remainder pack only after inspected pilot and live-state receipts."""
import csv
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
spec = importlib.util.spec_from_file_location('runner', HERE / 'delete-remaining-reviewed.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
sha = lambda raw: hashlib.sha256(raw).hexdigest()
iso = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate(draft, accepted, live):
    require(draft['stage'] == 'remaining-167' and draft['releaseStatus'] == 'blocked-pending-pilot-review', 'Wrong blocked draft')
    require(draft['parentPlanSha256'] == runner.PARENT_SHA256, 'Wrong parent review')
    require(draft['reviewCompletedAt'] == '2026-11-27T12:22:07.856Z'
            and draft['expiresAt'] == '2026-11-27T18:22:07.856000+00:00', 'Review window changed')
    projects = {p['projectId']: p for p in draft['projects']}
    require(len(projects) == len(draft['projects']) == 167, 'Wrong draft count')
    require(accepted.get('success') is True and accepted.get('nativeConfirmed') is True
            and accepted.get('webChecked') is True and str(accepted.get('jobId')) == '25339708', 'Pilot not accepted')
    require(len(accepted['projectIds']) == 2 and set(accepted['projectIds']) == runner.PILOT_IDS, 'Wrong pilot IDs')
    require(len(accepted['projects']) == 2 and {p['projectId'] for p in accepted['projects']} == runner.PILOT_IDS, 'Pilot confirmations missing')
    require(all(p['state'] == 'aws' and p['phase'] == 'completed' and p['hpcAbsent'] is True
                for p in accepted['projects']), 'Pilot not natively completed')
    now = dt.datetime.now(dt.timezone.utc)
    require(iso(draft['reviewCompletedAt']) <= iso(live['at']) <= now, 'Invalid live-state timestamp')
    require((now - iso(live['at'])).total_seconds() <= 1800, 'Live release check is over 30 minutes old')
    require(live['apiHead'] == draft['apiHead'], 'API checkout changed')
    require(live.get('readOnly') is True and live.get('issues') == []
            and live['catalogue']['issues'] == [], 'Live check has unresolved issues')
    expected_files = sum(p['fileCount'] for p in draft['projects'])
    require(live['catalogue']['files'] == live['catalogue']['references'] == expected_files,
            'Catalogue coverage changed')
    current = {p['projectId']: p for p in live['projects']}
    require(len(live['projects']) == 167 and set(current) == set(projects), 'Live remainder differs from sealed draft')
    for project_id, old in projects.items():
        p = current[project_id]
        for key in ('relativeRoot', 'migrationId', 'sourceSha256', 'verificationSha256', 's3Uri', 's3VerifiedAt', 'fileCount', 'bytes'):
            require(p[key] == old[key], 'Live identity changed: ' + project_id + ' ' + key)
        require(p['state'] == 'aws_pending_hpc_deletion' and p['phase'] == 'verified', 'Wrong live state: ' + project_id)
        require(p['preservation']['active'] is False and p['preservation']['invalid'] is False, 'Keep date blocks: ' + project_id)
        require(p['sourcePresent'] is True and p['unfinishedJobs'] == 0 and p['activeRuns'] == 0, 'Missing source or active ingest: ' + project_id)
    held = {p['projectId']: p for p in live['held']}
    require(len(live['held']) == 5 and set(held) == set(runner.HELD), 'Held scope changed')
    require({p['projectId']: p['relativeRoot'] for p in draft['held']} == runner.HELD, 'Draft holds changed')
    for project_id, relative_root in runner.HELD.items():
        p = held[project_id]
        require(p['relativeRoot'] == relative_root and p['present'] is True and p['preservation']['invalid'] is False, 'Held source unavailable')
    require(held['5fc012bda3efcb29338b7d58']['preservation']['active'] is True, 'Gargy keep date is no longer active')
    completed = {p['projectId']: p for p in live['completed']}
    require(len(live['completed']) == 3 and set(completed) == set(runner.COMPLETED_ROOTS), 'Completed scope changed')
    for project_id, relative_root in runner.COMPLETED_ROOTS.items():
        p = completed[project_id]
        require(p['relativeRoot'] == relative_root and p['state'] == 'aws' and p['phase'] == 'completed'
                and p['hpcAbsent'] is True, 'Completed Project no longer absent/confirmed')
    runner.fresh(draft)


def main():
    raw = (BASE / 'remaining-167/deletion-plan.json').read_bytes()
    require(sha(raw) == runner.DRAFT_SHA256, 'Sealed remainder draft changed')
    draft = json.loads(raw)
    receipt_bytes = {name: (BASE / 'evidence' / name).read_bytes()
                     for name in ('pilot-acceptance.json', 'fresh-release-state.json')}
    accepted, live = [json.loads(receipt_bytes[name]) for name in ('pilot-acceptance.json', 'fresh-release-state.json')]
    validate(draft, accepted, live)
    ids_sha = sha(('\n'.join(sorted(p['projectId'] for p in draft['projects'])) + '\n').encode())
    plan = dict(draft, stage='remaining-167-released', releaseStatus='ready-for-user-submission',
                draftPlanSha256=runner.DRAFT_SHA256, projectIdsSha256=ids_sha,
                pilotAcceptanceSha256=sha(receipt_bytes['pilot-acceptance.json']),
                releaseStateSha256=sha(receipt_bytes['fresh-release-state.json']))
    plan_bytes = (json.dumps(plan, indent=2) + '\n').encode()
    replacements = {'PLAN_SHA256': sha(plan_bytes), 'IDS_SHA256': ids_sha,
                    'ACCEPTANCE_SHA256': plan['pilotAcceptanceSha256'], 'LIVE_STATE_SHA256': plan['releaseStateSha256']}
    code = (HERE / 'delete-remaining-reviewed.py').read_text()
    for key, value in replacements.items():
        token = '__' + key + '__'
        require(code.count(token) == 1, 'Runner template token missing/duplicated')
        code = code.replace(token, value)
        setattr(runner, key, value)
    runner.check_stage(plan)
    compile(code, 'delete-reviewed-projects.py', 'exec')
    out = BASE / 'remaining-167-released'
    out.mkdir(exist_ok=False)
    (out / 'deletion-plan.json').write_bytes(plan_bytes)
    (out / 'delete-reviewed-projects.py').write_text(code)
    for name, content in receipt_bytes.items():
        (out / name).write_bytes(content)
    runner.check_release_evidence(plan, out)
    wrapper = (BASE / 'pilot-2/delete.sbatch').read_text()
    wrapper = wrapper.replace('komondor-pilot-2', 'komondor-remaining-167')
    wrapper = wrapper.replace('79778948f8d92ae888a3c8ba275c2245d248bbdf41c717c094a1043a23269489', replacements['PLAN_SHA256'])
    require('--sha256 ' + replacements['PLAN_SHA256'] in wrapper and '--dependency' not in wrapper, 'Unexpected wrapper')
    (out / 'delete.sbatch').write_text(wrapper)
    (out / 'HPC_PATHS.txt').write_text(''.join(p['hpcPath'] + '\n' for p in plan['projects']))
    (out / 'HELD_PATHS.txt').write_text(''.join('/tsl/data/reads/' + p['relativeRoot'] + '\n' for p in plan['held']))
    with (out / 'PROJECTS.tsv').open('w') as handle:
        writer = csv.writer(handle, delimiter='\t')
        columns = ['projectId', 'name', 'hpcPath', 'bytes', 'fileCount', 's3Uri']
        writer.writerow(columns)
        writer.writerows([[p[key] for key in columns] for p in plan['projects']])
    (out / 'README.md').write_text(f'''# Released 167-project Slurm deletion

Pilot job 25339708, its native confirmations and website outcomes passed review.
Both acceptance and fresh live-state receipts are bound into this plan and runner.
The exact 167 original Project records remain unchanged; five holds stay excluded.
All three completed Project roots must stay absent. Keep trees and keep-date
decisions unchanged while queued/running: this HPC job cannot query live MongoDB.

Original review expires **{plan['expiresAt']}**. This release does not extend it.
One node, one task, one CPU, 1 GB, two hours; no automatic scheduler submission.
George manually runs `sha256sum -c SHA256SUMS`, then `sbatch --test-only delete.sbatch`
and, if accepted, `sbatch delete.sbatch` from this private HPC working directory.
Preserve logs and inspect stopped/partial runs before any retry. Native
confirm-absent and independent absence checks are still required afterward.
No AWS objects or database records are changed by this deletion job.
''')
    names = sorted(p.name for p in out.iterdir() if p.is_file())
    (out / 'SHA256SUMS').write_text(''.join(sha((out / name).read_bytes()) + '  ' + name + '\n' for name in names))
    print(json.dumps({'package': str(out), 'projects': len(plan['projects']), 'planSha256': sha(plan_bytes),
                      'pilotAcceptanceSha256': plan['pilotAcceptanceSha256'], 'releaseStateSha256': plan['releaseStateSha256'],
                      'expiresAt': plan['expiresAt'], 'submitted': False}, indent=2))


if __name__ == '__main__':
    main()
