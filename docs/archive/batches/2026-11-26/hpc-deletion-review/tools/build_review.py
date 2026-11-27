#!/usr/bin/env python3
"""Independently validate downloaded evidence before producing plain path lists."""
import datetime as dt
import hashlib
import json
import pathlib
import sys


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load(p):
    return json.loads(p.read_text())


def checked_path(relative):
    assert isinstance(relative, str) and relative and not relative.startswith('/')
    assert not any(ord(c) < 32 or ord(c) == 127 or c == '\\' for c in relative)
    pieces = relative.split('/')
    assert len(pieces) >= 2 and all(p and p not in ('.', '..') for p in pieces)
    return '/tsl/data/reads/' + relative


def check_disjoint(paths):
    assert len(paths) == len(set(paths)), 'Duplicate targets'
    for a in paths:
        assert all(a == b or not (a.startswith(b + '/') or b.startswith(a + '/')) for b in paths)


def date(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def main(source, out):
    reg, holds, pre, final, cat = [load(source / p) for p in (
        'register.json', 'holds.json', 'preflight.json', 'final-review-r2.json', 'catalogue-final.json')]
    assert digest(source / 'register.json') == holds['sourceRegisterSha256']
    assert reg['count'] == len(reg['projects']) == 175
    assert final['total'] == 170
    assert not cat['issues']
    assert cat['candidateFilesInCatalogue'] == cat['checkedReferences'] == 14886
    assert len(cat['locations']) == 175
    assert all(p['locations']['hpc']['status'] == 'present' and p['locations']['aws']['status'] == 'verified' for p in cat['locations'])
    excluded = set(holds['excludedProjectIds'])
    assert len(excluded) == 5
    originals = {r['projectId']: r for r in reg['projects']}
    observed = {r['projectId']: r for r in pre['projects']}
    locations = {r['projectId']: r['locations'] for r in cat['locations']}
    assert len(observed) == 175
    assert {r['projectId'] for r in final['projects']} == set(originals) - excluded
    ready = []
    for result in final['projects']:
        if not result['passed']:
            continue
        pid = result['projectId']
        assert pid not in excluded
        r = originals[pid]
        pdir = source / pid
        native = load(pdir / 'result.json')
        reviewed = load(pdir / 'final-check-r2.json')
        assert native['exitCode'] == 0 and not native['stderr'].strip() and not native.get('error')
        assert reviewed['passed'] and not reviewed['preservation']['active'] and not reviewed['preservation']['invalid']
        assert reviewed['tree']['matches'] and not reviewed['multipart']
        assert digest(pdir / 'source-manifest.v1.json') == r['sourceSha256']
        assert digest(pdir / 'verification-report.v1.json') == r['verificationSha256']
        m = load(pdir / 'source-manifest.v1.json')
        v = load(pdir / 'verification-report.v1.json')
        assert str(m['projectId']) == pid and str(m['migrationId']) == r['migrationId']
        assert v['verified'] and v['sourceManifestSha256'] == r['sourceSha256']
        assert m['sourceRoot'] == r['hpcPath'] == '/mnt/reads/' + m['sourceRelativeRoot']
        target = checked_path(m['sourceRelativeRoot'])
        assert target == reviewed['hpcPath'] == result['hpcPath']
        assert target == locations[pid]['hpc']['uri']
        assert r['s3Uri'] == locations[pid]['aws']['uri']
        assert reviewed['vmPath'] == r['hpcPath']
        assert m['dataPrefix'] == r['s3Uri'] == reviewed['s3Uri']
        assert native['stdout'].splitlines()[-1] == "rm -rf -- '" + r['hpcPath'].replace("'", "'\\''") + "'"
        payload = [e for e in m['entries'] if e['disposition'] == 'copy']
        assert all(e['disposition'] == 'copy' or e['type'] == 'dir' for e in m['entries'])
        assert len(payload) == r['fileCount'] == reviewed['files']
        assert sum(e['size'] for e in payload) == r['bytes'] == reviewed['bytes']
        heads = {h['key']: h['head'] for h in map(json.loads, (pdir / 'heads.jsonl').read_text().splitlines())}
        for sample in reviewed['deepSamples']:
            current, previous = sample['head'], heads[sample['key']]
            assert current['VersionId'] == sample['versionId'] == previous['VersionId']
            for field in ('ContentLength', 'ChecksumCRC64NVME', 'ChecksumType', 'Metadata', 'ServerSideEncryption', 'ETag'):
                assert current[field] == previous[field]
        historical = {h['s3Key']: h for h in v['entries']}
        inventory = {e['Key']: e for e in reviewed['inventory']}
        assert set(inventory) == {e['s3Key'] for e in payload}
        for e in payload:
            h, old = heads[e['s3Key']], historical[e['s3Key']]
            metadata = {k.lower(): val for k, val in h['Metadata'].items()}
            assert h['ContentLength'] == old['contentLength'] == e['size'] == inventory[e['s3Key']]['Size']
            assert h['ETag'] == inventory[e['s3Key']]['ETag']
            assert date(h['LastModified']) == date(inventory[e['s3Key']]['LastModified'])
            assert h['ChecksumCRC64NVME'] == old['checksumCRC64NVME'] == e['crc64nvme']
            assert h['ChecksumType'] == 'FULL_OBJECT' and old['verified']
            assert metadata['komondor-project-id'] == pid
            assert metadata['komondor-migration-id'] == r['migrationId']
            assert metadata['komondor-source-manifest-sha256'] == r['sourceSha256']
            assert metadata['komondor-entry-sha256'] == e['sha256']
            assert h['VersionId'] and h['VersionId'] != 'null'
            assert h['ServerSideEncryption'] == 'AES256' and h['StorageClass'] == 'DEEP_ARCHIVE'
            assert date(h['LastModified']) <= date(r['s3VerifiedAt'])
        ready.append({**result, 'migrationId': r['migrationId'], 's3VerifiedAt': r['s3VerifiedAt']})
    assert len(ready) == final['passed']
    ready.sort(key=lambda r: r['hpcPath'])
    check_disjoint([r['hpcPath'] for r in ready])
    protected = [checked_path(originals[pid]['hpcPath'].removeprefix('/mnt/reads/')) for pid in excluded]
    check_disjoint([r['hpcPath'] for r in ready] + protected)
    for pid in final['representatives']:
        r = load(source / pid / 'final-check-r2.json')
        assert r['passed'] and r['deepSamples']
    out.mkdir(parents=True, exist_ok=True)
    def write(name, text):
        with (out / name).open('x') as f:
            f.write(text)
    write('HPC_PATHS.txt', ''.join(r['hpcPath'] + '\n' for r in ready))
    write('HELD_PATHS.txt', ''.join(p + '\n' for p in sorted(protected)))
    write('PROJECTS.tsv', 'project_id\tname\thpc_path\tbytes\tfiles\ts3_verified_at\treviewed_at\n' + ''.join('\t'.join(str(r[k]).replace('\t', ' ').replace('\n', ' ') for k in ('projectId', 'name', 'hpcPath', 'bytes', 'files', 's3VerifiedAt', 'at')) + '\n' for r in ready))
    result = {'reviewedAt': final['at'], 'projects': len(ready), 'bytes': sum(r['bytes'] for r in ready), 'files': sum(r['files'] for r in ready), 'heldProjectIds': sorted(excluded), 'blocked': final['failed'], 'apiHead': final['apiHead'], 'targetsSha256': digest(out / 'HPC_PATHS.txt'), 'independentEvidenceValidationPassed': True, 'deletionPerformed': False, 'finalizationPerformed': False}
    write('REVIEW.json', json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        assert checked_path('group/Mixed_case') == '/tsl/data/reads/group/Mixed_case'
        for bad in ('', '/group/project', 'group', 'group/../project', 'group//project', 'group/project\nother', 'group/./project'):
            try:
                checked_path(bad)
            except AssertionError:
                pass
            else:
                raise AssertionError('Accepted unsafe path: ' + repr(bad))
        for paths in (['/a', '/a'], ['/a', '/a/b']):
            try:
                check_disjoint(paths)
            except AssertionError:
                pass
            else:
                raise AssertionError('Accepted overlapping targets')
        print('Path safety tests passed')
    else:
        assert len(sys.argv) == 3
        main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
