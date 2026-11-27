#!/usr/bin/env python3
"""Build a sealed, user-submitted six-Project deletion pack from actual receipts.

Local files only. Never submit Slurm, access production/AWS or remove payloads.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile
import types

HERE = Path(__file__).resolve().parent
PACKAGE = 'komondor-kamoun-six-delete-20261127-01'
INVENTORY_SHA256 = '99452c5916569166cbe36e07afa8fff550ddacd112787f6e73ee8e33e8d74d1c'
RETIREMENT_PLAN_SHA256 = '47a03545ab758e871b8e07bea9daf57c02276f70bd245783878c1d4887bacd4e'
TOOL_DIGESTS = {
    'inventory_direct_disposal.py': 'a43a12f41ca3c0009a434509d581f5637dd8db42fe46b92ebb33695edc601341',
    'sealed-source-baseline.json': '02cbef278520346ea035855b7de410f6a2ed9130fb4e52e5ff59259bc93b4e30',
    'delete-direct-disposal.py': 'ed52f65c1ccd2b6a2a491142702752fbe236bbc24c91d542b89448459eae9209',
    'delete.sbatch.in': '707dd7b2dc246736fba79323a2f211af4c9a4f91f1b1817f051121a8d29ad42c',
}
COUNTS = {'projects': 6, 'samples': 9, 'runs': 10, 'reads': 8,
          'additionalfiles': 1209, 'files': 1217, 'ingestjobs': 0, 'newsitems': 0}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Naive timestamp')
    return result


def read_regular(path):
    path = Path(os.path.abspath(path))
    for parent in reversed(path.parents):
        require(stat.S_ISDIR(parent.lstat().st_mode), 'Symlink or non-directory input ancestor')
    require(stat.S_ISREG(path.lstat().st_mode), 'Input must be a regular file: ' + str(path))
    return path.read_bytes()


def loaded(raw, filename):
    module = types.ModuleType('reviewed_' + filename.replace('.', '_'))
    module.__file__ = str(HERE / filename)
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def readme(plan, archive_name):
    return f'''# Six Kamoun Projects: reviewed direct disposal

Exactly six retired Projects, 1,217 regular files (790,004,575,062 bytes) and one
approved symlink. These are the original Kamoun spreadsheet's **delete** rows:
**there is no S3 copy or restore path for this disposal**. This job removes only
the six paths in HPC_PATHS.txt. Metadata and its retirement history are retained.
Joe's eleven retained Projects, Gargy and the Xanthoria destination are protected;
all other roots, the Xanthoria staging area and all S3 data are outside the scope.

Source inventory: {plan['reviewCompletedAt']}.
Metadata retirement: {plan['retirementCompletedAt']}.
This package refuses removal after **{plan['expiresAt']}** (six hours from the
source inventory). Keep these sources and protection decisions unchanged while
queued/running. An expired or failed job needs inspection and a fresh package;
never edit the expiry or rerun blindly. All six preflights run before any removal.

## HPC software node: copy and verify

```bash
umask 077
mkdir -p "$HOME/komondor-kamoun-six-20261127"
cd "$HOME/komondor-kamoun-six-20261127"
scp deeks@v1333.nbi.ac.uk:/storage/{archive_name} deeks@v1333.nbi.ac.uk:/storage/{archive_name}.sha256 .
sha256sum -c {archive_name}.sha256
tar -xzf {archive_name}
cd {PACKAGE}
sha256sum -c SHA256SUMS
```

The supplied archive contains only explicit regular files; no Mac resource forks,
symlinks or Python bytecode. If packaging manually, use COPYFILE_DISABLE=1 and
the explicit file list. Do not replace the supplied archive or its seals.

## HPC submission node: validate and submit

```bash
cd "$HOME/komondor-kamoun-six-20261127/{PACKAGE}" &&
sha256sum -c SHA256SUMS &&
sbatch --test-only delete.sbatch &&
sbatch delete.sbatch
```

Resources: one node, one task, one CPU, 1 GB, two-hour limit. No partition is
overridden; use the site's existing submission defaults. Save the returned job ID.
The package and private per-job JSONL log must stay outside the reads tree.

After completion, retain `komondor-kamoun-6-JOBID.log` and
`deletion-JOBID.jsonl`, and obtain the Slurm resource/exit report. Have the raw
logs audited and all six paths independently checked absent before declaring
completion. This is direct disposal, so **do not use archive confirm-absent** or
change storage/archive state. The job itself makes no database or AWS calls.
'''


def prepare(inventory_path, retirement_path, retirement_plan_path, authority):
    require(isinstance(authority, str) and authority.strip(), 'Missing direct-disposal authority')
    tools = {name: read_regular(HERE / name) for name in TOOL_DIGESTS}
    for name, digest in TOOL_DIGESTS.items():
        require(sha(tools[name]) == digest, 'Reviewed tool differs: ' + name)
    helper = loaded(tools['inventory_direct_disposal.py'], 'inventory_direct_disposal.py')
    runner = loaded(tools['delete-direct-disposal.py'], 'delete-direct-disposal.py')
    inv_raw = read_regular(inventory_path)
    receipt_raw = read_regular(retirement_path)
    retirement_plan_raw = read_regular(retirement_plan_path)
    require(sha(inv_raw) == INVENTORY_SHA256, 'Sealed source inventory changed')
    require(sha(retirement_plan_raw) == RETIREMENT_PLAN_SHA256, 'Retirement plan changed')
    inventory, retirement, native_plan = map(json.loads, (inv_raw, receipt_raw, retirement_plan_raw))
    require(retirement.get('kind') == 'komondor-direct-disposal-retirement-v1'
            and retirement.get('success') is True and retirement.get('operator') == 'deeks'
            and retirement.get('retiredProjects') == 6, 'Successful retirement receipt required')
    require(len(retirement['projectIds']) == 6 and set(retirement['projectIds']) == set(helper.TARGETS),
            'Retirement Project scope differs')
    require(native_plan['inventory'] == inventory, 'Retirement used a different source inventory')
    require(native_plan['inventoryToolSha256'] == TOOL_DIGESTS['inventory_direct_disposal.py']
            and native_plan['baselineSha256'] == helper.BASELINE_SHA256, 'Retirement input seals differ')
    require(retirement['planSha256'] == RETIREMENT_PLAN_SHA256
            and retirement['apiHead'] == native_plan['apiHead'], 'Retirement identity differs')
    require(retirement['counts'] == COUNTS and retirement['retiredRecords'] == 2459
            and retirement['written'] + retirement['adopted'] == 2459, 'Incomplete retirement')
    for field in ('dependentRecordsRetained', 'beforeImagesVerified', 'writesBlocked', 'externalWritersFrozen',
                  'noS3Copy', 'manualFilesystemDeletionRequired', 'sourceInventoryUnchanged',
                  'storageAndArchiveFieldsUnchanged', 'priorHistoryPreserved'):
        require(retirement.get(field) is True, 'Retirement assurance missing: ' + field)
    require(retirement.get('physicalDeletionPerformed') is False, 'Retirement has already removed source files')
    require(timestamp(inventory['at']) <= timestamp(retirement['executionAt']) <= timestamp(retirement['at']),
            'Retirement execution order differs')
    now = datetime.now(timezone.utc)
    expires = timestamp(inventory['at']) + timedelta(hours=6)
    require(timestamp(retirement['at']) <= now, 'Retirement receipt is in the future')
    require(now < expires, 'Source review expired before package release')
    require(inventory['mount'] == {'target': '/mnt/reads', 'source': helper.NFS_SOURCE, 'fstype': 'nfs'},
            'Unexpected source mount')
    plan = {
        'kind': 'komondor-direct-disposal-plan-v1', 'stage': 'kamoun-six-no-s3',
        'releaseStatus': 'ready-for-user-submission', 'hpcRoot': '/tsl/data/reads',
        'baselineSha256': helper.BASELINE_SHA256, 'inventorySha256': sha(inv_raw),
        'retirementReceiptSha256': sha(receipt_raw), 'retirementPlanSha256': RETIREMENT_PLAN_SHA256,
        'reviewCompletedAt': inventory['at'], 'retirementCompletedAt': retirement['at'],
        'planCreatedAt': now.isoformat(), 'expiresAt': expires.isoformat(),
        'projects': inventory['projects'], 'heldPaths': inventory['heldPaths'],
        'authorization': {'operator': 'deeks', 'deleteWithoutS3': True,
                          'manualHpcSubmissionRequired': True, 'userInstruction': authority.strip(),
                          'sourceProjectIds': [p['projectId'] for p in inventory['projects']]},
    }
    plan_raw = (json.dumps(plan, indent=2) + '\n').encode()
    replacements = {'PLAN_SHA256': sha(plan_raw), 'HELPER_SHA256': TOOL_DIGESTS['inventory_direct_disposal.py'],
                    'INVENTORY_SHA256': sha(inv_raw), 'RETIREMENT_SHA256': sha(receipt_raw)}
    code = tools['delete-direct-disposal.py'].decode()
    for key, value in replacements.items():
        token = '__' + key + '__'
        require(code.count(token) == 1, 'Missing or duplicated runner seal')
        code = code.replace(token, value)
        setattr(runner, key, value)
    require(not re.search(r'__[A-Z_]+__', code), 'Unsubstituted runner seal')
    code = code.replace('DRAFT: user-submitted removal', 'Released: user-submitted removal')
    code = code.replace('Unreplaced hash tokens deliberately prevent execution. A separately reviewed\n'
                        'release must bind the fresh inventory, completed retirement and this helper.',
                        'Sealed hashes bind the fresh inventory, completed retirement and this helper.\n'
                        'Only George may submit this reviewed package from his HPC terminal.')
    compile(code, 'delete-direct-disposal.py', 'exec')
    wrapper = tools['delete.sbatch.in'].decode()
    require(wrapper.count('__PLAN_SHA256__') == 1, 'Unexpected Slurm plan seal')
    wrapper = wrapper.replace('__PLAN_SHA256__', replacements['PLAN_SHA256'])
    wrapper = wrapper.replace('# DRAFT TEMPLATE: no released plan or checksum package exists yet.',
                              '# Released from a verified retirement receipt; user submission only.')
    payload = {
        'deletion-plan.json': plan_raw, 'inventory.json': inv_raw, 'retirement-receipt.json': receipt_raw,
        'inventory_direct_disposal.py': tools['inventory_direct_disposal.py'],
        'sealed-source-baseline.json': tools['sealed-source-baseline.json'],
        'delete-direct-disposal.py': code.encode(), 'delete.sbatch': wrapper.encode(),
        'HPC_PATHS.txt': ''.join(p['hpcPath'] + '\n' for p in plan['projects']).encode(),
        'HELD_PATHS.txt': ''.join('/tsl/data/reads/' + x['relativeRoot'] + '\n' for x in plan['heldPaths']).encode(),
        'PROJECTS.tsv': ('projectId\tentryId\thpcPath\tfileCount\tbytes\n' + ''.join(
            '\t'.join(str(p[k]) for k in ('projectId', 'entryId', 'hpcPath', 'fileCount', 'bytes')) + '\n'
            for p in plan['projects'])).encode(),
        'README.md': readme(plan, PACKAGE + '.tar.gz').encode(),
    }
    payload['SHA256SUMS'] = ''.join(sha(payload[name]) + '  ' + name + '\n' for name in sorted(payload)).encode()
    return plan, payload, runner, helper


def build(inventory, retirement_receipt, retirement_plan, out, authority):
    plan, payload, runner, helper = prepare(inventory, retirement_receipt, retirement_plan, authority)
    out = Path(os.path.abspath(out))
    require(out.name == PACKAGE, 'Unexpected package directory name')
    helper.safe_directory(out.parent)
    require(not any(out == p or p in out.parents for p in (Path('/mnt/reads'), Path('/tsl/data/reads'))),
            'Release must be outside payload tree')
    archive = out.with_name(out.name + '.tar.gz')
    digest_path = archive.with_name(archive.name + '.sha256')
    for path in (out, archive, digest_path):
        require(not os.path.lexists(path), 'Refuse to replace existing package or archive')
    out.mkdir(mode=0o700)
    for name, raw in payload.items():
        mode = 0o700 if name.endswith('.py') or name == 'delete.sbatch' else 0o600
        fd = os.open(out / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
    runner.verify_plan(plan, out, helper)
    # Explicit USTAR members avoid macOS AppleDouble/xattrs and any recursive scan.
    fd = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream, tarfile.open(fileobj=stream, mode='w:gz', format=tarfile.USTAR_FORMAT) as tar:
        for name, raw in sorted(payload.items()):
            item = tarfile.TarInfo(PACKAGE + '/' + name)
            item.size = len(raw)
            item.mode = 0o700 if name.endswith('.py') or name == 'delete.sbatch' else 0o600
            item.mtime = int(timestamp(plan['planCreatedAt']).timestamp())
            tar.addfile(item, io.BytesIO(raw))
    archive_sha = sha(read_regular(archive))
    fd = os.open(digest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(archive_sha + '  ' + archive.name + '\n')
    return {'kind': 'kamoun-direct-disposal-release-v1', 'success': True,
            'at': datetime.now(timezone.utc).isoformat(), 'output': str(out),
            'projects': 6, 'files': 1217, 'bytes': 790004575062, 'symlinks': 1,
            'planSha256': sha(payload['deletion-plan.json']),
            'retirementReceiptSha256': plan['retirementReceiptSha256'],
            'reviewCompletedAt': plan['reviewCompletedAt'], 'expiresAt': plan['expiresAt'],
            'archive': str(archive), 'archiveSha256': archive_sha,
            'members': sorted(payload), 'submitted': False, 'payloadDeletionPerformed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--retirement-receipt', type=Path, required=True)
    parser.add_argument('--retirement-plan', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--authority', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.inventory, args.retirement_receipt, args.retirement_plan, args.out, args.authority), indent=2))


if __name__ == '__main__':
    main()
