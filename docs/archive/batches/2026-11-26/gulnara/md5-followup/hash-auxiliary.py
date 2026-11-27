#!/usr/bin/env python3
"""Read-only source-to-copy MD5 proof for the seven legacy auxiliary Reads."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat

FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_uid', 'st_gid',
          'st_size', 'st_mtime_ns', 'st_ctime_ns')
SOURCE_ROOTS = {
    '/mnt/reads/ntalbot/lichen_coculture_i_2_days',
    '/mnt/reads/ntalbot/lichen_coculture_i_9_days',
    '/mnt/reads/ntalbot/lichen_coculture_i_21_days',
    '/mnt/reads/ntalbot/lichen_coculture_i_42_days',
}
DESTINATION = '/mnt/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq'


def metadata(s):
    return {k[3:]: str(getattr(s, k)) for k in FIELDS}


def inspect(p, expected):
    p = Path(p)
    if not p.is_absolute() or '..' in p.parts or p.name != 'MD5.txt':
        raise ValueError('Unsafe sidecar path')
    for parent in [*reversed(p.parents), p]:
        if parent.is_symlink():
            raise ValueError('Symlink in sidecar path')
    before = p.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size != expected['bytes'] or before.st_size > 65536:
        raise ValueError('Unexpected sidecar size or type')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if metadata(os.fstat(fd)) != metadata(before):
            raise ValueError('Opened file differs')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(65537)
        if metadata(os.fstat(fd)) != metadata(before) or metadata(p.lstat()) != metadata(before):
            raise ValueError('Sidecar changed while reading')
    finally:
        os.close(fd)
    sha = hashlib.sha256(data).hexdigest()
    if len(data) != expected['bytes'] or sha != expected['sha256']:
        raise ValueError('Sidecar differs from sealed manifest')
    return {'path': str(p), 'bytes': len(data), 'sha256': sha,
            'md5': hashlib.md5(data).hexdigest(), 'metadata': metadata(before)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    scope_bytes = Path(args.scope).read_bytes()
    rows = json.loads(scope_bytes)
    if len(rows) != 7 or len({x['readId'] for x in rows}) != 7 or len({x['fileId'] for x in rows}) != 7:
        raise ValueError('Exactly seven unique auxiliary Reads required')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    results = []
    for row in rows:
        if not any(row['source'].startswith(root + '/') for root in SOURCE_ROOTS):
            raise ValueError('Source outside reviewed projects')
        if not row['destination'].startswith(DESTINATION + '/'):
            raise ValueError('Destination outside reviewed project')
        source = inspect(row['source'], row)
        destination = inspect(row['destination'], row)
        if (source['metadata']['dev'], source['metadata']['ino']) == (destination['metadata']['dev'], destination['metadata']['ino']):
            raise ValueError('Source and copy must be independent inodes')
        if source['md5'] != destination['md5']:
            raise ValueError('Source-to-copy MD5 mismatch')
        results.append({k: row[k] for k in ('readId', 'fileId', 'runId', 'sampleId')} |
                       {'sourcePath': source['path'], 'destinationPath': destination['path'],
                        'bytes': source['bytes'], 'expectedMd5': source['md5'],
                        'calculatedMd5': destination['md5'], 'sourceSha256': source['sha256'],
                        'destinationSha256': destination['sha256'],
                        'sourceMetadata': source['metadata'], 'destinationMetadata': destination['metadata'],
                        'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'expectedSource': 'retained-original-sidecar'})
    output = {'kind': 'gulnara-auxiliary-source-copy-md5-proof', 'startedAt': started,
              'projectId': '6ae4ac89a6b876c643741d27',
              'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scopeSha256': hashlib.sha256(scope_bytes).hexdigest(),
              'allVerified': True, 'count': 7, 'files': results}
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(output, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({'complete': True, 'count': 7, 'output': args.output}))


if __name__ == '__main__':
    main()
