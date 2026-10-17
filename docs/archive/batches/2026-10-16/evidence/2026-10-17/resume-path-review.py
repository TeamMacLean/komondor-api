"""Resume only unfinished observations, with a separate local receipt per record.

Usage: python3 .../resume-path-review.py [--execute]
Without --execute, validates saved evidence and reports missing comparisons.
No files are written to production. Completed project evidence is preserved;
unfinished projects use one short SSH observation per Read. Every such observation
inventories the whole tree before/after. Aggregation requires identical inventory
fingerprints across the project's observations, as well as matching Git/modules.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import shlex
import subprocess
import sys

folder = pathlib.Path(__file__).resolve().parent
repo = folder.parents[5]
targets = json.loads((folder / 'paths-20261017T063123Z.command.json').read_text())['targets']
assert len(targets) == 8 and sum(len(t['missing']) for t in targets) == 110
sha = lambda data: hashlib.sha256(data).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
collector = 'collect-path-record.cjs'
source = (folder / collector).read_text()
source_hash = sha(source.encode())
socket = pathlib.Path.home() / '.ssh/v1333-codex-review-20261017.sock'
ssh = ['ssh', '-S', str(socket), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
       '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', 'deeks@v1333.nbi.ac.uk']
loader = r"""const fs=require('fs'),Module=require('module');
const p=JSON.parse(fs.readFileSync(0,'utf8'));
const m=new Module('/storage/www/komondor-api/scripts/_review_collect.cjs');
m.filename='/storage/www/komondor-api/scripts/_review_collect.cjs';
m.paths=Module._nodeModulePaths('/storage/www/komondor-api/scripts');m._compile(p.source,m.filename);
m.exports.run(p).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n'))
.catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});"""
command = ssh + ['cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e ' + shlex.quote(loader)]


def load_evidence(receipt_path):
    receipt = json.loads(receipt_path.read_text())
    if receipt['exitCode'] != 0:
        return None
    output = folder / receipt['output']
    assert sha(output.read_bytes()) == receipt['outputSha256']
    assert sha((folder / receipt['collectorFile']).read_bytes()) == receipt['collectorSha256']
    data = json.loads(output.read_text())
    assert len(data['projects']) == 1
    p = data['projects'][0]
    assert p['treeUnchangedDuringAudit']
    assert data['gitBefore'] == data['gitAfter'] and data['gitAfter']['status'] == ''
    assert len(receipt['targets']) == 1
    target = receipt['targets'][0]
    assert (p['entryId'], p['projectId'], p['projectPath']) == (target['entryId'], target['projectId'], target['projectPath'])
    assert sorted(r['readId'] for r in p['records']) == sorted(m['id'] for m in target['missing'])
    reference = dict(receipt=receipt_path.name, receiptSha256=sha(receipt_path.read_bytes()),
                     output=output.name, outputSha256=receipt['outputSha256'])
    return data, reference


def collect_one(job):
    target, missing = job
    scoped = dict(target, missing=[missing])
    stem = f"paths-record-{stamp}-{target['entryId']}-{missing['id']}"
    output, log = folder / (stem + '.json'), folder / (stem + '.stderr.log')
    receipt = dict(command=shlex.join(command), collectorFile=collector, collectorSha256=source_hash,
                   targets=[scoped], mode='paths', output=output.name, stderr=log.name,
                   productionWrites=False, startedAt=now())
    payload = dict(repositoryRoot='/storage/www/komondor-api', mode='paths', targets=[scoped], source=source)
    print('Reading', target['entryId'], missing['id'], flush=True)
    with output.open('xb') as out, log.open('xb') as err:
        result = subprocess.run(command, input=json.dumps(payload).encode(), stdout=out, stderr=err)
    receipt.update(exitCode=result.returncode, finishedAt=now(), outputSha256=sha(output.read_bytes()))
    receipt_path = folder / (stem + '.command.json')
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    if result.returncode:
        raise RuntimeError(f"SSH/read failed for {target['entryId']} {missing['id']}; see {log.name}")
    accepted = load_evidence(receipt_path)
    print('Saved', target['entryId'], missing['id'], flush=True)
    return accepted


def assemble(observations):
    baseline = observations[0][0]
    for data, _ in observations:
        for field in ('gitBefore', 'gitAfter', 'moduleSha256', 'operator', 'host', 'mode'):
            assert data[field] == baseline[field], field
    projects = []
    for target in targets:
        jobs = [(d, ref) for d, ref in observations if d['projects'][0]['entryId'] == target['entryId']]
        assert jobs, target['entryId']
        parts = [d['projects'][0] for d, _ in jobs]
        first = parts[0]
        for p in parts:
            for field in ('entryId', 'projectId', 'projectPath', 'sourceRoot', 'inventoryRegularFiles', 'inventoryBytes'):
                assert p[field] == first[field], (target['entryId'], field)
        if len(parts) > 1:
            assert all(p.get('inventorySha256') for p in parts)
            assert len({p['inventorySha256'] for p in parts}) == 1, 'Tree changed between record observations'
        records = [r for p in parts for r in p['records']]
        assert len(records) == len({r['readId'] for r in records})
        assert sorted(r['readId'] for r in records) == sorted(m['id'] for m in target['missing'])
        by_id = {r['readId']: r for r in records}
        candidates = {}
        for record in records:
            for c in record['candidates']:
                if c['relPath'] in candidates:
                    assert candidates[c['relPath']] == c, 'Candidate changed between observations'
                candidates[c['relPath']] = c
        projects.append(dict(first, records=[by_id[m['id']] for m in target['missing']],
                             uniqueFilesHashed=len(candidates),
                             observedStartedAt=min(d['startedAt'] for d, _ in jobs),
                             observedFinishedAt=max(d['finishedAt'] for d, _ in jobs),
                             observationMode='one-complete-project' if len(parts) == 1 else 'per-record-with-identical-whole-tree-fingerprints',
                             observationEvidence=[ref for _, ref in jobs]))
    aggregate = {k: baseline[k] for k in ('gitBefore', 'gitAfter', 'moduleSha256', 'operator', 'host', 'mode')}
    aggregate.update(startedAt=min(d['startedAt'] for d, _ in observations),
                     finishedAt=max(d['finishedAt'] for d, _ in observations), projects=projects,
                     observationEvidence=[ref for _, ref in observations])
    return aggregate


def main():
    assert sys.argv[1:] in ([], ['--execute'])
    saved = {}
    # Whole-project successes take precedence; failed/partial outputs are never used.
    for rp in sorted(folder.glob('paths-retry-20261017T115634Z-*.command.json')):
        result = load_evidence(rp)
        if result:
            d, _ = result
            saved[d['projects'][0]['entryId']] = [result]
    for rp in sorted(folder.glob('paths-record-*.command.json')):
        result = load_evidence(rp)
        if not result:
            continue
        d, _ = result
        p = d['projects'][0]
        if p['entryId'] in saved and len(saved[p['entryId']][0][0]['projects'][0]['records']) > 1:
            continue
        assert len(p['records']) == 1
        entries = saved.setdefault(p['entryId'], [])
        read_id = p['records'][0]['readId']
        entries[:] = [x for x in entries if x[0]['projects'][0]['records'][0]['readId'] != read_id]
        entries.append(result)
    jobs = []
    for target in targets:
        done = {r['readId'] for d, _ in saved.get(target['entryId'], []) for r in d['projects'][0]['records']}
        jobs.extend((target, m) for m in target['missing'] if m['id'] not in done)
    observations = [x for entries in saved.values() for x in entries]
    print('Saved complete records:', 110 - len(jobs), 'Remaining:', len(jobs), flush=True)
    if not sys.argv[1:]:
        for target in targets:
            print(target['entryId'], sum(t['entryId'] == target['entryId'] for t, _ in jobs), 'remaining')
        return
    if jobs:
        # Required before any retry: authentication and no surviving old collector.
        inspection = subprocess.run(ssh + ["pgrep -af '[/]storage/www/komondor-api/scripts/_review_collect[.]cjs' | cut -c1-180"],
                                    capture_output=True, text=True, timeout=25)
        # No matches leaves cut's successful status; command errors still stop us.
        if inspection.returncode or inspection.stdout.strip() or inspection.stderr.strip():
            raise RuntimeError('Stop: SSH unavailable or an earlier collector still exists. ' + inspection.stdout + inspection.stderr)
        # Submit only two at a time; stop scheduling new work on the first failure.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = set()
            iterator = iter(jobs)
            for _ in range(2):
                job = next(iterator, None)
                if job:
                    pending.add(pool.submit(collect_one, job))
            while pending:
                done, pending = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    observations.append(future.result())
                for _ in done:
                    job = next(iterator, None)
                    if job:
                        pending.add(pool.submit(collect_one, job))
    aggregate = assemble(observations)
    output = folder / f'paths-complete-{stamp}.json'
    with output.open('x') as f:
        f.write(json.dumps(aggregate, indent=2) + '\n')
    receipt = dict(operatorCommand=f'python3 {pathlib.Path(__file__).relative_to(repo)} --execute',
                   runnerFile=pathlib.Path(__file__).name, runnerSha256=sha(pathlib.Path(__file__).read_bytes()),
                   targets=targets, output=output.name, outputSha256=sha(output.read_bytes()), exitCode=0,
                   productionWrites=False, startedAt=aggregate['startedAt'], finishedAt=aggregate['finishedAt'],
                   observationEvidence=aggregate['observationEvidence'])
    (folder / f'paths-complete-{stamp}.command.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Complete aggregate:', output.name, flush=True)


if __name__ == '__main__':
    main()
