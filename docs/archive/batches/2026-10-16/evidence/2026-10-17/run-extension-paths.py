"""Read-only supplement for three observed .fastq versus .fastq.txt discrepancies."""
import datetime,hashlib,json,pathlib,shlex,subprocess,sys
folder=pathlib.Path(__file__).resolve().parent
root=folder.parents[5]
register=json.loads((root/'docs/archive/batches/2026-10-16/register.json').read_text())
e=next(e for e in register['entries'] if e['entry_id']=='jjones-008')
report=json.loads((root/'docs'/e['production_review']['report']).read_text())
missing=next(p['dbRecordsMissingOnDisk'] for p in report['projects'] if p['projectId']==e['project_id'])
assert len(missing)==3 and all(m['expectedRelPath'].endswith('.fastq.txt') for m in missing)
target={'entryId':e['entry_id'],'projectId':e['project_id'],'projectPath':e['production_review']['registered_path'],'missing':missing,'candidatePathsByRead':{m['id']:[m['expectedRelPath'][:-4]] for m in missing}}
source=(folder/'collect-extension-candidates.cjs').read_text()
payload={'repositoryRoot':'/storage/www/komondor-api','mode':'paths','targets':[target],'source':source}
loader="const fs=require('fs'),Module=require('module');const p=JSON.parse(fs.readFileSync(0,'utf8'));const m=new Module('/storage/www/komondor-api/scripts/_review_collect.cjs');m.filename='/storage/www/komondor-api/scripts/_review_collect.cjs';m.paths=Module._nodeModulePaths('/storage/www/komondor-api/scripts');m._compile(p.source,m.filename);m.exports.run(p).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\\n')).catch(e=>{process.stderr.write(e.stack+'\\n');process.exitCode=1;});"
cmd=['ssh','-S',str(pathlib.Path.home()/'.ssh/v1333-codex-stage2.sock'),'-o','BatchMode=yes','-o','ConnectTimeout=15','deeks@v1333.nbi.ac.uk','cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e '+shlex.quote(loader)]
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');name='extension-paths-'+stamp
out=folder/(name+'.json');log=folder/(name+'.stderr.log')
record={'command':shlex.join(cmd),'operatorCommand':f'python3 {pathlib.Path(__file__).relative_to(root)}','collectorFile':'collect-extension-candidates.cjs','collectorSha256':hashlib.sha256(source.encode()).hexdigest(),'targets':[target],'output':out.name,'stderr':log.name,'productionWrites':False,'startedAt':stamp}
print('Supplement evidence:',out,flush=True)
with out.open('xb') as o,log.open('xb') as l:r=subprocess.run(cmd,input=json.dumps(payload).encode(),stdout=o,stderr=l)
record.update(exitCode=r.returncode,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),outputSha256=hashlib.sha256(out.read_bytes()).hexdigest())
(folder/(name+'.command.json')).write_text(json.dumps(record,indent=2)+'\n')
if r.returncode:print(log.read_text(),file=sys.stderr);raise SystemExit(r.returncode)
print('Supplement completed',flush=True)
