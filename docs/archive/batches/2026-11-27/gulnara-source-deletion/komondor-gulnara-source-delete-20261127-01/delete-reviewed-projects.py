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
TARGETS = {
    '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
    '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
    '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
    '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
}
HELD = {
    '5fc012bda3efcb29338b7d58': 'two_blades/gargy_2019_rnaseq',
    '6ae4ac89a6b876c643741d27': 'ntalbot/xanthoria_parietina_mycobiont_rnaseq',
}
DESTINATION = HELD['6ae4ac89a6b876c643741d27']
STAGING = 'ntalbot/.gulnara-staging-20261126-c1f78c6d-3a3f-4165-abe5-706ded74bf99'
PROTECTED_ROOTS = set(HELD.values()) | {STAGING}
# Tokens are replaced only by the builder after reviewing all input evidence.
PLAN_SHA256 = 'e136a50e1ac04046197eafb51f60e08bade81fa750c16d30870ec1366302f8cf'
REVIEW_SHA256 = '51ff000f4aebac279f3a56c52a2e2da51ab30deedd1b09b69885a2ce90dafa41'
DESTINATION_SHA256 = '92c5eeeaa09aa4952da5386b9f365bb039775b7e074b699f09e9c03dc81d3bf9'
RELEASE_SHA256 = '76e1ae65dd6126942c6383034b9a7d88d85dbb6c2ae1b5048a4060cdefb305f0'


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
    projects = plan['projects']
    require(plan.get('stage') == 'gulnara-four-sources', 'Wrong deletion stage')
    require(plan.get('releaseStatus') == 'ready-for-user-submission', 'Sources not released')
    require(len(projects) == 4 and {p['projectId']: p['relativeRoot'] for p in projects} == TARGETS,
            'Only the four exact reviewed Gulnara sources may be removed')
    require(plan.get('reviewSummarySha256') == REVIEW_SHA256, 'Review binding changed')
    require(plan.get('destinationCheckSha256') == DESTINATION_SHA256, 'Destination binding changed')
    require(plan.get('holdReleaseSha256') == RELEASE_SHA256, 'Release binding changed')
    require({p['projectId']: p['relativeRoot'] for p in plan['held']} == HELD, 'Protected Projects changed')
    require(plan.get('protectedRoots') == sorted(PROTECTED_ROOTS), 'Protected roots changed')
    require(len(plan.get('protectedFiles', [])) == 40, 'Missing protected destination files')
    for entry in plan['protectedFiles']:
        relative(entry['path'])
    require(len({e['path'] for e in plan['protectedFiles']}) == 40, 'Duplicate protected destination files')
    require(sum(e['bytes'] for e in plan['protectedFiles']) == 41432635417, 'Protected byte count changed')
    source_inodes = {e['ino'] for p in projects for e in p['files']}
    require(not source_inodes.intersection(e['ino'] for e in plan['protectedFiles']), 'Copies share original source inodes')


def check_release_evidence(plan, pack):
    receipts = {}
    for name, expected in [('summary.json', REVIEW_SHA256), ('destination-check.json', DESTINATION_SHA256),
                           ('hold-release.json', RELEASE_SHA256)]:
        raw = (pack / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == expected, 'Release receipt changed: ' + name)
        receipts[name] = json.loads(raw)
    reviewed = receipts['summary.json']
    require(reviewed['total'] == reviewed['passed'] == 4 and reviewed['failed'] == [], 'Native source review failed')
    require(reviewed['at'] == plan['reviewCompletedAt'] and reviewed['apiHead'] == plan['apiHead'], 'Native review identity differs')
    released = receipts['hold-release.json']
    require(released.get('kind') == 'gulnara-source-hold-release-v1' and released.get('operator') == 'deeks'
            and released.get('waitingForReplyWaivedByGeorge') is True
            and released.get('manualHpcSubmissionRequired') is True,
            'Explicit user source release is missing')
    require(set(released['sourceProjectIds']) == set(TARGETS) and len(released['sourceProjectIds']) == 4, 'Released scope differs')
    require(released.get('sourceExclusionsReleasedForReview') is True
            and released.get('releaseConditionalOnFreshChecks') is True and released.get('sourceDeletionOnly') is True
            and released.get('destinationAndStagingMustRemain') is True and released.get('s3MutationAuthorized') is False
            and released.get('gargyRemainsHeld') is True, 'Preservation boundaries changed')
    copied = receipts['destination-check.json']
    require(copied.get('success') is True and copied.get('issues') == [], 'Destination review has unresolved issues')
    require(copied['destination']['projectId'] == '6ae4ac89a6b876c643741d27'
            and copied['destination']['relativeRoot'] == DESTINATION, 'Destination identity differs')
    require(copied['files'] == copied['sha256Verified'] == 40 and copied['bytes'] == 41432635417,
            'Destination verification incomplete')
    require(copied['md5Verified'] == 31 and copied['graph']['unchangedSincePostMd5'] is True,
            'Destination graph or checksum status changed')
    require(copied['controlsUnchanged'] is True and copied['originalsDistinctFromCopies'] is True
            and copied['stagingIntact'] is True, 'Retained copies or controls changed')
    require({p['projectId']: p['relativeRoot'] for p in copied['sourceProjects']} == TARGETS,
            'Destination source identities differ')


