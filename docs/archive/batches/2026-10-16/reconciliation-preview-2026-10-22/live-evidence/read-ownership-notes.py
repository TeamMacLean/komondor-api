"""Read 17 small, allowlisted notes; emit text/properties, never write to v1333."""
import base64,datetime,hashlib,io,json,pathlib,shlex,subprocess,zipfile,xml.etree.ElementTree as ET
p=pathlib.Path(__file__).parent
targets=json.loads((p/'ownership-note-targets.json').read_text())
source=r"""const fs=require('fs'),crypto=require('crypto');const t=JSON.parse(fs.readFileSync(0,'utf8'));for(const x of t){if(!x.path.startsWith('/mnt/reads/ntalbot/project_')||!(/\.docx$|readme\.txt$/i.test(x.path)))throw Error('Unexpected path');const s=fs.lstatSync(x.path);if(!s.isFile()||s.size!==x.bytes||s.size>5000000||fs.realpathSync(x.path)!==x.path)throw Error('File identity differs');const b=fs.readFileSync(x.path);const a=fs.lstatSync(x.path);if(s.ino!==a.ino||s.size!==a.size||s.mtimeMs!==a.mtimeMs||s.ctimeMs!==a.ctimeMs)throw Error('File changed');console.log(JSON.stringify({...x,at:new Date().toISOString(),sha256:crypto.createHash('sha256').update(b).digest('hex'),base64:b.toString('base64')}));}"""
cmd=['ssh','-S',str(pathlib.Path.home()/'.ssh/v1333-codex-reconcile.sock'),'-o','BatchMode=yes','-o','ConnectTimeout=15','deeks@v1333.nbi.ac.uk','/storage/.nvm/versions/node/v24.11.1/bin/node -e '+shlex.quote(source)]
result=subprocess.run(cmd,input=json.dumps(targets).encode(),capture_output=True,timeout=60)
if result.returncode:raise RuntimeError(result.stderr.decode())
records=[]
for line in result.stdout.splitlines():
    row=json.loads(line);data=base64.b64decode(row.pop('base64'));assert hashlib.sha256(data).hexdigest()==row['sha256']
    if row['path'].endswith('.docx'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            core=ET.fromstring(z.read('docProps/core.xml'))
            row['properties']={e.tag.split('}')[-1]:e.text for e in core}
            document=ET.fromstring(z.read('word/document.xml'))
            row['paragraphs']=[''.join(e.itertext()) for e in []]  # populated from visible text elements below
            w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            row['paragraphs']=[''.join(t.text or '' for t in e.iter(w+'t')) for e in document.iter(w+'p')]
            row['paragraphs']=[x for x in row['paragraphs'] if x.strip()]
    else:row['paragraphs']=data.decode('utf-8',errors='replace').splitlines()
    records.append(row)
out=p/'ownership-notes.json';out.write_text(json.dumps(records,indent=2)+'\n')
receipt={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'targets':'ownership-note-targets.json','targetSha256':hashlib.sha256((p/'ownership-note-targets.json').read_bytes()).hexdigest(),'scriptSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'output':out.name,'outputSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'exitCode':result.returncode,'filesRead':len(records),'bytesRead':sum(r['bytes'] for r in records),'productionWrites':False,'scope':'Author properties and paragraph text only; original documents unchanged; no layout review.'}
(p/'ownership-notes.command.json').write_text(json.dumps(receipt,indent=2)+'\n')
for r in records:
    print(json.dumps({'entry':r['entryId'],'file':pathlib.Path(r['path']).name,'properties':r.get('properties'),'paragraphs':r['paragraphs'][:8]}))
