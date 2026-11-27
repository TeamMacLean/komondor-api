#!/usr/bin/env python3
"""Stream query-only code over SSH; store its evidence only on the Mac.

This is not a copy or reassignment command. It makes no server-side files,
changes no database records, and does not load application models.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[4]
SCOPE = REPO / 'docs/archive/evidence/release-planning-20261030/gulnara-scope.json'


def encoded(data):
    return base64.b64encode(data).decode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', choices=['database', 'filesystem', 'environment'], required=True)
    parser.add_argument('--output', type=Path, required=True, help='Fresh local evidence file; never overwritten')
    args = parser.parse_args()
    scope_bytes = SCOPE.read_bytes()
    module_name = {'database': 'db-preflight.cjs', 'filesystem': 'fs-preflight.cjs'}.get(args.component)
    module_bytes = (BASE / module_name).read_bytes() if module_name else b''
    if module_name:
        subprocess.run(['node', '--check', str(BASE / module_name)], check=True)
    body = r'''
const fs=require('fs'),os=require('os'),assert=require('assert/strict');
assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'deeks');
const api='/storage/www/komondor-api';
const scope=JSON.parse(Buffer.from(SCOPE_DATA,'base64').toString('utf8'));
const moduleHolder={exports:{}};
new Function('module','exports','require',Buffer.from(MODULE_DATA,'base64').toString('utf8'))(moduleHolder,moduleHolder.exports,require);
(async()=>{
let result;
if(COMPONENT==='database') {
  const {MongoClient,ObjectId}=require(api+'/node_modules/mongodb');
  const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',
    {useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000,readPreference:'primary'});
  try { const db=client.db('komondor'); result=await moduleHolder.exports.collectDatabase(db,scope,ObjectId); }
  finally {await client.close();}
} else if(COMPONENT==='filesystem') {
  result=await moduleHolder.exports.inspectFilesystem(scope);
} else {
  const cp=require('child_process');
  const env=require(api+'/node_modules/dotenv').parse(fs.readFileSync(api+'/.env'));
  const config={};for(const k of ['DATASTORE_ROOT','READS_ROOT_PATH','HPC_RETENTION_YEARS','PORT'])config[k]=env[k]??null;
  const git=p=>({head:cp.execFileSync('git',['--no-optional-locks','--no-pager','-C',p,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    status:cp.execFileSync('git',['--no-optional-locks','--no-pager','-C',p,'status','--short'],{encoding:'utf8'}).trim()});
  result={at:new Date().toISOString(),host:os.hostname(),user:os.userInfo().username,node:process.version,api:git(api),config,
    roots:['/mnt/reads','/tsl/data/reads',env.DATASTORE_ROOT].filter(Boolean).map(p=>{try {const s=fs.statSync(p);return {path:p,realPath:fs.realpathSync(p),dev:s.dev,ino:s.ino,isDirectory:s.isDirectory()};}catch(e){return {path:p,error:e.code};}})};
}
console.log(JSON.stringify({component:COMPONENT,scriptSha256:SCRIPT_SHA,scopeSha256:SCOPE_SHA,result},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
'''
    replacements = {'SCOPE_DATA': encoded(scope_bytes), 'MODULE_DATA': encoded(module_bytes),
                    'COMPONENT': args.component, 'SCRIPT_SHA': hashlib.sha256(module_bytes).hexdigest(),
                    'SCOPE_SHA': hashlib.sha256(scope_bytes).hexdigest()}
    for key, value in replacements.items():
        body = body.replace(key, json.dumps(value))
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Reserve the output before connecting so a repeated invocation cannot clobber evidence.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    command = ['ssh', '-S', '/Users/deeks/.ssh/v1333-codex-reconcile.sock', '-o', 'BatchMode=yes',
               '-o', 'ConnectTimeout=15', 'deeks@v1333.nbi.ac.uk', '/storage/.nvm/versions/node/v24.11.1/bin/node -']
    try:
        run = subprocess.run(command, input=body.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        with os.fdopen(fd, 'wb') as out:
            out.write(run.stdout)
        meta = {'component': args.component, 'returncode': run.returncode,
                'outputSha256': hashlib.sha256(run.stdout).hexdigest(), 'stderr': run.stderr.decode(errors='replace'),
                'scopeSha256': replacements['SCOPE_SHA'], 'scriptSha256': replacements['SCRIPT_SHA']}
        with open(str(args.output)+'.receipt.json', 'x') as out:
            json.dump(meta, out, indent=2);out.write('\n')
        if run.returncode:
            raise SystemExit('Read-only preflight failed; inspect ' + str(args.output)+'.receipt.json')
        value = json.loads(run.stdout)
        print(json.dumps({'output': str(args.output), 'component': args.component,
                          'summary': value['result'].get('summary'), 'sha256': meta['outputSha256']}))
    except BaseException:
        try: os.close(fd)
        except OSError: pass
        raise


if __name__ == '__main__':
    main()
