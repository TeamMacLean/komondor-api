"""Execute the committed collector in memory. All output files are on this Mac.

Usage: python3 <this-file> relations|paths
Requires the operator's authenticated SSH control socket and VPN.
Never sends a database/SSH credential to stdout or the evidence folder.
"""
import datetime, hashlib, json, pathlib, shlex, subprocess, sys

folder = pathlib.Path(__file__).resolve().parent
root = folder.parents[5]
mode = sys.argv[1] if len(sys.argv) == 2 else None
if mode not in ('relations', 'paths'):
    raise SystemExit('Specify relations or paths')
register = json.loads((root/'docs/archive/batches/2026-10-16/register.json').read_text())
selected = ({'jjones-057','ntalbot-052','skamoun-002','skamoun-003','skamoun-005','skamoun-015','skamoun-016','skamoun-013'}
            if mode == 'relations' else {'jjones-004','jjones-005','jjones-008','jjones-012','jjones-041','jjones-047','two_blades-015','skamoun-014'})
targets = []
for e in register['entries']:
    if e['entry_id'] not in selected: continue
    target = {'entryId':e['entry_id'],'projectId':e['project_id'],'projectPath':e['production_review']['registered_path']}
    if mode == 'paths':
        report=json.loads((root/'docs'/e['production_review']['report']).read_text())
        target['missing']=next(p['dbRecordsMissingOnDisk'] for p in report['projects'] if p['projectId']==e['project_id'])
    targets.append(target)
assert len(targets)==8
source=(folder/'collect-readonly.cjs').read_text()
payload={'repositoryRoot':'/storage/www/komondor-api','mode':mode,'targets':targets,'source':source}
loader="const fs=require('fs'),Module=require('module'); const p=JSON.parse(fs.readFileSync(0,'utf8')); const m=new Module('/storage/www/komondor-api/scripts/_review_collect.cjs'); m.filename='/storage/www/komondor-api/scripts/_review_collect.cjs'; m.paths=Module._nodeModulePaths('/storage/www/komondor-api/scripts'); m._compile(p.source,m.filename); m.exports.run(p).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\\n')).catch(e=>{process.stderr.write(e.stack+'\\n');process.exitCode=1;});"
remote='cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e '+shlex.quote(loader)
command=['ssh','-S',str(pathlib.Path.home()/'.ssh/v1333-codex-stage2.sock'),'-o','BatchMode=yes','-o','ConnectTimeout=15','deeks@v1333.nbi.ac.uk',remote]
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
output=folder/f'{mode}-{stamp}.json'
log=folder/f'{mode}-{stamp}.stderr.log'
record={'command':shlex.join(command),'operatorCommand':f'python3 {pathlib.Path(__file__).relative_to(root)} {mode}',
        'collectorSha256':hashlib.sha256(source.encode()).hexdigest(),'targets':targets,'output':output.name,'stderr':log.name,
        'startedAt':stamp,'mode':mode,'productionWrites':False}
print('Evidence output:',output,flush=True)
with output.open('xb') as out, log.open('xb') as err:
    result=subprocess.run(command,input=json.dumps(payload).encode(),stdout=out,stderr=err)
record['exitCode']=result.returncode
record['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
record['outputSha256']=hashlib.sha256(output.read_bytes()).hexdigest()
(folder/f'{mode}-{stamp}.command.json').write_text(json.dumps(record,indent=2)+'\n')
if result.returncode:
    print(log.read_text(),file=sys.stderr)
    raise SystemExit(result.returncode)
data=json.loads(output.read_text())
print('Completed',len(data['projects']),'projects',flush=True)
