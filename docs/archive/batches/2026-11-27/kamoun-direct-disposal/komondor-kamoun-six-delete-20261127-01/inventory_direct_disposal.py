#!/usr/bin/env python3
"""Read-only inventory of six exact no-S3 disposal roots; output JSON to stdout.

No payload hashing, database access, evidence-file writes or deletion. The one
historic symlink is inspected using lstat/readlink and never traversed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys

BASELINE_SHA256 = '02cbef278520346ea035855b7de410f6a2ed9130fb4e52e5ff59259bc93b4e30'
OCT22_PLAN_SHA256 = '6ba8c00fddf137fe36f2288fd7c1d151ee589edc852903fc66e2e9e0a8b3e303'
NFS_SOURCE = 'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads'
TARGETS = {
    '5fc012bda3efcb29338b7cf9': ('skamoun-002', 'skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01', 260, 48614994012),
    '5fc012bda3efcb29338b7cf5': ('skamoun-003', 'skamoun/saunderd_pstriiformis_South_African_isolates', 24, 109802811903),
    '5fc012bda3efcb29338b7d5c': ('skamoun-005', 'skamoun/saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68', 106, 72013629033),
    '5fc012bda3efcb29338b7d7a': ('skamoun-013', 'skamoun/xiao_scr74', 62, 161447455740),
    '5fc012bda3efcb29338b7d0d': ('skamoun-015', 'skamoun/saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01', 641, 239985996303),
    '5fc012bda3efcb29338b7cf8': ('skamoun-016', 'skamoun/saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83', 124, 158139688071),
}
HELD_IDS = {
    '5fc012bda3efcb29338b7d58', '6ae4ac89a6b876c643741d27',
    '5fc012bda3efcb29338b7d5b', '6054ba49d7661b6ec22a06f6', '5fc012bda3efcb29338b7d70',
    '61a758113545d74de71ebbec', '61ee798cdecd27242ab8adb1', '61fd5d59decd27242ab8adf3',
    '6502df19d32c7a7e4b174fe8', '6863b1c7dc823951803ac3a4', '65f06e07e372f7554d754873',
    '6863e922dc823951803ac406', '69a81b4920a8c93a2306efc6',
}
PINNED_HELD = {
    '5fc012bda3efcb29338b7d58': 'two_blades/gargy_2019_rnaseq',
    '6ae4ac89a6b876c643741d27': 'ntalbot/xanthoria_parietina_mycobiont_rnaseq',
}
KNOWN_LINK_PROJECT = '5fc012bda3efcb29338b7d0d'
KNOWN_LINK_PATH = 'Sample_LIB2419/run1/processed/LIB2419_R2_v2.fastq.gz'
KNOWN_LINK_TARGET = 'LIB2419_R2_repeat.fastq.gz'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def relative(value):
    require(isinstance(value, str) and value, 'Missing relative path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and '.' not in p.parts
            and str(p) == value and '\\' not in value and '\x00' not in value,
            'Unsafe relative path: ' + repr(value))
    return p


def metadata(st):
    return {'dev': st.st_dev, 'ino': st.st_ino, 'mode': st.st_mode, 'uid': st.st_uid,
            'gid': st.st_gid, 'nlink': st.st_nlink, 'size': st.st_size,
            'mtimeNs': str(st.st_mtime_ns), 'ctimeNs': str(st.st_ctime_ns)}


def portable_metadata(value):
    # Device numbers are mount-local and differ between VM and HPC clients.
    return {key: item for key, item in value.items() if key != 'dev'}


def safe_directory(path):
    require(path.is_absolute(), 'Expected an absolute path')
    current = Path(path.anchor)
    for part in path.parts[1:]:
        require(part not in ('.', '..'), 'Noncanonical directory')
        current /= part
        require(stat.S_ISDIR(current.lstat().st_mode), 'Missing, symlinked or non-directory path: ' + str(current))
    require(path.resolve() == path, 'Directory resolves elsewhere')
    return path


def inspect_mount(root):
    require(str(root) in ('/mnt/reads', '/tsl/data/reads'), 'Unexpected reads root')
    rows = json.loads(subprocess.check_output(['findmnt', '-J', '-T', str(root), '-o', 'TARGET,SOURCE,FSTYPE'], text=True))['filesystems']
    require(len(rows) == 1 and rows[0]['target'] == str(root) and rows[0]['source'] == NFS_SOURCE
            and rows[0]['fstype'].startswith('nfs'), 'Unexpected reads mount')
    safe_directory(root)
    return rows[0]


def held_paths(items):
    require(isinstance(items, list) and len(items) == 13, 'Expected thirteen protected Projects')
    require({x['projectId'] for x in items} == HELD_IDS, 'Protected Project identities differ')
    paths = []
    for item in items:
        path = item['relativeRoot']; require(len(relative(path).parts) >= 2, 'Protected root is not a Project')
        require(item['projectId'] not in TARGETS, 'Target appears as protected Project')
        if item['projectId'] in PINNED_HELD:
            require(path == PINNED_HELD[item['projectId']], 'Known protected root differs')
        paths.append(path)
    require(len(set(paths)) == 13, 'Duplicate protected path')
    candidates = [target[1] for target in TARGETS.values()]
    for a in candidates:
        for b in paths + [p for p in candidates if p != a]:
            require(a != b and not (a.startswith(b + '/') or b.startswith(a + '/')), 'Target/protected roots overlap')
    return items


def check_held(root, items):
    held_paths(items)
    result = []
    for item in items:
        path = safe_directory(root / item['relativeRoot'])
        require(not os.path.ismount(path), 'Protected Project is a nested mount')
        result.append(dict(item, metadata=metadata(path.lstat())))
    return result


def load_baseline(path):
    require(path.is_file() and not path.is_symlink(), 'Missing/nonregular baseline')
    raw = path.read_bytes(); require(sha(raw) == BASELINE_SHA256, 'Historical baseline digest differs')
    value = json.loads(raw)
    require(value['kind'] == 'kamoun-direct-disposal-source-baseline-v1'
            and value['sourcePlanSha256'] == OCT22_PLAN_SHA256, 'Baseline provenance differs')
    require(len(value['projects']) == 6 and {p['projectId'] for p in value['projects']} == set(TARGETS), 'Baseline scope differs')
    for project in value['projects']:
        expected = TARGETS[project['projectId']]
        require((project['entryId'], project['relativeRoot'], project['fileCount'], project['bytes']) == expected, 'Baseline target differs')
    return value


def scan_tree(root, project):
    pid = project['projectId']; require(pid in TARGETS, 'Unapproved Project')
    require((project['entryId'], project['relativeRoot'], project['fileCount'], project['bytes']) == TARGETS[pid], 'Unapproved target identity')
    target = safe_directory(root / project['relativeRoot'])
    require(not os.path.ismount(target), 'Project root is a nested mount')
    before_root = metadata(target.lstat()); device = before_root['dev']; entries = []

    def visit(directory, descriptor):
        before = metadata(os.fstat(descriptor))
        require(stat.S_ISDIR(before['mode']) and before['dev'] == device, 'Directory type/device changed')
        require(metadata(directory.lstat()) == before, 'Directory path identity changed')
        with os.scandir(descriptor) as iterator:
            children = sorted(iterator, key=lambda x: x.name)
        for child in children:
            path = directory / child.name
            st = os.stat(child.name, dir_fd=descriptor, follow_symlinks=False)
            rel = path.relative_to(target).as_posix(); relative(rel)
            require(st.st_dev == device, 'Nested mount or other filesystem entry')
            item = dict(path=rel, **metadata(st))
            if stat.S_ISDIR(st.st_mode):
                require(not os.path.ismount(path), 'Nested mount in Project')
                child_fd = os.open(child.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                try:
                    require(metadata(os.fstat(child_fd)) == metadata(st), 'Directory replaced while opening')
                    item['type'] = 'dir'; entries.append(item); visit(path, child_fd)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(st.st_mode):
                require(st.st_nlink == 1, 'Unexpected hardlinked source file: ' + rel)
                item['type'] = 'file'; entries.append(item)
            elif stat.S_ISLNK(st.st_mode):
                require(pid == KNOWN_LINK_PROJECT and rel == KNOWN_LINK_PATH, 'Unreviewed symlink: ' + rel)
                link = os.readlink(child.name, dir_fd=descriptor)
                require(link == KNOWN_LINK_TARGET and st.st_size == len(link.encode()), 'Known symlink target differs')
                linked = PurePosixPath(rel).parent / relative(link)
                require(not linked.is_absolute() and '..' not in linked.parts, 'Symlink escapes Project')
                # The only allowed target is a basename in this same open directory.
                # Inspect the target's own inode; never open or resolve the symlink.
                target_st = os.stat(link, dir_fd=descriptor, follow_symlinks=False)
                require(stat.S_ISREG(target_st.st_mode) and target_st.st_dev == device, 'Known symlink does not point to an in-tree regular file')
                require(metadata(os.stat(child.name, dir_fd=descriptor, follow_symlinks=False)) == metadata(st), 'Symlink changed during inspection')
                item.update(type='symlink', linkTarget=link); entries.append(item)
            else:
                raise RuntimeError('Unsupported filesystem entry: ' + rel)
        require(metadata(os.fstat(descriptor)) == before and metadata(directory.lstat()) == before,
                'Directory changed during inventory: ' + str(directory))

    target_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(metadata(os.fstat(target_fd)) == before_root, 'Project replaced while opening')
        visit(target, target_fd)
    finally:
        os.close(target_fd)
    require(metadata(target.lstat()) == before_root, 'Project root changed during inventory')
    entries.sort(key=lambda e: e['path'])
    files = [e for e in entries if e['type'] == 'file']
    require(len(files) == project['fileCount'] and sum(e['size'] for e in files) == project['bytes'], 'Current source file/byte totals differ')
    return {'entryId': project['entryId'], 'projectId': pid, 'relativeRoot': project['relativeRoot'],
            'hpcPath': '/tsl/data/reads/' + project['relativeRoot'], 'observedPath': str(target),
            'fileCount': len(files), 'bytes': sum(e['size'] for e in files),
            'rootMetadata': before_root, 'entries': entries}


def compare_historical(snapshot, baseline):
    expected = {e['path']: e for e in baseline['entries']}
    actual = {e['path']: e for e in snapshot['entries']}
    require(len(expected) == len(baseline['entries']) and len(actual) == len(snapshot['entries']), 'Duplicate inventory path')
    require(set(actual) == set(expected), 'Source paths changed since sealed Oct22 inventory')
    for path, old in expected.items():
        now = actual[path]
        require(now['type'] == old['type'], 'Source entry type changed: ' + path)
        if old['type'] != 'dir':
            require(now['size'] == old['size'], 'Source size changed: ' + path)
        if old['type'] == 'symlink':
            require(now['linkTarget'] == old['linkTarget'], 'Source symlink target changed')


def compare_fresh(snapshot, expected):
    for key in ('entryId', 'projectId', 'relativeRoot', 'hpcPath', 'fileCount', 'bytes'):
        require(snapshot[key] == expected[key], 'Fresh target differs: ' + key)
    require(portable_metadata(snapshot['rootMetadata']) == portable_metadata(expected['rootMetadata']), 'Source root metadata changed')
    actual = [portable_metadata(e) for e in snapshot['entries']]
    prior = [portable_metadata(e) for e in expected['entries']]
    require(actual == prior, 'Source entry metadata changed since fresh review')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--held-paths', type=Path, required=True, help='JSON array of {projectId,relativeRoot} from the fresh database snapshot')
    parser.add_argument('--reads-root', type=Path, choices=[Path('/mnt/reads'), Path('/tsl/data/reads')], default=Path('/mnt/reads'))
    args = parser.parse_args()
    started = datetime.now(timezone.utc).isoformat(); baseline = load_baseline(args.baseline)
    protected = held_paths(json.loads(args.held_paths.read_text()))
    mount = inspect_mount(args.reads_root); held_before = check_held(args.reads_root, protected)
    projects = []
    for item in baseline['projects']:
        current = scan_tree(args.reads_root, item); compare_historical(current, item); projects.append(current)
    # Verify every first observation again after collecting all six trees.
    for item in projects:
        compare_fresh(scan_tree(args.reads_root, item), item)
    require(check_held(args.reads_root, protected) == held_before, 'Protected root metadata changed during inventory')
    require(inspect_mount(args.reads_root) == mount, 'Reads mount changed during inventory')
    print(json.dumps({'kind': 'kamoun-direct-disposal-inventory-v1', 'success': True, 'startedAt': started,
                      'at': datetime.now(timezone.utc).isoformat(), 'baselineSha256': BASELINE_SHA256,
                      'datastoreRoot': str(args.reads_root), 'mount': mount, 'projects': projects,
                      'heldPaths': protected, 'heldObservations': held_before,
                      'regularFiles': 1217, 'regularBytes': 790004575062, 'symlinks': 1,
                      'historicalPathsTypesAndSizesMatched': True, 'sourceMetadataStable': True,
                      'databaseWrites': 0, 'payloadWrites': 0, 'awsOperations': 0}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('INVENTORY STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
