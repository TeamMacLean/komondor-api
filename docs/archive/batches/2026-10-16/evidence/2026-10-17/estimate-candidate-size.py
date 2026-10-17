import pathlib,json,subprocess,shlex
folder=pathlib.Path('docs/archive/batches/2026-10-16/evidence/2026-10-17')
# Same explicit project/read targets as the running read-only comparison.
if (folder/'candidate-size-estimate.json').exists(): raise SystemExit('Evidence already exists; use a separately reviewed output name for a fresh capture')
r=json.loads((folder/'relations-20261017T064145Z.command.json').read_text())
register=json.loads(pathlib.Path('docs/archive/batches/2026-10-16/register.json').read_text())
targets=[]
for e in register['entries']:
 if e['entry_id'] not in {'jjones-004','jjones-005','jjones-008','jjones-012','jjones-041','jjones-047','two_blades-015','skamoun-014'}:continue
 report=json.loads((pathlib.Path('docs')/e['production_review']['report']).read_text())
 missing=next(p['dbRecordsMissingOnDisk'] for p in report['projects'] if p['projectId']==e['project_id'])
 targets.append({'entryId':e['entry_id'],'projectId':e['project_id'],'missing':missing})
source="""const fs=require('fs'),path=require('path');require('dotenv').config();const m=require('mongoose');m.set('autoIndex',false);m.set('autoCreate',false);const {resolveMongoUri}=require('./lib/utils/validateEnv');const {walkTree}=require('./lib/s3-archive/inventory');const {validateProjectRoot}=require('./lib/s3-archive/preflight');(async()=>{const targets=JSON.parse(fs.readFileSync(0,'utf8'));await m.connect(resolveMongoUri(process.env),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true});try{const db=m.connection.db,out=[];for(const t of targets){const p=await db.collection('projects').findOne({_id:new m.Types.ObjectId(t.projectId)});const root=await validateProjectRoot({datastoreRoot:process.env.DATASTORE_ROOT},p);const inv=await walkTree(root.sourceRoot),prefix=p.path.replace(/^\\//,'')+'/';const candidates=new Map();for(const x of t.missing){const r=await db.collection('reads').findOne({_id:new m.Types.ObjectId(x.id)});const f=await db.collection('files').findOne({_id:r.file});const stored=String(f.path||'').replace(/^\\//,'');for(const e of inv.entries.filter(e=>e.type==='file'&&(path.basename(e.relPath)===path.basename(x.expectedRelPath)||(stored.startsWith(prefix)&&e.relPath===stored.slice(prefix.length))||e.relPath===x.expectedRelPath)))candidates.set(e.relPath,e.size);}out.push({entryId:t.entryId,files:candidates.size,bytes:[...candidates.values()].reduce((a,b)=>a+b,0)});}console.log(JSON.stringify({at:new Date().toISOString(),metadataEstimateOnly:true,projects:out},null,2));}finally{await m.disconnect();}})().catch(e=>{console.error(e.stack);process.exitCode=1});"""
cmd=['ssh','-S',str(pathlib.Path.home()/'.ssh/v1333-codex-stage2.sock'),'-o','BatchMode=yes','-o','ConnectTimeout=15','deeks@v1333.nbi.ac.uk','cd /storage/www/komondor-api && /storage/.nvm/versions/node/v24.11.1/bin/node -e '+shlex.quote(source)]
result=subprocess.run(cmd,input=json.dumps(targets),capture_output=True,text=True);print(result.stdout);print(result.stderr)
if result.returncode:raise SystemExit(result.returncode)
(folder/'candidate-size-estimate.json').write_text(result.stdout)