def check_protected(plan):
    for rel in PROTECTED_ROOTS:
        current = ROOT
        for part in relative(rel).parts:
            current = current / part
            require(stat.S_ISDIR(current.lstat().st_mode), 'Protected directory missing or symlinked: ' + str(current))
        require(current.resolve() == ROOT.resolve() / rel, 'Protected root resolves elsewhere')
    expected = {e['path']: e for e in plan['protectedFiles']}
    for relative_root in (DESTINATION, STAGING):
        root = ROOT / relative_root
        found = set()
        def fail(error):
            raise error
        for directory, dirs, files in os.walk(str(root), followlinks=False, onerror=fail):
            for name in dirs:
                child = Path(directory) / name
                require(stat.S_ISDIR(child.lstat().st_mode) and not os.path.ismount(str(child)),
                        'Protected tree contains symlink or nested mount')
            for name in files:
                child = Path(directory) / name
                rel = child.relative_to(root).as_posix()
                require(rel in expected, 'Unexpected file in protected tree: ' + str(child))
                e = expected[rel]; st = child.lstat()
                require(stat.S_ISREG(st.st_mode) and st.st_ino == e['ino'] and st.st_size == e['bytes'],
                        'Protected copied file identity changed: ' + str(child))
                require(abs(st.st_mtime_ns / 1e6 - e['mtimeMs']) <= 0.01
                        and abs(st.st_ctime_ns / 1e6 - e['ctimeMs']) <= 0.01,
                        'Protected copied file timestamps changed: ' + str(child))
                require(st.st_nlink == e['nlink'], 'Protected copy link count changed: ' + str(child))
                found.add(rel)
        require(found == set(expected), 'Protected copied files missing')


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
    ids, paths = set(), set()
    for p in projects:
        require(p['projectId'] in TARGETS and p['relativeRoot'] == TARGETS[p['projectId']], 'Unreviewed Project in deletion list')
        require(p['projectId'] not in ids and p['hpcPath'] not in paths, 'Duplicate Project/path')
        require(p['nativeReviewPassed'] is True, 'Native deletion review did not pass')
        require(p['relativeRoot'] not in PROTECTED_ROOTS, 'Excluded path')
        ids.add(p['projectId']); paths.add(p['hpcPath'])
    for a in paths:
        for b in paths | {str(ROOT / r) for r in PROTECTED_ROOTS}:
            require(a == b or not (a.startswith(b + '/') or b.startswith(a + '/')), 'Overlapping project roots')
    check_protected(plan)
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
                fresh(plan); check_protected(plan); check_tree(p)
                emit({'event': 'preflight-passed', 'projectId': p['projectId']})
            if not args.execute:
                emit({'event': 'dry-run-complete', 'projects': len(projects)}); return
            for p in projects:
                fresh(plan); check_protected(plan); remove_checked(p, emit)
                check_protected(plan)
            check_protected(plan)
            emit({'event': 'complete', 'projects': len(projects), 'databaseConfirmationRequired': True, 'protectedCopiesIntact': True})
        except Exception as error:
            emit({'event': 'stopped', 'error': str(error)})
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
