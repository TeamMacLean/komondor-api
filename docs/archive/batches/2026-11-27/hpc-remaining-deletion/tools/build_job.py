#!/usr/bin/env python3
"""Build the user-submitted Slurm pack only after all native reviews pass."""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import shutil
import tarfile

PILOT = '5fc012bda3efcb29338b7d4b'

def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--prior-evidence', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    root = args.review
    read = lambda p: json.loads((root / p).read_text())
    summary, pre, register, holds = [read(p) for p in ['summary.json', 'preflight.json', 'register.json', 'holds.json']]
    assert summary['total'] == summary['passed'] == 169 and not summary['failed']
    assert summary['mount'] == pre['mount'] and summary['apiHead'] == pre['apiHead']
    assert sha((root / 'register.json').read_bytes()) == holds['sourceRegisterSha256']
    catalogue = read('catalogue-final.json')
    assert not catalogue['issues'] and catalogue['apiHead'] == summary['apiHead']
    assert catalogue['projects'] == 174
    excluded = set(holds['excludedProjectIds']); assert len(excluded) == 5
    candidates = {p['projectId']: p for p in pre['projects'] if not p['excluded']}
    assert len(candidates) == 169 and PILOT not in candidates and not excluded.intersection(candidates)
    assert catalogue['candidateFilesInCatalogue'] == catalogue['checkedReferences'] == sum(p['fileCount'] for p in candidates.values())
    final = {p['projectId']: p for p in summary['finalProjects']}
    assert final['5fc012bda3efcb29338b7d58']['preservation']['active']
    for pid in candidates:
        assert not final[pid]['preservation']['active'] and not final[pid]['preservation']['invalid']
    with tarfile.open(args.prior_evidence) as prior:
        members = {m.name: m for m in prior.getmembers()}
        prefix = next(n[:-len('/register.json')] for n in members if n.endswith('/register.json'))
        projects = []
        for pid, r in sorted(candidates.items(), key=lambda pair: pair[1]['hpcPath']):
            result = read(pid + '/result.json')
            assert result['reviewPassed'] is True and result['exitCode'] == 0 and not result['stderr'] and not result['uncopied']
            assert "rm -rf -- '" + r['hpcPath'] + "'" in result['stdout'].splitlines()
            source = (root / pid / 'source-manifest.v1.json').read_bytes()
            verified = (root / pid / 'verification-report.v1.json').read_bytes()
            assert sha(source) == r['sourceSha256'] and sha(verified) == r['verificationSha256']
            m, v = json.loads(source), json.loads(verified)
            assert v['verified'] and v['sourceManifestSha256'] == r['sourceSha256']
            assert m['projectId'] == pid and m['migrationId'] == r['migrationId']
            assert m['sourceRoot'] == r['hpcPath'] == '/mnt/reads/' + m['sourceRelativeRoot']
            heads = {h['key']: h['head'] for h in map(json.loads, (root/pid/'heads.jsonl').read_text().splitlines()) if h['head']}
            oldheads = {h['key']: h['head'] for h in map(json.loads, prior.extractfile(prefix+'/'+pid+'/heads.jsonl').read().decode().splitlines()) if h['head']}
            files = []
            for e in m['entries']:
                if e['type'] == 'dir':
                    continue
                assert e['type'] == 'file' and e['disposition'] == 'copy'
                h = heads[e['s3Key']]; old = oldheads[e['s3Key']]
                assert h['VersionId'] == old['VersionId'] and h['VersionId'] not in ('null', '')
                assert h['ContentLength'] == e['size'] and h['ChecksumCRC64NVME'] == e['crc64nvme']
                assert h['ChecksumType'] == 'FULL_OBJECT' and h['StorageClass'] == 'DEEP_ARCHIVE'
                assert h['Metadata']['komondor-project-id'] == pid
                assert h['Metadata']['komondor-migration-id'] == r['migrationId']
                assert h['Metadata']['komondor-source-manifest-sha256'] == r['sourceSha256']
                assert h['Metadata']['komondor-entry-sha256'] == e['sha256']
                files.append({'path': e['relPath'], 'bytes': e['size'], 'mtimeMs': e['mtimeMs'], 'ctimeMs': e['ctimeMs'], 'ino': e['ino']})
            assert len(files) == r['fileCount'] and sum(f['bytes'] for f in files) == r['bytes']
            projects.append({'projectId': pid, 'name': r['name'], 'relativeRoot': m['sourceRelativeRoot'],
                             'hpcPath': '/tsl/data/reads/'+m['sourceRelativeRoot'], 's3Uri': r['s3Uri'],
                             'migrationId': r['migrationId'], 'sourceSha256': r['sourceSha256'],
                             'verificationSha256': r['verificationSha256'], 's3VerifiedAt': r['s3VerifiedAt'],
                             'fileCount': len(files), 'bytes': r['bytes'], 'nativeReviewPassed': True,
                             'nativeReviewAt': result['finishedAt'], 'files': files})
    reviewed = dt.datetime.fromisoformat(summary['at'].replace('Z', '+00:00'))
    expires = reviewed + dt.timedelta(hours=6)
    assert dt.datetime.now(dt.timezone.utc) < expires, 'Review expired while building package'
    held = [{'projectId': p['projectId'], 'name': p['name'], 'relativeRoot': p['hpcPath'].removeprefix('/mnt/reads/')} for p in pre['projects'] if p['excluded']]
    assert len(held) == 5
    plan = {'kind': 'komondor-reviewed-hpc-deletion-v1', 'hpcRoot': '/tsl/data/reads',
            'reviewCompletedAt': summary['at'], 'expiresAt': expires.isoformat(), 'apiHead': summary['apiHead'],
            'reviewSummarySha256': sha((root/'summary.json').read_bytes()), 'held': held, 'projects': projects}
    args.out.mkdir(parents=True, exist_ok=False)
    raw = (json.dumps(plan, indent=2)+'\n').encode()
    (args.out/'deletion-plan.json').write_bytes(raw)
    plan_hash = sha(raw)
    shutil.copyfile(Path(__file__).with_name('delete-reviewed-projects.py'), args.out/'delete-reviewed-projects.py')
    (args.out/'HPC_PATHS.txt').write_text(''.join(p['hpcPath']+'\n' for p in projects))
    (args.out/'HELD_PATHS.txt').write_text(''.join('/tsl/data/reads/'+p['relativeRoot']+'\n' for p in held))
    with (args.out/'PROJECTS.tsv').open('w') as f:
        writer = csv.writer(f, delimiter='\t'); writer.writerow(['projectId','name','hpcPath','bytes','files','s3Uri'])
        for p in projects: writer.writerow([p['projectId'],p['name'],p['hpcPath'],p['bytes'],p['fileCount'],p['s3Uri']])
    script = '''#!/bin/bash
#SBATCH --job-name=komondor-hpc-delete
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=02:00:00
#SBATCH --output=komondor-hpc-delete-%j.log
set -euo pipefail
umask 077
cd -- "$SLURM_SUBMIT_DIR"
sha256sum -c SHA256SUMS
python3 delete-reviewed-projects.py --plan deletion-plan.json --sha256 PLAN_HASH --execute --log "deletion-${SLURM_JOB_ID}.jsonl"
'''.replace('PLAN_HASH', plan_hash)
    (args.out/'delete.sbatch').write_text(script)
    (args.out/'README.md').write_text(f'''# Reviewed manual HPC deletion batch

169 Projects; {sum(p['fileCount'] for p in projects):,} files; {sum(p['bytes'] for p in projects):,} bytes.
Plant Capture is already completed. The five paths in HELD_PATHS.txt are excluded.

Native archive/source checks completed {summary['at']}.
This job refuses to delete after {expires.isoformat()}; request a fresh review if delayed.
Keep these Project trees and preservation decisions unchanged during this window.
Do not submit concurrent copies of this job or run other deletion commands on these paths.

On the HPC, change into this folder, inspect HPC_PATHS.txt/PROJECTS.tsv and run:

```bash
sha256sum -c SHA256SUMS
sbatch delete.sbatch
```

Use your usual Slurm account/partition options if the cluster requires them.
Requires Python 3.7+ and GNU rm on the Linux HPC. Uses your existing permissions.
All targets are checked before deletion starts, then each is checked again just
before removal. Source path, inode, size, timestamps, unexpected files, symlinks
nested mounts and deletion permissions are checked. It does not recompute payload hashes; the native
review already verified archive checksums. The job checks the exact reviewed
allowlist, not live database preservation dates; do not change keep dates after
review or while this job is queued/running. If any do change, stop the job and
request a fresh review. No AWS data or database records are modified by this job.

Logs: komondor-hpc-delete-JOBID.log and deletion-JOBID.jsonl in this directory.
If anything stops, preserve these logs and tell Codex. Do not rerun blindly:
some earlier Projects may already be removed. If it completes, send the job ID
and final log lines. Codex must independently verify the mounted HPC absence
and use native confirm-absent for each removed Project before the website shows
its final AWS-only state. Keep this folder as the execution evidence.
''')
    names = sorted(p.name for p in args.out.iterdir() if p.is_file())
    (args.out/'SHA256SUMS').write_text(''.join(sha((args.out/n).read_bytes())+'  '+n+'\n' for n in names))
    print(json.dumps({'projects':169, 'files':sum(p['fileCount'] for p in projects), 'bytes':sum(p['bytes'] for p in projects),
                      'planSha256':plan_hash, 'reviewCompletedAt':summary['at'], 'expiresAt':expires.isoformat(), 'output':str(args.out)},indent=2))


if __name__ == '__main__':
    main()
