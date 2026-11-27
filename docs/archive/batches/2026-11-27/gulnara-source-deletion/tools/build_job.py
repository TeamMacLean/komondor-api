#!/usr/bin/env python3
"""Build one exact four-source Slurm pack from reviewed read-only evidence.
Never submit a job, delete payloads, access AWS or write production metadata.
"""
import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gulnara_runner', HERE / 'delete-gulnara-reviewed.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
sha = lambda raw: hashlib.sha256(raw).hexdigest()
iso = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
require = runner.require


def build(review, out):
    raw = {name: (review / name).read_bytes() for name in
           ('summary.json', 'preflight.json', 'destination-check.json', 'hold-release.json')}
    summary, pre, copied, released = [json.loads(raw[name]) for name in
                                     ('summary.json', 'preflight.json', 'destination-check.json', 'hold-release.json')]
    require(summary.get('success') is True and summary['total'] == summary['passed'] == 4
            and summary['failed'] == [] and summary['sourceDatabaseUnchanged'] is True
            and summary['protectedDatabaseUnchanged'] is True, 'Native review incomplete')
    require(summary['mount'] == pre['mount'] and summary['apiHead'] == pre['apiHead'], 'Review identity changed')
    require(summary['mount']['target'] == '/mnt/reads'
            and summary['mount']['source'] == 'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads'
            and summary['mount']['fstype'].startswith('nfs'), 'Unreviewed source mount')
    candidates = {p['projectId']: p for p in pre['projects']}
    require(len(candidates) == len(pre['projects']) == 4 and set(candidates) == set(runner.TARGETS), 'Wrong source scope')
    final = {p['projectId']: p for p in summary['finalProjects']}
    require(len(final) == len(summary['finalProjects']) == 4 and set(final) == set(runner.TARGETS), 'Missing final source check')
    catalogue = json.loads((review / 'catalogue-final.json').read_bytes())
    require(catalogue == summary['catalogue'] and catalogue['success'] is True and catalogue['issues'] == []
            and catalogue['sourceProjects'] == 4 and catalogue['sourceManifestFiles'] == 452
            and catalogue['candidateFilesInCatalogue'] == catalogue['checkedReferences'] == 412
            and catalogue['movedFilesNowInDestination'] == 40, 'Reassigned catalogue coverage differs')
    projects = []
    source_entries = {}
    for pid, expected_root in sorted(runner.TARGETS.items(), key=lambda row: row[1]):
        r = candidates[pid]
        require(r['hpcPath'] == '/mnt/reads/' + expected_root, 'Wrong source canonical path')
        require(final[pid]['preservation']['active'] is False and final[pid]['preservation']['invalid'] is False,
                'Source preservation blocks deletion')
        before = json.loads((review / (pid + '-before.json')).read_bytes())['project']
        require(before['_id'] == pid and before['archiveMigration']['id'] == r['migrationId'], 'Before snapshot identity differs')
        require(before['storage']['state'] == 'aws_pending_hpc_deletion'
                and before['archiveMigration']['phase'] == 'verified'
                and before['archiveMigration']['sourceRoot'] == r['hpcPath'], 'Source state differs')
        result = json.loads((review / pid / 'result.json').read_bytes())
        require(result['reviewPassed'] is True and result['exitCode'] == 0 and not result['stderr']
                and not result['uncopied'], 'Native source review failed')
        require(result['stdout'].splitlines().count("rm -rf -- '" + r['hpcPath'] + "'") == 1, 'Native path differs')
        source = (review / pid / 'source-manifest.v1.json').read_bytes()
        verified = (review / pid / 'verification-report.v1.json').read_bytes()
        require(sha(source) == r['sourceSha256'] and sha(verified) == r['verificationSha256'], 'Sealed controls differ')
        manifest, verification = json.loads(source), json.loads(verified)
        require(manifest['projectId'] == pid and manifest['migrationId'] == r['migrationId']
                and manifest['sourceRoot'] == r['hpcPath'] and manifest['sourceRelativeRoot'] == expected_root
                and manifest['dataPrefix'] == r['s3Uri'], 'Sealed source identity differs')
        require(verification['verified'] is True and verification['sourceManifestSha256'] == r['sourceSha256']
                and verification['projectId'] == pid and verification['migrationId'] == r['migrationId'], 'Sealed verification differs')
        heads = {}
        for line in (review / pid / 'heads.jsonl').read_text().splitlines():
            record = json.loads(line)
            if record['head']:
                if record['key'] in heads:
                    require(heads[record['key']].get('VersionId') == record['head'].get('VersionId'),
                            'S3 object version changed during review')
                heads[record['key']] = record['head']
        files = []
        for entry in manifest['entries']:
            if entry['type'] == 'dir':
                continue
            require(entry['type'] == 'file' and entry['disposition'] == 'copy', 'Unarchived source file')
            head = heads[entry['s3Key']]
            require(head.get('VersionId') not in (None, '', 'null'), 'Missing current S3 version')
            require(head['ContentLength'] == entry['size'] and head['ChecksumCRC64NVME'] == entry['crc64nvme']
                    and head['ChecksumType'] == 'FULL_OBJECT' and head['StorageClass'] == 'DEEP_ARCHIVE', 'Current S3 bytes/checksum differ')
            for key, value in [('komondor-project-id', pid), ('komondor-migration-id', r['migrationId']),
                               ('komondor-source-manifest-sha256', r['sourceSha256']), ('komondor-entry-sha256', entry['sha256'])]:
                require(head['Metadata'][key] == value, 'Current S3 ownership differs')
            original_path = r['hpcPath'] + '/' + entry['relPath']
            require(original_path not in source_entries, 'Duplicate original source entry')
            source_entries[original_path] = entry
            files.append({'path': entry['relPath'], 'bytes': entry['size'], 'mtimeMs': entry['mtimeMs'],
                          'ctimeMs': entry['ctimeMs'], 'ino': entry['ino']})
        require(len(files) == r['fileCount'] and sum(f['bytes'] for f in files) == r['bytes'], 'Source coverage differs')
        projects.append({'projectId': pid, 'name': r['name'], 'relativeRoot': expected_root,
                         'hpcPath': '/tsl/data/reads/' + expected_root, 's3Uri': r['s3Uri'], 'migrationId': r['migrationId'],
                         'sourceSha256': r['sourceSha256'], 'verificationSha256': r['verificationSha256'],
                         's3VerifiedAt': r['s3VerifiedAt'], 'fileCount': len(files), 'bytes': r['bytes'],
                         'nativeReviewPassed': True, 'nativeReviewAt': result['finishedAt'], 'files': files})
    require(sum(p['fileCount'] for p in projects) == 452, 'Unexpected total source files')
    reviewed = iso(summary['at']); now = dt.datetime.now(dt.timezone.utc)
    require(reviewed <= now and (now - reviewed).total_seconds() <= 1800, 'Native final review is over 30 minutes old')
    require(iso(copied['at']) <= now and (now - iso(copied['at'])).total_seconds() <= 1800,
            'Destination review is over 30 minutes old')
    expires = min(reviewed, iso(copied['at'])) + dt.timedelta(hours=6)
    protected = []
    for entry in copied['entries']:
        destination = Path(entry['destination'])
        destination_root = Path('/mnt/reads') / runner.DESTINATION
        rel = destination.relative_to(destination_root).as_posix()
        runner.relative(rel)
        require(entry['stage'] == str(Path('/mnt/reads') / runner.STAGING / rel), 'Staging path differs')
        require(any(entry['source'].startswith('/mnt/reads/' + root + '/') for root in runner.TARGETS.values()),
                'Copy source outside approved originals')
        source_entry = source_entries[entry['source']]
        require(entry['bytes'] == source_entry['size'] and entry['sha256'] == source_entry['sha256'],
                'Copy receipt differs from sealed source')
        source_meta, metadata, stage_meta = [entry[key] for key in ('sourceMetadata', 'destinationMetadata', 'stageMetadata')]
        require(all(source_meta[key] == source_entry[key] for key in ('ino', 'mtimeMs', 'ctimeMs')),
                'Original source metadata differs from sealed manifest')
        require(metadata['ino'] == stage_meta['ino'] and metadata['ino'] != source_meta['ino'], 'Source/copy inode protection differs')
        require(metadata['size'] == stage_meta['size'] == entry['bytes'], 'Protected copy size differs')
        require(metadata['nlink'] == stage_meta['nlink'] == 2, 'Protected link count differs')
        require(all(metadata[key] == stage_meta[key] for key in ('mtimeMs', 'ctimeMs')), 'Staging metadata differs')
        protected.append({'path': rel, 'bytes': entry['bytes'], 'ino': metadata['ino'], 'nlink': metadata['nlink'],
                          'mtimeMs': metadata['mtimeMs'], 'ctimeMs': metadata['ctimeMs']})
    plan = {'kind': 'komondor-reviewed-hpc-deletion-v1', 'hpcRoot': '/tsl/data/reads', 'stage': 'gulnara-four-sources',
            'releaseStatus': 'ready-for-user-submission', 'reviewCompletedAt': summary['at'], 'expiresAt': expires.isoformat(),
            'apiHead': summary['apiHead'], 'reviewSummarySha256': sha(raw['summary.json']),
            'destinationCheckSha256': sha(raw['destination-check.json']), 'holdReleaseSha256': sha(raw['hold-release.json']),
            'held': [{'projectId': pid, 'relativeRoot': root} for pid, root in runner.HELD.items()],
            'protectedRoots': sorted(runner.PROTECTED_ROOTS), 'protectedFiles': protected, 'projects': projects}
    plan_bytes = (json.dumps(plan, indent=2) + '\n').encode()
    replacements = {'PLAN_SHA256': sha(plan_bytes), 'REVIEW_SHA256': plan['reviewSummarySha256'],
                    'DESTINATION_SHA256': plan['destinationCheckSha256'], 'RELEASE_SHA256': plan['holdReleaseSha256']}
    code = (HERE / 'delete-gulnara-reviewed.py').read_text()
    for key, value in replacements.items():
        token = '__' + key + '__'; require(code.count(token) == 1, 'Runner token missing/duplicated')
        code = code.replace(token, value); setattr(runner, key, value)
    runner.check_stage(plan)
    runner.check_release_evidence(plan, review)
    runner.fresh(plan)
    compile(code, 'delete-reviewed-projects.py', 'exec')
    out.mkdir(parents=True, exist_ok=False)
    (out / 'deletion-plan.json').write_bytes(plan_bytes)
    (out / 'delete-reviewed-projects.py').write_text(code)
    for name in ('summary.json', 'destination-check.json', 'hold-release.json'):
        (out / name).write_bytes(raw[name])
    wrapper = (HERE.parents[1] / 'hpc-slurm-two-project-test/remaining-167-released/delete.sbatch').read_text()
    wrapper = wrapper.replace('komondor-remaining-167', 'komondor-gulnara-4')
    wrapper = wrapper.replace('bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7', replacements['PLAN_SHA256'])
    require('--sha256 ' + replacements['PLAN_SHA256'] in wrapper and '--dependency' not in wrapper, 'Unexpected Slurm wrapper')
    (out / 'delete.sbatch').write_text(wrapper)
    (out / 'HPC_PATHS.txt').write_text(''.join(p['hpcPath'] + '\n' for p in projects))
    (out / 'HELD_PATHS.txt').write_text(''.join('/tsl/data/reads/' + root + '\n' for root in sorted(runner.PROTECTED_ROOTS)))
    with (out / 'PROJECTS.tsv').open('w') as handle:
        writer = csv.writer(handle, delimiter='\t'); columns = ['projectId', 'name', 'hpcPath', 'bytes', 'fileCount', 's3Uri']
        writer.writerow(columns); writer.writerows([[p[key] for key in columns] for p in projects])
    (out / 'README.md').write_text(f'''# Reviewed Gulnara four-source deletion

Exactly four old Lichen CoCulture source Projects; {sum(p['fileCount'] for p in projects):,} files;
{sum(p['bytes'] for p in projects):,} bytes. George elected to proceed without waiting
for Gulnara's reply. This releases only the four documented manual source exclusions.
Gargy, the Xanthoria destination, all 40 destination/staging copies and all S3 objects
remain protected. No database hold fields or archive metadata are edited by this job.

Source review completed {summary['at']}; destination verification {copied['at']}.
This package refuses to delete after **{expires.isoformat()}**. Keep source trees,
destination/staging copies and preservation decisions unchanged while queued/running.
The job checks sealed local evidence; it cannot query live MongoDB from the HPC.

One node, one task, one CPU, 1 GB, two-hour limit. From this private HPC directory,
George runs `sha256sum -c SHA256SUMS`, `sbatch --test-only delete.sbatch`, then
`sbatch delete.sbatch` if accepted. The software node can copy the package;
submission belongs on the Slurm submission node. No automatic submission occurs.

All four originals are checked before the first deletion, then again before each
removal. The destination and staging files are checked for exact copied inode,
size, timestamps and link count before and after each source removal. No payload
checksum sweep is repeated inside the job; fresh native and copy checks precede it.

Preserve `komondor-gulnara-4-JOBID.log` and `deletion-JOBID.jsonl`. On any failure,
inspect the stopped/partial state before continuing; never rerun blindly. After
success, independently prove all four roots absent and use native confirm-absent
before the website records AWS-only. Keep all source S3 snapshots unchanged.
''')
    names = sorted(p.name for p in out.iterdir() if p.is_file())
    (out / 'SHA256SUMS').write_text(''.join(sha((out / name).read_bytes()) + '  ' + name + '\n' for name in names))
    return {'output': str(out), 'projects': 4, 'files': sum(p['fileCount'] for p in projects),
            'bytes': sum(p['bytes'] for p in projects), 'planSha256': sha(plan_bytes),
            'reviewCompletedAt': summary['at'], 'expiresAt': expires.isoformat(), 'submitted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.review, args.out), indent=2))


if __name__ == '__main__':
    main()
