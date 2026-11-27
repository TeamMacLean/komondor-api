#!/usr/bin/env python3
"""User-submitted Slurm deletion of an exact, freshly reviewed HPC allowlist.
No AWS or database writes. Default mode checks only; --execute requires Slurm.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import socket
import stat
import subprocess
import sys

ROOT = Path('/tsl/data/reads')
COMPLETED = '5fc012bda3efcb29338b7d4b'
PILOT_IDS = {'5fc012bda3efcb29338b7d4e', '5fc012bda3efcb29338b7d13'}
PARENT_SHA256 = '4f81e4b7188e3de52ea4c0eff7d26bc0925aa30f3da0bddf319f3440eac69ad9'
DRAFT_SHA256 = '038bad960ea1a3fca7b9c445a9f3d603500aadee9c6725978dcccdefc474155c'
# The builder replaces these tokens only after checking both release receipts.
PLAN_SHA256 = 'bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7'
IDS_SHA256 = '29fc93c14c6bb969cc9a2b5f8e3b953f8acbac5257af781fa712cf5ebf303cac'
ACCEPTANCE_SHA256 = 'a723e49ec3eb21e66ed5b8bc556f4c101a84f5a397efa8cd112401f4e98982ae'
LIVE_STATE_SHA256 = 'cb30e8d1e4b9e674d2ecbb0afa473cb17415dbaa2aebe604e7bb9ee1ca1a59e8'
COMPLETED_ROOTS = {
    COMPLETED: 'jjones/plant_capture_enhancer',
    '5fc012bda3efcb29338b7d13': 'jjones/miseq_renseq_of_brassica_accessions_',
    '5fc012bda3efcb29338b7d4e': 'jjones/resistance_to_albugo_laibachii_in_sf_2',
}
HELD = {
    '5fc012bda3efcb29338b7d58': 'two_blades/gargy_2019_rnaseq',
    '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
    '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
    '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
    '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def relative(value):
    require(isinstance(value, str) and value, 'Missing relative path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and '.' not in p.parts
            and str(p) == value and '\\' not in value and '\x00' not in value,
            'Unsafe relative path: ' + repr(value))
    return p


def check_stage(plan):
    require(plan.get('parentPlanSha256') == PARENT_SHA256, 'Wrong reviewed parent plan')
    require(plan.get('draftPlanSha256') == DRAFT_SHA256, 'Wrong remaining draft plan')
    require(plan['reviewCompletedAt'] == '2026-11-27T12:22:07.856Z'
            and plan['expiresAt'] == '2026-11-27T18:22:07.856000+00:00', 'Original review window changed')
    projects = plan['projects']
    ids = {p['projectId'] for p in projects}
    require(plan.get('stage') == 'remaining-167-released', 'Only the reviewed released remainder is allowed')
    require(plan.get('releaseStatus') == 'ready-for-user-submission', 'Remainder not released')
    require(len(projects) == 167 and len(ids) == 167 and not ids.intersection(COMPLETED_ROOTS), 'Wrong remaining Project scope')
    digest = hashlib.sha256(('\n'.join(sorted(ids)) + '\n').encode()).hexdigest()
    require(digest == IDS_SHA256 == plan.get('projectIdsSha256'), 'Remaining Project identities changed')
    require(plan.get('pilotAcceptanceSha256') == ACCEPTANCE_SHA256, 'Pilot acceptance binding changed')
    require(plan.get('releaseStateSha256') == LIVE_STATE_SHA256, 'Live release state binding changed')


def check_release_evidence(plan, pack):
    receipts = {}
    for name, expected in [('pilot-acceptance.json', ACCEPTANCE_SHA256), ('fresh-release-state.json', LIVE_STATE_SHA256)]:
        raw = (pack / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == expected, 'Release receipt changed: ' + name)
        receipts[name] = json.loads(raw)
    accepted = receipts['pilot-acceptance.json']
    require(accepted.get('success') is True and accepted.get('nativeConfirmed') is True
            and accepted.get('webChecked') is True and str(accepted.get('jobId')) == '25339708', 'Pilot has not passed review')
    require(len(accepted['projectIds']) == 2 and set(accepted['projectIds']) == PILOT_IDS, 'Wrong accepted pilot identities')
    states = accepted['projects']
    require(len(states) == 2 and {p['projectId'] for p in states} == PILOT_IDS, 'Missing pilot confirmations')
    require(all(p['state'] == 'aws' and p['phase'] == 'completed' and p['hpcAbsent'] is True for p in states), 'Pilot is not natively confirmed')
    live = receipts['fresh-release-state.json']
    require(live['apiHead'] == plan['apiHead'], 'Release API head differs')
    require(len(live['projects']) == 167 and {p['projectId'] for p in live['projects']} == {p['projectId'] for p in plan['projects']}, 'Release evidence scope differs')


def fresh(plan):
    now = dt.datetime.now(dt.timezone.utc)
    reviewed = dt.datetime.fromisoformat(plan['reviewCompletedAt'].replace('Z', '+00:00'))
    expires = dt.datetime.fromisoformat(plan['expiresAt'].replace('Z', '+00:00'))
    require(reviewed <= now <= expires, 'Review expired or clock is incorrect; request a fresh review')
    require((expires - reviewed).total_seconds() <= 6 * 3600, 'Review validity exceeds six hours')


def resolve_target(project):
    rel = relative(project['relativeRoot'])
    require(len(rel.parts) >= 2, 'A group/root directory is not a Project target')
    target = ROOT.joinpath(*rel.parts)
    require(str(target) == project['hpcPath'], 'HPC path differs from reviewed identity')
    current = ROOT
    require(ROOT.is_dir(), 'Reads root is unavailable')
    for part in rel.parts:
        current = current / part
        require(stat.S_ISDIR(current.lstat().st_mode), 'Missing, symlinked or non-directory path: ' + str(current))
    require(target.resolve() == ROOT.resolve().joinpath(*rel.parts), 'Unexpected path resolution')
    require(os.access(str(target.parent), os.W_OK | os.X_OK), 'Cannot remove Project from parent directory: ' + str(target.parent))
    return target


def check_tree(project):
    target = resolve_target(project)
    expected = {e['path']: e for e in project['files']}
    require(len(expected) == len(project['files']), 'Duplicate source paths')
    require(len(expected) == project['fileCount'], 'Incorrect expected file count')
    require(sum(e['bytes'] for e in expected.values()) == project['bytes'], 'Incorrect expected byte count')
    for rel in expected:
        relative(rel)
    found = set()
    device = target.stat().st_dev
    def fail(error):
        raise error
    for directory, dirs, names in os.walk(str(target), followlinks=False, onerror=fail):
        if dirs or names:
            require(os.access(directory, os.W_OK | os.X_OK), 'No deletion permission in directory: ' + directory)
        for name in dirs:
            child = Path(directory) / name
            st = child.lstat()
            require(stat.S_ISDIR(st.st_mode) and st.st_dev == device and not os.path.ismount(str(child)),
                    'Symlink, nested mount or non-directory: ' + str(child))
        for name in names:
            child = Path(directory) / name
            st = child.lstat()
            require(stat.S_ISREG(st.st_mode) and st.st_dev == device, 'Unexpected file type/mount: ' + str(child))
            rel = child.relative_to(target).as_posix()
            require(rel in expected, 'Unexpected file: ' + str(child))
            e = expected[rel]
            require(st.st_size == e['bytes'], 'File size changed: ' + str(child))
            # NFS mount device numbers differ between VM and HPC. File timestamps
            # use the same source inode; allow only floating-point conversion error.
            require(abs(st.st_mtime_ns / 1e6 - e['mtimeMs']) <= 0.01, 'File modification time changed: ' + str(child))
            require(abs(st.st_ctime_ns / 1e6 - e['ctimeMs']) <= 0.01, 'File change time changed: ' + str(child))
            require(st.st_ino == e['ino'], 'Source inode changed: ' + str(child))
            found.add(rel)
    require(found == set(expected), 'Files missing from: ' + str(target))
    return target


def remove_checked(project, emit):
    target = check_tree(project)
    identity = target.lstat()
    emit({'event': 'deletion-started', 'projectId': project['projectId'], 'path': str(target)})
    require(target.lstat().st_ino == identity.st_ino and not target.is_symlink(), 'Target changed before deletion')
    subprocess.run(['rm', '-rf', '--one-file-system', '--', str(target)], check=True)
    require(not os.path.lexists(str(target)), 'Directory remains after rm: ' + str(target))
    emit({'event': 'deleted', 'projectId': project['projectId'], 'path': str(target), 'bytes': project['bytes']})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--log', required=True)
    args = parser.parse_args()
    require(sys.platform.startswith('linux'), 'Run this job on the Linux HPC, not the Mac')
    require(sys.version_info >= (3, 7), 'Python 3.7 or later is required')
    os.umask(0o077)
    raw = Path(args.plan).read_bytes()
    require(args.sha256 == PLAN_SHA256, 'This runner is bound to one released plan')
    require(hashlib.sha256(raw).hexdigest() == args.sha256, 'Plan SHA-256 mismatch')
    plan = json.loads(raw)
    require(plan['kind'] == 'komondor-reviewed-hpc-deletion-v1', 'Wrong plan kind')
    require(plan['hpcRoot'] == str(ROOT), 'Wrong HPC root')
    fresh(plan)
    projects = plan['projects']
    check_stage(plan)
    check_release_evidence(plan, Path(args.plan).resolve().parent)
    require({p['projectId']: p['relativeRoot'] for p in plan['held']} == HELD, 'Exclusions changed')
    ids, paths = set(), set()
    for p in projects:
        require(p['projectId'] not in HELD and p['projectId'] not in COMPLETED_ROOTS, 'Excluded Project in deletion list')
        require(p['projectId'] not in ids and p['hpcPath'] not in paths, 'Duplicate Project/path')
        require(p['nativeReviewPassed'] is True, 'Native deletion review did not pass')
        require(p['relativeRoot'] not in HELD.values() and p['relativeRoot'] not in COMPLETED_ROOTS.values(), 'Excluded path')
        ids.add(p['projectId']); paths.add(p['hpcPath'])
    for a in paths:
        for b in paths | {str(ROOT / r) for r in list(HELD.values()) + list(COMPLETED_ROOTS.values())}:
            require(a == b or not (a.startswith(b + '/') or b.startswith(a + '/')), 'Overlapping project roots')
    for rel in HELD.values():
        require((ROOT / rel).is_dir(), 'Expected retained Project unavailable; check HPC mount')
    for rel in COMPLETED_ROOTS.values():
        require(not os.path.lexists(str(ROOT / rel)), 'Completed Project unexpectedly present: ' + rel)
    logpath = Path(args.log).resolve()
    pack = Path(args.plan).resolve().parent
    for p in projects:
        target = (ROOT / p['relativeRoot']).resolve()
        for output in (logpath, pack):
            require(output != target and target not in output.parents, 'Evidence is inside a deletion target')
    if args.execute:
        require(bool(os.environ.get('SLURM_JOB_ID')), 'Execution is reserved for the user-submitted Slurm job')
    with logpath.open('x') as log:
        def emit(event):
            event['at'] = dt.datetime.now(dt.timezone.utc).isoformat()
            line = json.dumps(event, sort_keys=True)
            log.write(line + '\n'); log.flush(); os.fsync(log.fileno())
            print(line, flush=True)
        try:
            emit({'event': 'started', 'execute': args.execute, 'host': socket.gethostname(), 'uid': os.getuid(),
                  'slurmJobId': os.environ.get('SLURM_JOB_ID'), 'planSha256': args.sha256, 'stage': plan['stage']})
            # Check the whole batch before removing the first Project.
            for p in projects:
                fresh(plan); check_tree(p)
                emit({'event': 'preflight-passed', 'projectId': p['projectId']})
            if not args.execute:
                emit({'event': 'dry-run-complete', 'projects': len(projects)}); return
            for p in projects:
                fresh(plan); remove_checked(p, emit)
            emit({'event': 'complete', 'projects': len(projects), 'databaseConfirmationRequired': True})
        except Exception as error:
            emit({'event': 'stopped', 'error': str(error)})
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
