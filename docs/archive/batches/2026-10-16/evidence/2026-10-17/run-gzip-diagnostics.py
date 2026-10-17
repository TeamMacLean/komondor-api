"""Read-only comparison of compressed and decoded bytes; never changes the source file."""
import pathlib,json,subprocess,shlex,hashlib,datetime,sys
folder=pathlib.Path(__file__).resolve().parent
source=(folder/'collect-gzip-diagnostics.cjs').read_text()
targets=json.loads((folder/'flagged-path-metadata.json').read_text())['records']
loader="const fs=require('fs'),Module=require('module');const p=JSON.parse(fs.readFileSync(0,'utf8'));const m=new Module('/storage/www/komondor-api/scripts/_review_gzip.cjs');m.filename='/storage/www/komondor-api/scripts/_review_gzip.cjs';m.paths=Module._nodeModulePaths('/storage/www/komondor-api/scripts');m._compile(p.source,m.filename);m.exports.run(p.targets).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\\n')).catch(e=>{process.stderr.write(e.stack+'\\n');process.exitCode=1;});"
cmd=['ssh','-S',str(pathlib.Path.home()/'.ssh/v1333-codex-stage2.sock'),'-o','BatchMode=yes','-o','ConnectTimeout=15','deeks@v1333.nbi.ac.uk','cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e '+shlex.quote(loader)]
name='gzip-diagnostics-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');out=folder/(name+'.json');log=folder/(name+'.stderr.log')
print('Gzip diagnostic output:',out,flush=True)
with out.open('xb') as o,log.open('xb') as l:r=subprocess.run(cmd,input=json.dumps({'source':source,'targets':targets}).encode(),stdout=o,stderr=l)
(folder/(name+'.command.json')).write_text(json.dumps({'command':shlex.join(cmd),'targets':targets,'collectorFile':'collect-gzip-diagnostics.cjs','collectorSha256':hashlib.sha256(source.encode()).hexdigest(),'output':out.name,'outputSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'productionWrites':False,'exitCode':r.returncode},indent=2)+'\n')
if r.returncode:print(log.read_text(),file=sys.stderr);raise SystemExit(r.returncode)
print('Gzip diagnostic finished',flush=True)
