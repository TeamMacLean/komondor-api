'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {stageCopy,publishSamples,verifyPublished,verifySourceMetadata,createNodeCrcFactory}=require('./copy.cjs');
const {Crc64Nvme}=require(path.resolve(__dirname,'../../../../../../lib/utils/crc64nvme'));
const crcFactory=createNodeCrcFactory(Crc64Nvme);
const stat=s=>({type:s.isDirectory()?'dir':s.isFile()?'file':'unsafe',size:s.size,dev:s.dev,ino:s.ino,mode:s.mode,uid:s.uid,gid:s.gid,nlink:s.nlink,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const fid=n=>n.toString(16).padStart(24,'0');
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gulnara-copy-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const group=path.join(root,'group');await fs.mkdir(group);const destination=path.join(group,'target');await fs.mkdir(destination);const evidenceDir=path.join(root,'evidence');await fs.mkdir(evidenceDir);
 const scope={targetProject:{_id:fid(1)},matches:[]},filesystemEvidence={roots:[],samples:[]};const entries=[];
 for(let i=0;i<2;i++){
  const sourceProject=path.join(group,'source'+i);await fs.mkdir(sourceProject);const source=path.join(sourceProject,'sample'+i);await fs.mkdir(source);await fs.mkdir(path.join(source,'run'));await fs.mkdir(path.join(source,'empty'));
  const sampleId=fid(10+i);scope.matches.push({sample:{_id:sampleId,safeName:'sample'+i}});
  for(let j=0;j<2;j++){
   const fileId=fid(100+i*2+j),file=path.join(source,'run','file'+j+'.fq.gz'),bytes=Buffer.from(('file-'+i+'-'+j+'-').repeat(4000));await fs.writeFile(file,bytes,{mode:0o660});
   entries.push({fileId,sampleId,source:file,destination:path.join(destination,'sample'+i,'run','file'+j+'.fq.gz'),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),crc64nvme:new Crc64Nvme().update(bytes).toBase64(),sourceMetadata:stat(await fs.stat(file))});
  }
  const observed=[];async function walk(p){observed.push({relPath:path.relative(sourceProject,p),...stat(await fs.stat(p))});if((await fs.stat(p)).isDirectory())for(const n of(await fs.readdir(p)).sort())await walk(path.join(p,n));}await walk(source);
  filesystemEvidence.samples.push({sampleId,sourcePath:source,destinationPath:path.join(destination,'sample'+i),entries:observed});
 }
 filesystemEvidence.roots.push({projectId:fid(1),canonicalPath:destination,...stat(await fs.stat(destination))});
 const options={scope,filesystemEvidence,copyManifest:{count:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0),entries},stageRoot:path.join(group,'.gulnara-staging-fixture'),evidenceDir,operationId:crypto.randomUUID(),planSha256:'a'.repeat(64),crcFactory};
 options.inspectSource=async()=>{await verifySourceMetadata(options);return{ok:true,issues:[]};};
 options.assertPaused=async()=>({runId:'paused-fixture',expiresAt:new Date(Date.now()+60000).toISOString(),allApiInstancesStopped:true,externalWritersFrozen:true,windowOperator:'tsldata'});
 // This fixture adapter checks collisions but is not advertised as atomic;
 // production uses the separate Linux renameat2 RENAME_NOREPLACE helper.
 options.renameChild=async(a,b)=>{assert.equal(await fs.lstat(b).then(()=>true,()=>false),false);await fs.rename(a,b);};
 return options;
}
test('independent staged copies, immutable receipts, metadata and published graph verification',async t=>{
 const o=await fixture(t);const sourceBefore=await Promise.all(o.copyManifest.entries.map(e=>fs.readFile(e.source)));
 const result=await stageCopy(o);assert(result.allVerified);assert.equal(result.files,4);
 for(let i=0;i<o.copyManifest.entries.length;i++){
  const e=o.copyManifest.entries[i],staged=path.join(o.stageRoot,path.relative(o.filesystemEvidence.roots[0].canonicalPath,e.destination));
  assert.deepEqual(await fs.readFile(staged),sourceBefore[i]);assert.notEqual((await fs.stat(staged)).ino,(await fs.stat(e.source)).ino);assert.deepEqual(await fs.readFile(e.source),sourceBefore[i]);
 }
 assert.deepEqual(await stageCopy(o),result,'Safe resume should retain the first completion receipt');
 const published=await publishSamples(o);assert(published.allPublished);assert.equal(published.samples,2);assert((await verifyPublished(o)).allVerified);
 assert.deepEqual(await publishSamples(o),published,'Publication replay adopts matching identities');
 await verifySourceMetadata(o);
});
test('destination collision refuses before staging is created',async t=>{
 const o=await fixture(t);await fs.mkdir(o.filesystemEvidence.samples[0].destinationPath);await assert.rejects(stageCopy(o),/Destination already occupied/);
 assert.equal(await fs.lstat(o.stageRoot).then(()=>true,()=>false),false);
});
test('source digest mismatch retains original and refuses a verified receipt',async t=>{
 const o=await fixture(t);o.copyManifest.entries[0].sha256='0'.repeat(64);await assert.rejects(stageCopy(o),/sha256 mismatch/);
 assert((await fs.stat(o.copyManifest.entries[0].source)).isFile());assert.equal(await fs.lstat(path.join(o.evidenceDir,'copy-verified.json')).then(()=>true,()=>false),false);
});
test('partial copy without receipt cannot be silently overwritten on retry',async t=>{
 const o=await fixture(t);o.crcFactory=async()=>({update:async()=>{throw Error('injected interruption');},digest:async()=>'',abort:async()=>{}});
 await assert.rejects(stageCopy(o),/injected interruption/);o.crcFactory=crcFactory;
 await assert.rejects(stageCopy(o),/Unreceipted\/partial staging file/);
});
test('symlinked source is rejected',async t=>{
 const o=await fixture(t);const first=o.copyManifest.entries[0].source;await fs.rename(first,first+'.original');await fs.symlink(first+'.original',first);
 await assert.rejects(stageCopy(o),/Symlink/);
});
test('source changed while copying cannot pass',async t=>{
 const o=await fixture(t);let changed=false;const native=crcFactory;
 o.crcFactory=async()=>{const c=await native();return{...c,update:async b=>{await c.update(b);if(!changed){changed=true;await fs.appendFile(o.copyManifest.entries[0].source,'changed');}}};};
 await assert.rejects(stageCopy(o),/mismatch|Source changed/);
});
test('independent destination read detects bad copied bytes',async t=>{
 const o=await fixture(t);let created=0;const native=crcFactory;
 o.crcFactory=async()=>{const c=await native();created++;return created===2?{...c,digest:async()=>{await c.digest();return 'AAAAAAAAAAA=';}}:c;};
 await assert.rejects(stageCopy(o),/crc64nvme mismatch/);
});
test('tampered copied file is refused on receipt adoption',async t=>{
 const o=await fixture(t);await stageCopy(o);const e=o.copyManifest.entries[0];const staged=path.join(o.stageRoot,path.relative(o.filesystemEvidence.roots[0].canonicalPath,e.destination));await fs.appendFile(staged,'bad');
 await assert.rejects(stageCopy(o),/metadata changed/);
});
test('publication requires live operator pause and refuses expiry',async t=>{
 const o=await fixture(t);await stageCopy(o);o.assertPaused=async()=>({runId:'bad',expiresAt:'2020-01-01T00:00:00Z',allApiInstancesStopped:true,externalWritersFrozen:true,windowOperator:'tsldata'});
 await assert.rejects(publishSamples(o),/expired/);
});
test('interruption after rename resumes using durable intent and matching inode',async t=>{
 const o=await fixture(t);await stageCopy(o);const rename=o.renameChild;let first=true;
 o.renameChild=async(a,b)=>{await rename(a,b);if(first){first=false;throw Error('interrupted after atomic publication');}};
 await assert.rejects(publishSamples(o),/interrupted after atomic publication/);o.renameChild=rename;
 assert((await publishSamples(o)).allPublished);assert((await verifyPublished(o)).allVerified);
});
test('new target collision during publication preserves both trees',async t=>{
 const o=await fixture(t);await stageCopy(o);const target=o.filesystemEvidence.samples[0].destinationPath;await fs.mkdir(target);await fs.writeFile(path.join(target,'foreign'),'keep');
 await assert.rejects(publishSamples(o),/collision/);assert.equal(await fs.readFile(path.join(target,'foreign'),'utf8'),'keep');
});
test('an extra staged file blocks publication before any sample is moved',async t=>{
 const o=await fixture(t);await stageCopy(o);await fs.writeFile(path.join(o.stageRoot,'sample1','foreign'),'unexpected');
 await assert.rejects(publishSamples(o),/Unexpected staged child/);
 for(const sample of o.filesystemEvidence.samples)assert.equal(await fs.lstat(sample.destinationPath).then(()=>true,()=>false),false);
});
test('replacing the destination Project directory invalidates its recorded identity',async t=>{
 const o=await fixture(t);const target=o.filesystemEvidence.roots[0].canonicalPath;await fs.rename(target,target+'.old');await fs.mkdir(target);
 await assert.rejects(stageCopy(o),/root identity changed/);
});
test('a crash after mkdir but before claim receipt cannot adopt the new root blindly',async t=>{
 const o=await fixture(t);await stageCopy(o);const chown=fs.chown;
 try {fs.chown=async(p,...rest)=>{if(p===o.filesystemEvidence.samples[0].destinationPath)throw Error('injected after mkdir');return chown(p,...rest);};await assert.rejects(publishSamples(o),/injected after mkdir/);}
 finally {fs.chown=chown;}
 await assert.rejects(publishSamples(o),/Unreceipted target root/);
});
