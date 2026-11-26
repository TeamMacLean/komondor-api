#!/usr/bin/env python3
"""Read-only Gulnara hashes. Writes only fresh local evidence, never Mongo/S3/payloads."""
import argparse
import collections
import datetime
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

PROJECT = '6ae4ac89a6b876c643741d27'
ROOT = '/mnt/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq'
FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def metadata(value):
    # Nanosecond timestamps exceed JavaScript's exact integer range. Keep all
    # stat fields as decimal strings so the later Node importer can use BigInt.
    return {name[3:]: str(getattr(value, name)) for name in FIELDS}


def canonical(value):
    require(isinstance(value, str) and value.startswith('/') and os.path.normpath(value) == value, 'Noncanonical absolute path')
    return value


def open_safe(value, directory=False):
    """Walk directory descriptors; neither ancestors nor the leaf may be symlinks."""
    canonical(value)
    parts = Path(value).parts[1:]
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW
            if index < len(parts) - 1 or directory:
                flags |= os.O_DIRECTORY
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode), 'Unexpected file type: ' + value)
        return fd
    except BaseException:
        os.close(fd)
        raise


def current_metadata(value):
    fd = open_safe(value)
    try:
        return metadata(os.fstat(fd))
    finally:
        os.close(fd)


def read_small(value, maximum=1024 * 1024):
    fd = open_safe(value)
    try:
        before = metadata(os.fstat(fd))
        require(int(before['size']) <= maximum, 'Small evidence file exceeds limit')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(maximum + 1)
        require(len(data) == int(before['size']), 'Evidence size changed while reading')
        require(metadata(os.fstat(fd)) == before == current_metadata(value), 'Evidence changed while reading')
        return data, before
    finally:
        os.close(fd)


def validate_review(review, root=ROOT):
    canonical(root)
    require(review.get('kind') == 'gulnara-md5-sidecar-readonly-review' and review.get('projectId') == PROJECT, 'Wrong reviewed project')
    require(review.get('coverageComplete') is True and review.get('conflicts') == [], 'Sidecar review incomplete/conflicted')
    require(review.get('fastqCount') == 24 and review.get('sidecarCount') == 16, 'Wrong declared scope')
    fastqs, sidecars = review['fastqs'], review['sidecars']
    require(len(fastqs) == 24 and len(sidecars) == 16, 'Wrong actual scope')
    require(re.fullmatch('[a-f0-9]{64}', review['copyManifestSha256']) is not None, 'Missing copy manifest digest')
    ids, paths, sample_paths = set(), set(), {}
    for row in fastqs + sidecars:
        for key in ('fileId', 'sampleId'):
            require(re.fullmatch('[a-f0-9]{24}', row[key]) is not None, 'Invalid identity')
        filename = canonical(row['path'])
        require(filename.startswith(root + '/'), 'Path outside reviewed project')
        require(row['fileId'] not in ids and filename not in paths, 'Duplicate file identity/path')
        ids.add(row['fileId']); paths.add(filename)
        require(type(row['bytes']) is int and row['bytes'] > 0, 'Invalid size')
        sample_dir = filename[len(root) + 1:].split('/')[0]
        require(sample_paths.setdefault(row['sampleId'], sample_dir) == sample_dir, 'Sample path identity differs')
        digest = row['sealedSha256'] if row in fastqs else row['sha256']
        require(re.fullmatch('[a-f0-9]{64}', digest) is not None, 'Invalid SHA256')
    require(len(sample_paths) == len(set(sample_paths.values())) == 12, 'Expected twelve distinct samples')
    by_sample = collections.defaultdict(list)
    for row in sidecars:
        require(Path(row['path']).name == 'MD5.txt' and row['bytes'] <= 65536, 'Unexpected sidecar')
        by_sample[row['sampleId']].append(row['fileId'])
    pairs = collections.defaultdict(list)
    for row in fastqs:
        require(re.fullmatch('[a-f0-9]{32}', row['expectedMd5FromSidecars']) is not None, 'Invalid expected MD5')
        require(sorted(row['sidecarFileIds']) == sorted(by_sample[row['sampleId']]), 'Sidecar mapping differs or duplicates')
        require(len(row['sidecarFileIds']) in (1, 2), 'Missing sidecar mapping')
        match = re.fullmatch(r'(.+)_([12])\.f(?:ast)?q\.gz', Path(row['path']).name)
        require(match is not None, 'Unexpected FASTQ basename')
        pairs[row['sampleId']].append((match.group(1), match.group(2)))
    require(len(pairs) == 12 and all(len(p) == 2 and p[0][0] == p[1][0] and {x[1] for x in p} == {'1', '2'} for p in pairs.values()), 'FASTQ pairing differs')


