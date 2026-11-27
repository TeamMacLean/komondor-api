#!/usr/bin/env python3
"""DRAFT: user-submitted removal of six retired Projects with no S3 archive.

Unreplaced hash tokens deliberately prevent execution. A separately reviewed
release must bind the fresh inventory, completed retirement and this helper.
No database or AWS actions are performed by this job.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import types

ROOT = Path('/tsl/data/reads')
PLAN_SHA256 = '__PLAN_SHA256__'
HELPER_SHA256 = '__HELPER_SHA256__'
INVENTORY_SHA256 = '__INVENTORY_SHA256__'
RETIREMENT_SHA256 = '__RETIREMENT_SHA256__'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Timestamp has no timezone')
    return result


def load_helper(pack):
    path = pack / 'inventory_direct_disposal.py'
    require(stat.S_ISREG(path.lstat().st_mode), 'Helper must be a regular file')
    raw = path.read_bytes(); require(sha(raw) == HELPER_SHA256, 'Reviewed inventory helper differs')
    module = types.ModuleType('reviewed_disposal_inventory')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def fresh(plan):
    now = datetime.now(timezone.utc)
    reviewed, expires = timestamp(plan['reviewCompletedAt']), timestamp(plan['expiresAt'])
    require(reviewed <= now <= expires, 'Fresh review expired or clock is wrong')
    require(0 < (expires - reviewed).total_seconds() <= 21600, 'Review duration exceeds six hours')


def verify_plan(plan, pack, helper):
    require(plan['kind'] == 'komondor-direct-disposal-plan-v1' and plan['stage'] == 'kamoun-six-no-s3', 'Wrong no-S3 deletion stage')
    require(plan['releaseStatus'] == 'ready-for-user-submission' and plan['hpcRoot'] == str(ROOT), 'Unreleased or wrong root')
    require(plan['baselineSha256'] == helper.BASELINE_SHA256, 'Historical source baseline differs')
    require(plan['inventorySha256'] == INVENTORY_SHA256 and plan['retirementReceiptSha256'] == RETIREMENT_SHA256,
            'Release receipt bindings differ')
    projects = plan['projects']
    require(len(projects) == 6 and {p['projectId'] for p in projects} == set(helper.TARGETS), 'Exact six Project set required')
    for item in projects:
        require((item['entryId'], item['relativeRoot'], item['fileCount'], item['bytes']) == helper.TARGETS[item['projectId']], 'Wrong Project root/count/bytes')
        require(item['hpcPath'] == str(ROOT / item['relativeRoot']), 'Wrong literal HPC path')
    helper.held_paths(plan['heldPaths'])
    authority = plan['authorization']
    require(authority['operator'] == 'deeks' and authority['deleteWithoutS3'] is True
            and authority['manualHpcSubmissionRequired'] is True and isinstance(authority['userInstruction'], str)
            and authority['userInstruction'].strip(), 'Explicit no-S3 user authority missing')
    require(len(authority['sourceProjectIds']) == 6 and set(authority['sourceProjectIds']) == set(helper.TARGETS), 'Authorized Project scope differs')

    receipts = {}
    for name, digest in [('inventory.json', INVENTORY_SHA256), ('retirement-receipt.json', RETIREMENT_SHA256)]:
        path = pack / name; require(stat.S_ISREG(path.lstat().st_mode), 'Nonregular release receipt')
        raw = path.read_bytes(); require(sha(raw) == digest, 'Release receipt changed: ' + name)
        receipts[name] = json.loads(raw)
    inventory = receipts['inventory.json']
    require(inventory['kind'] == 'kamoun-direct-disposal-inventory-v1' and inventory['success'] is True,
            'Source inventory did not pass')
    require(inventory['projects'] == projects and inventory['heldPaths'] == plan['heldPaths'], 'Plan differs from fresh inventory')
    require(inventory['baselineSha256'] == helper.BASELINE_SHA256 and inventory['historicalPathsTypesAndSizesMatched'] is True
            and inventory['sourceMetadataStable'] is True, 'Historical source checks missing')
    require(inventory['regularFiles'] == 1217 and inventory['regularBytes'] == 790004575062 and inventory['symlinks'] == 1,
            'Source inventory totals differ')
    require(plan['reviewCompletedAt'] == inventory['at'], 'Expiry is not anchored to source inventory')
    retirement = receipts['retirement-receipt.json']
    require(retirement['kind'] == 'komondor-direct-disposal-retirement-v1' and retirement['success'] is True
            and retirement['operator'] == 'deeks' and retirement['retiredProjects'] == 6, 'Successful retirement receipt missing')
    require(len(retirement['projectIds']) == 6 and set(retirement['projectIds']) == set(helper.TARGETS), 'Retirement scope differs')
    require(retirement['planSha256'] == plan['retirementPlanSha256'], 'Retirement plan identity differs')
    require(len(plan['retirementPlanSha256']) == 64 and all(c in '0123456789abcdef' for c in plan['retirementPlanSha256']),
            'Invalid retirement plan digest')
    for key in ('dependentRecordsRetained', 'beforeImagesVerified', 'writesBlocked', 'externalWritersFrozen',
                'noS3Copy', 'manualFilesystemDeletionRequired', 'sourceInventoryUnchanged'):
        require(retirement.get(key) is True, 'Retirement safety condition missing: ' + key)
    require(timestamp(inventory['at']) <= timestamp(retirement['at']) <= timestamp(plan['planCreatedAt']) <= datetime.now(timezone.utc),
            'Retirement/release order is incorrect')
    fresh(plan)
    return receipts


def mount_ancestor(root, helper):
    # Retain the proven path-component, source-inode and same-device fences.
    # HPC may mount an ancestor export, unlike the VM's direct /mnt/reads mount.
    helper.safe_directory(root)
    device = root.lstat().st_dev
    for path in (root,) + tuple(root.parents):
        if os.path.ismount(path):
            require(path != Path('/') and path.lstat().st_dev == device,
                    'Reads are not on an independently mounted filesystem')
            return {'mountAncestor': str(path), 'device': device}
    raise RuntimeError('No reads mount ancestor found')


def check_project(project, helper):
    observed = helper.scan_tree(ROOT, project)
    helper.compare_fresh(observed, project)
    target = ROOT / project['relativeRoot']
    require(os.access(target.parent, os.W_OK | os.X_OK), 'No permission on Project parent')
    for path in [target] + [target / item['path'] for item in observed['entries'] if item['type'] == 'dir']:
        require(os.access(path, os.W_OK | os.X_OK), 'No removal permission in directory: ' + str(path))
    return target


def remove_checked(project, helper, emit):
    target = check_project(project, helper)
    identity = helper.metadata(target.lstat())
    emit({'event': 'deletion-started', 'projectId': project['projectId'], 'path': str(target)})
    require(helper.metadata(target.lstat()) == identity and not target.is_symlink(), 'Project root changed before removal')
    # GNU rm removes symlinks themselves; no trailing slash or link-following option.
    subprocess.run(['rm', '-rf', '--one-file-system', '--', str(target)], check=True)
    require(not os.path.lexists(target), 'Project remains after removal')
    emit({'event': 'deleted', 'projectId': project['projectId'], 'path': str(target),
          'files': project['fileCount'], 'bytes': project['bytes'], 'noS3Copy': True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--log', type=Path, required=True)
    args = parser.parse_args()
    require(sys.platform.startswith('linux'), 'Run only on the Linux HPC')
    require(sys.version_info >= (3, 7), 'Python 3.7+ required')
    require(os.getuid() == 14014, 'Execution is reserved for the reviewed HPC operator deeks')
    require(args.sha256 == PLAN_SHA256 and len(PLAN_SHA256) == 64, 'Draft/unreviewed deletion plan')
    require(stat.S_ISREG(args.plan.lstat().st_mode), 'Plan must be a regular file')
    raw = args.plan.read_bytes(); require(sha(raw) == PLAN_SHA256, 'Released plan digest differs')
    plan = json.loads(raw); pack = args.plan.resolve().parent; helper = load_helper(pack)
    receipts = verify_plan(plan, pack, helper); mounting = mount_ancestor(ROOT, helper)
    for output in (pack, args.log.resolve()):
        require(output != ROOT and ROOT not in output.parents, 'Job evidence must be outside the reads tree')
    require(not os.path.lexists(args.log), 'Refuse to overwrite any job log')
    if args.execute:
        require(bool(os.environ.get('SLURM_JOB_ID')), 'Execution requires George\'s Slurm submission')
    protected = helper.check_held(ROOT, plan['heldPaths'])
    os.umask(0o077)
    with args.log.open('x') as log:
        def emit(event):
            event['at'] = datetime.now(timezone.utc).isoformat()
            line = json.dumps(event, sort_keys=True)
            log.write(line + '\n'); log.flush(); os.fsync(log.fileno()); print(line, flush=True)
        def checks():
            fresh(plan)
            require(mount_ancestor(ROOT, helper) == mounting, 'Reads mount changed')
            now = helper.check_held(ROOT, plan['heldPaths'])
            require(now == protected, 'Protected root changed during job')
        try:
            emit({'event': 'started', 'execute': args.execute, 'host': socket.gethostname(), 'uid': os.getuid(),
                  'slurmJobId': os.environ.get('SLURM_JOB_ID'), 'planSha256': PLAN_SHA256,
                  'retirementReceiptSha256': RETIREMENT_SHA256, 'stage': plan['stage'], 'noS3Copy': True,
                  'mount': mounting})
            for project in plan['projects']:
                checks(); check_project(project, helper)
                emit({'event': 'preflight-passed', 'projectId': project['projectId']})
            if not args.execute:
                emit({'event': 'dry-run-complete', 'projects': 6}); return
            for project in plan['projects']:
                checks(); remove_checked(project, helper, emit); checks()
            emit({'event': 'complete', 'projects': 6, 'files': 1217, 'bytes': 790004575062,
                  'retiredRecordsRetained': True, 'protectedRootsIntact': True, 'noS3Copy': True,
                  'independentAbsenceConfirmationRequired': True})
        except Exception as error:
            emit({'event': 'stopped', 'error': str(error)}); raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
