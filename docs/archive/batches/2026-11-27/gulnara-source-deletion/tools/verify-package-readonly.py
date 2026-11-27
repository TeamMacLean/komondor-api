#!/usr/bin/env python3
"""Read-only validation of the sealed HPC deletion package through the VM mount.

Never calls the deletion runner's main/remove_checked functions. Only the new
receipt is written; the staged package and all source/copied payloads stay intact.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import sys
import types

HPC_ROOT = Path('/tsl/data/reads')
VM_ROOT = Path('/mnt/reads')
NFS_SOURCE = 'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads'
PACKAGE_FILES = {
    'deletion-plan.json', 'delete-reviewed-projects.py', 'summary.json',
    'destination-check.json', 'hold-release.json', 'delete.sbatch',
    'HPC_PATHS.txt', 'HELD_PATHS.txt', 'PROJECTS.tsv', 'README.md', 'SHA256SUMS',
}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path)), 'Path must be absolute and canonical')
    current = Path(path.anchor)
    for component in path.parts[1:]:
        current /= component
        mode = current.lstat().st_mode
        require(not stat.S_ISLNK(mode), 'Symlink in path: ' + str(current))
        if current != path or directory:
            require(stat.S_ISDIR(mode), 'Not a directory: ' + str(current))
    return path


def inspect_mount():
    value = json.loads(subprocess.check_output(
        ['findmnt', '-J', '-T', str(VM_ROOT), '-o', 'TARGET,SOURCE,FSTYPE'], text=True))
    rows = value['filesystems']
    require(len(rows) == 1, 'Unexpected mount result')
    mount = rows[0]
    require(mount['target'] == str(VM_ROOT) and mount['source'] == NFS_SOURCE
            and mount['fstype'].startswith('nfs'), 'Unexpected reads mount')
    safe_path(VM_ROOT, directory=True)
    return mount


def read_package(pack, expected_plan_sha, expected_runner_sha):
    safe_path(pack, directory=True)
    require({p.name for p in pack.iterdir()} == PACKAGE_FILES, 'Package file set differs')
    raw = {}
    for name in sorted(PACKAGE_FILES):
        path = safe_path(pack / name)
        require(stat.S_ISREG(path.lstat().st_mode), 'Non-regular package file: ' + name)
        raw[name] = path.read_bytes()
    listed = {}
    for line in raw['SHA256SUMS'].decode('ascii').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)', line)
        require(match is not None, 'Malformed package checksum line')
        digest, name = match.groups()
        require(name not in listed, 'Duplicate package checksum')
        listed[name] = digest
    require(set(listed) == PACKAGE_FILES - {'SHA256SUMS'}, 'Checksum scope differs')
    require(all(sha(raw[name]) == digest for name, digest in listed.items()), 'Package checksum mismatch')
    require(sha(raw['deletion-plan.json']) == expected_plan_sha, 'Pinned plan differs')
    require(sha(raw['delete-reviewed-projects.py']) == expected_runner_sha, 'Pinned runner differs')
    return raw


def load_runner(pack, reviewed_bytes):
    # Compile the exact bytes already verified, rather than reopening a path that
    # could change between checksum validation and import. No bytecode is written.
    module = types.ModuleType('sealed_gulnara_readonly_runner')
    module.__file__ = str(pack / 'delete-reviewed-projects.py')
    exec(compile(reviewed_bytes, module.__file__, 'exec'), module.__dict__)
    return module


def validate_loaded_plan(runner, plan, pack, expected_plan_sha, physical_root=VM_ROOT):
    original = copy.deepcopy(plan)
    require(runner.ROOT == HPC_ROOT, 'Runner HPC root differs')
    require(runner.PLAN_SHA256 == expected_plan_sha, 'Runner plan binding differs')
    require(plan['kind'] == 'komondor-reviewed-hpc-deletion-v1'
            and plan['hpcRoot'] == str(HPC_ROOT), 'Plan kind/root differs')
    runner.fresh(plan)
    runner.check_stage(plan)
    runner.check_release_evidence(plan, pack)
    ids, paths = set(), set()
    for project in plan['projects']:
        pid, relative = project['projectId'], project['relativeRoot']
        require(pid in runner.TARGETS and relative == runner.TARGETS[pid], 'Unreviewed Project')
        runner.relative(relative)
        require(project['hpcPath'] == str(HPC_ROOT / relative), 'Original HPC path differs')
        require(pid not in ids and project['hpcPath'] not in paths, 'Duplicate Project/path')
        require(project['nativeReviewPassed'] is True and relative not in runner.PROTECTED_ROOTS,
                'Project is unreviewed or protected')
        ids.add(pid); paths.add(project['hpcPath'])
    protected_paths = {str(HPC_ROOT / root) for root in runner.PROTECTED_ROOTS}
    for a in paths:
        for b in paths | protected_paths:
            require(a == b or not (a.startswith(b + '/') or b.startswith(a + '/')), 'Overlapping roots')
    translated = copy.deepcopy(plan)
    for project in translated['projects']:
        project['hpcPath'] = str(physical_root / project['relativeRoot'])
    checked = []
    previous_root = runner.ROOT
    try:
        runner.ROOT = physical_root
        runner.check_protected(translated)
        for project in translated['projects']:
            runner.fresh(plan)
            runner.check_protected(translated)
            target = runner.check_tree(project)
            checked.append({'projectId': project['projectId'], 'vmPath': str(target),
                            'hpcPath': str(HPC_ROOT / project['relativeRoot']),
                            'files': project['fileCount'], 'bytes': project['bytes'],
                            'sourceMetadataMatched': True})
        runner.check_protected(translated)
        runner.fresh(plan)
    finally:
        runner.ROOT = previous_root
    require(plan == original, 'Original plan was modified')
    return checked


def validate(pack, plan_sha, runner_sha):
    mount_before = inspect_mount()
    raw = read_package(pack, plan_sha, runner_sha)
    runner = load_runner(pack, raw['delete-reviewed-projects.py'])
    plan = json.loads(raw['deletion-plan.json'])
    checked = validate_loaded_plan(runner, plan, pack, plan_sha)
    mount_after = inspect_mount()
    require(mount_before == mount_after, 'Reads mount changed during validation')
    require(read_package(pack, plan_sha, runner_sha) == raw, 'Sealed package changed during validation')
    return {'success': True, 'projects': checked, 'projectCount': len(checked),
            'files': sum(p['files'] for p in checked), 'bytes': sum(p['bytes'] for p in checked),
            'protectedCopiesIntact': True, 'sealedPackageUnchanged': True,
            'reviewCompletedAt': plan['reviewCompletedAt'], 'expiresAt': plan['expiresAt'],
            'mountBefore': mount_before, 'mountAfter': mount_after,
            'packageSha256': {name: sha(value) for name, value in raw.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-dir', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--runner-sha256', required=True)
    parser.add_argument('--output-receipt', type=Path, required=True)
    args = parser.parse_args()
    require(sys.platform.startswith('linux') and socket.gethostname().split('.')[0] == 'v1333',
            'Run this read-only validator on v1333')
    require(pwd.getpwuid(os.getuid()).pw_name == 'deeks', 'Expected deeks')
    require(args.package_dir.is_absolute() and str(args.package_dir).startswith('/storage/'), 'Unexpected package location')
    output = args.output_receipt
    require(output.is_absolute() and str(output).startswith('/storage/'), 'Unexpected receipt location')
    safe_path(output.parent, directory=True)
    require(not os.path.lexists(output), 'Receipt already exists')
    require(output != args.package_dir and args.package_dir not in output.parents, 'Receipt would change sealed package')
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    receipt = {'kind': 'gulnara-deletion-package-readonly-validation-v1', 'startedAt': started,
               'package': str(args.package_dir), 'planSha256': args.plan_sha256,
               'runnerSha256': args.runner_sha256, 'databaseWrites': 0, 'awsOperations': 0,
               'sourceDeletions': 0, 'payloadWrites': 0, 'scope': 'Read-only VM mount validation; no Slurm submission or deletion'}
    try:
        receipt.update(validate(args.package_dir, args.plan_sha256, args.runner_sha256))
    except Exception as error:
        receipt.update({'success': False, 'error': str(error)})
    receipt['at'] = dt.datetime.now(dt.timezone.utc).isoformat()
    os.umask(0o077)
    with output.open('x') as handle:
        json.dump(receipt, handle, indent=2); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
    os.chmod(output, 0o400)
    print(json.dumps({'success': receipt['success'], 'receipt': str(output),
                      'projectCount': receipt.get('projectCount'), 'files': receipt.get('files'),
                      'bytes': receipt.get('bytes'), 'error': receipt.get('error')}))
    return 0 if receipt['success'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