def parse_sidecar(data):
    values = {}
    for line in data.decode('ascii').splitlines():
        match = re.fullmatch(r'([a-fA-F0-9]{32})[ \t]+\*?([A-Za-z0-9_.-]+)', line)
        require(match is not None, 'Malformed sidecar line')
        digest, name = match.group(1).lower(), match.group(2)
        require(name not in values, 'Duplicate sidecar filename')
        values[name] = digest
    require(len(values) == 2, 'Expected two FASTQ names in sidecar')
    return values


def hash_fastq(row, progress=None, chunk_size=8 * 1024 * 1024, after_chunk=None):
    fd = open_safe(row['path'])
    try:
        before = metadata(os.fstat(fd))
        require(int(before['size']) == row['bytes'], 'FASTQ size differs before hashing')
        md5, sha256, total, notified = hashlib.md5(usedforsecurity=False), hashlib.sha256(), 0, 0
        with os.fdopen(os.dup(fd), 'rb') as stream:
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk); md5.update(chunk); sha256.update(chunk)
                if after_chunk:
                    after_chunk(total)
                if progress and total - notified >= 256 * 1024 * 1024:
                    progress(total); notified = total
        require(metadata(os.fstat(fd)) == before == current_metadata(row['path']), 'FASTQ metadata changed while hashing')
        result = {'bytes': total, 'md5': md5.hexdigest(), 'sha256': sha256.hexdigest(), 'metadata': before}
        require(total == row['bytes'], 'FASTQ size mismatch')
        require(result['sha256'] == row['sealedSha256'], 'FASTQ SHA256 mismatch')
        require(result['md5'] == row['expectedMd5FromSidecars'], 'FASTQ MD5 mismatch against sidecars')
        return result
    finally:
        os.close(fd)


