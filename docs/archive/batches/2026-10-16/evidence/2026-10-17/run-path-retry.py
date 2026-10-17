"""Repeat the interrupted read-only audit, saving each project independently on the Mac.

Two read streams at most. No collector or evidence files are written on v1333.
Only successful, unchanged-project results enter the aggregate. A failed/partial
project is retained as evidence of failure and cannot produce a success receipt.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import shlex
import subprocess

folder = pathlib.Path(__file__).resolve().parent
root = folder.parents[5]
initial = json.loads((folder / 'paths-20261017T063123Z.command.json').read_text())
targets = initial['targets']
assert len(targets) == 8 and sum(len(t['missing']) for t in targets) == 110
collector = 'collect-readonly.cjs'
source = (folder / collector).read_text()
digest = lambda data: hashlib.sha256(data).hexdigest()
source_hash = digest(source.encode())
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
loader = """const fs=require('fs'),Module=require('module');
const p=JSON.parse(fs.readFileSync(0,'utf8'));
const m=new Module('/storage/www/komondor-api/scripts/_review_collect.cjs');
m.filename='/storage/www/komondor-api/scripts/_review_collect.cjs';
m.paths=Module._nodeModulePaths('/storage/www/komondor-api/scripts');
m._compile(p.source,m.filename);
m.exports.run(p).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n'))
.catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});"""
# Keep JavaScript string escapes literal in the command sent over SSH.
loader = loader.replace("+'\n'", "+'\\n'")
remote = 'cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e ' + shlex.quote(loader)
command = ['ssh', '-S', str(pathlib.Path.home() / '.ssh/v1333-codex-review-20261017.sock'),
           '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
           '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
           'deeks@v1333.nbi.ac.uk', remote]


def collect(target):
    stem = f"paths-retry-{stamp}-{target['entryId']}"
    output, log = folder / (stem + '.json'), folder / (stem + '.stderr.log')
    receipt = dict(command=shlex.join(command), collectorFile=collector,
                   collectorSha256=source_hash, targets=[target], mode='paths',
                   output=output.name, stderr=log.name, productionWrites=False,
                   startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    payload = dict(repositoryRoot='/storage/www/komondor-api', mode='paths', targets=[target], source=source)
    print('Starting', target['entryId'], flush=True)
    with output.open('xb') as out, log.open('xb') as err:
        result = subprocess.run(command, input=json.dumps(payload).encode(), stdout=out, stderr=err)
    receipt.update(exitCode=result.returncode, finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   outputSha256=digest(output.read_bytes()))
    receipt_path = folder / (stem + '.command.json')
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    if result.returncode:
        raise RuntimeError(f"{target['entryId']} failed; see {log.name}")
    data = json.loads(output.read_text())
    assert len(data['projects']) == 1
    p = data['projects'][0]
    assert p['projectId'] == target['projectId'] and p['projectPath'] == target['projectPath']
    assert sorted(r['readId'] for r in p['records']) == sorted(m['id'] for m in target['missing'])
    assert p['treeUnchangedDuringAudit']
    assert data['gitBefore'] == data['gitAfter'] and data['gitAfter']['status'] == ''
    print('Saved complete result', target['entryId'], len(p['records']), 'records', flush=True)
    return data, dict(receipt=receipt_path.name, receiptSha256=digest(receipt_path.read_bytes()),
                      output=output.name, outputSha256=receipt['outputSha256'])


if __name__ == '__main__':
    print('Audit stamp:', stamp, flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        completed = list(pool.map(collect, targets))
    baseline = completed[0][0]
    for data, _ in completed:
        for field in ('gitBefore', 'gitAfter', 'moduleSha256', 'operator', 'host', 'mode'):
            assert data[field] == baseline[field], field
    aggregate = {k: baseline[k] for k in ('gitBefore', 'gitAfter', 'moduleSha256', 'operator', 'host', 'mode')}
    aggregate.update(startedAt=min(d['startedAt'] for d, _ in completed),
                     finishedAt=max(d['finishedAt'] for d, _ in completed),
                     projects=[dict(d['projects'][0], observedStartedAt=d['startedAt'], observedFinishedAt=d['finishedAt']) for d, _ in completed],
                     perProjectEvidence=[receipt for _, receipt in completed])
    output = folder / f'paths-retry-{stamp}.json'
    with output.open('x') as f:
        f.write(json.dumps(aggregate, indent=2) + '\n')
    receipt = dict(operatorCommand=f'python3 {pathlib.Path(__file__).relative_to(root)}',
                   runnerSha256=digest(pathlib.Path(__file__).read_bytes()), collectorFile=collector,
                   collectorSha256=source_hash, targets=targets, mode='paths', productionWrites=False,
                   output=output.name, outputSha256=digest(output.read_bytes()), exitCode=0,
                   startedAt=aggregate['startedAt'], finishedAt=aggregate['finishedAt'],
                   perProjectEvidence=aggregate['perProjectEvidence'],
                   note='Local aggregate of eight independently saved successful project audits; commands and stderr are in per-project receipts.')
    (folder / f'paths-retry-{stamp}.command.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Completed aggregate:', output.name, flush=True)