def run(input_path, output_path, input_sha256, root=ROOT, announce=None):
    input_path, output_path = canonical(input_path), canonical(output_path)
    require(not output_path.startswith(root + '/') and output_path != root, 'Evidence cannot be written into the project')
    require(not any(output_path == p or output_path.startswith(p + '/') for p in ('/mnt/reads', '/tsl/data/reads')), 'Evidence must be outside the reads datastore')
    data, input_meta = read_small(input_path)
    require(hashlib.sha256(data).hexdigest() == input_sha256, 'Reviewed input SHA256 differs')
    review = json.loads(data); validate_review(review, root)
    parent = open_safe(str(Path(output_path).parent), directory=True)
    try:
        os.mkdir(Path(output_path).name, 0o700, dir_fd=parent)
        out = os.open(Path(output_path).name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)
    progress_fd = None
    verified, sidecar_receipts, active = [], [], None
    def save(name, value):
        content = (json.dumps(value, indent=2) + '\n').encode()
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=out)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.fsync(out)
        return hashlib.sha256(content).hexdigest()
    def event(kind, **fields):
        value = {'at': now(), 'event': kind, **fields}
        os.write(progress_fd, (json.dumps(value) + '\n').encode()); os.fsync(progress_fd)
        if announce:
            announce(value)
    try:
        require(os.fstat(out).st_uid == os.getuid() and stat.S_IMODE(os.fstat(out).st_mode) == 0o700, 'Evidence directory is not private')
        progress_fd = os.open('progress.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=out)
        save('started.json', {'at': now(), 'projectId': PROJECT, 'inputSha256': input_sha256, 'inputPath': input_path, 'root': root, 'fastqs': 24, 'sidecars': 16, 'databaseWrites': False, 'payloadWrites': False})
        for row in review['sidecars']:
            active = row['fileId']; content, observed = read_small(row['path'], 65536)
            require(len(content) == row['bytes'] and hashlib.sha256(content).hexdigest() == row['sha256'], 'Sidecar size/SHA256 differs')
            expected = {Path(f['path']).name: f['expectedMd5FromSidecars'] for f in review['fastqs'] if row['fileId'] in f['sidecarFileIds']}
            require(parse_sidecar(content) == expected, 'Sidecar MD5 mapping differs')
            record = {**row, 'at': now(), 'kind': 'sidecar-own-byte-digest', 'calculatedMd5': hashlib.md5(content, usedforsecurity=False).hexdigest(), 'calculatedSha256': hashlib.sha256(content).hexdigest(), 'metadata': observed, 'mappingVerified': True}
            digest = save('sidecar-' + row['fileId'] + '.json', record); sidecar_receipts.append({'record': record, 'receiptSha256': digest})
        event('sidecars-verified', count=16)
        for index, row in enumerate(review['fastqs']):
            active = row['fileId']; event('fastq-started', fileId=active, index=index + 1, totalFiles=24)
            result = hash_fastq(row, progress=lambda count: event('fastq-progress', fileId=row['fileId'], bytesRead=count, expectedBytes=row['bytes']))
            record = {**row, **result, 'at': now(), 'verified': True, 'inputSha256': input_sha256}
            digest = save('fastq-' + active + '.json', record); verified.append({'record': record, 'receiptSha256': digest})
            event('fastq-verified', fileId=active, filesVerified=len(verified), bytesVerified=sum(x['record']['bytes'] for x in verified))
        for item in sidecar_receipts + verified:
            require(current_metadata(item['record']['path']) == item['record']['metadata'], 'Previously checked file changed before completion')
        require(current_metadata(input_path) == input_meta, 'Reviewed input changed during hashing')
        completed = {'at': now(), 'kind': 'gulnara-independent-md5-sha256-completion', 'projectId': PROJECT, 'inputSha256': input_sha256, 'copyManifestSha256': review['copyManifestSha256'], 'allVerified': True, 'fastqCount': 24, 'sidecarCount': 16, 'bytes': sum(x['record']['bytes'] for x in verified), 'fastqs': verified, 'sidecars': sidecar_receipts, 'databaseWrites': False, 'payloadWrites': False, 'sidecarProvenance': 'Preserved historical sidecars; not authenticated provider provenance.'}
        event('all-files-verified', filesVerified=24, bytesVerified=completed['bytes']); save('completed.json', completed)
        return completed
    except BaseException as error:
        save('failed.json', {'at': now(), 'allVerified': False, 'projectId': PROJECT, 'inputSha256': input_sha256, 'activeFileId': active, 'verifiedFastqs': len(verified), 'verifiedSidecars': len(sidecar_receipts), 'error': str(error), 'errorType': type(error).__name__})
        raise
    finally:
        if progress_fd is not None:
            os.close(progress_fd)
        os.close(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True); parser.add_argument('--input-sha256', required=True)
    parser.add_argument('--output', required=True); parser.add_argument('--execute-read-only', action='store_true', required=True)
    args = parser.parse_args()
    run(args.input, args.output, args.input_sha256, announce=lambda value: print(json.dumps(value), flush=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error), 'type': type(error).__name__}), file=sys.stderr, flush=True)
        sys.exit(1)
