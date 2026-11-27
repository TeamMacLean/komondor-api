'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');const {stageCopy}=require('./copy.cjs'),{publishSamples,verifyPublished,verifyRecoverableCopy}=require('./link-publication.cjs');
const filename=path.join(__dirname,'copy.test.cjs'),m={exports:{}};vm.runInNewContext(sync.readFileSync(filename,'utf8').split("test('independent staged copies")[0]+'\nmodule.exports={fixture};',{require:createRequire(filename),__dirname,module:m,Buffer});
async function fixture(t){const o=await m.exports.fixture(t);o.publicationEvidenceDir=path.join(path.dirname(o.evidenceDir),'link-evidence');await fs.mkdir(o.publicationEvidenceDir);await stageCopy(o);return o;}
const stage=(o,e)=>path.join(o.stageRoot,path.relative(o.filesystemEvidence.roots[0].canonicalPath,e.destination));
test('full publication retains all staged links, original inode independence, and read-only proofs',async t=>{
 const o=await fixture(t);o.crcFactory=async()=>{throw Error('Unexpected ordinary publication rehash');};const first=await verifyRecoverableCopy(o);assert.equal(first.state,'staged');assert.equal(first.stagedFiles,4);assert.equal(first.claimedRoots,0);
 const before=await Promise.all(o.copyManifest.entries.map(e=>fs.readFile(e.source)));const r=await publishSamples(o);assert(r.allPublished);assert.equal(r.retainedStageFiles,4);
 for(let i=0;i<4;i++){const e=o.copyManifest.entries[i],a=await fs.stat(stage(o,e)),b=await fs.stat(e.destination),source=await fs.stat(e.source);assert.equal(a.ino,b.ino);assert.equal(a.nlink,2);assert.notEqual(a.ino,source.ino);assert.deepEqual(await fs.readFile(e.destination),before[i]);assert.deepEqual(await fs.readFile(e.source),before[i]);}
 const v=await verifyPublished(o);assert(v.allVerified);assert.equal(v.stagedFiles,0);assert.equal(v.retainedStageFiles,4);assert.equal(v.publishedFiles,4);assert.deepEqual(await publishSamples(o),r);
});
test('crash after successful link is provable and resumes from durable intent without overwriting',async t=>{
 const o=await fixture(t);let n=0;o.linkFile=async(a,b)=>{await fs.link(a,b);if(++n===1)throw Error('after atomic link');};await assert.rejects(publishSamples(o),/after atomic link/);
 const p=await verifyRecoverableCopy(o);assert.equal(p.state,'partly-published');assert.equal(p.publishedFiles,1);assert.equal(p.pendingFileReceipts,1);assert.equal(p.rehashedFiles,1);
 delete o.linkFile;assert((await publishSamples(o)).allPublished);assert((await verifyPublished(o)).allVerified);
});
test('foreign final file appearing at link creation is never overwritten',async t=>{
 const o=await fixture(t);o.linkFile=async(a,b)=>{await fs.writeFile(b,'foreign',{flag:'wx'});await fs.link(a,b);};await assert.rejects(publishSamples(o),e=>e.code==='EEXIST');const e=o.copyManifest.entries[0];assert.equal(await fs.readFile(e.destination,'utf8'),'foreign');assert.equal((await fs.stat(stage(o,e))).nlink,1);await assert.rejects(verifyRecoverableCopy(o),/Foreign destination|inode/);
});
test('third link fails both partial and complete proof',async t=>{
 const o=await fixture(t);await publishSamples(o);await fs.link(stage(o,o.copyManifest.entries[0]),path.join(path.dirname(o.evidenceDir),'third-link'));await assert.rejects(verifyRecoverableCopy(o),/link count/);
});
test('unrecorded staging inode change and original source change are rejected',async t=>{
 for(const which of ['stage','source']){const o=await fixture(t),e=o.copyManifest.entries[0];await fs.appendFile(which==='stage'?stage(o,e):e.source,'changed');await assert.rejects(publishSamples(o),/metadata changed|stage changed|Source metadata changed/);}
});
test('new directory collision is refused without adopting it',async t=>{
 const o=await fixture(t);await fs.mkdir(o.filesystemEvidence.samples[0].destinationPath);await assert.rejects(publishSamples(o),/Unreceipted directory/);
});
test('crash after mkdir and before claim refuses automatic adoption',async t=>{
 const o=await fixture(t);const mkdir=fs.mkdir;try{fs.mkdir=async(p,...args)=>{await mkdir(p,...args);if(p===o.filesystemEvidence.samples[0].destinationPath)throw Error('after mkdir');};await assert.rejects(publishSamples(o),/after mkdir/);}finally{fs.mkdir=mkdir;}await assert.rejects(verifyRecoverableCopy(o),/Unreceipted directory/);
});
test('symlinks and unexpected trees fail closed',async t=>{
 const o=await fixture(t);await fs.symlink(o.stageRoot,path.join(o.filesystemEvidence.roots[0].canonicalPath,'foreign'));await assert.rejects(publishSamples(o),/Symlink/);
});
test('immutable copy and publication receipt tampering is rejected',async t=>{
 for(const kind of ['copy','publication']){const o=await fixture(t);await publishSamples(o);const p=kind==='copy'?path.join(o.evidenceDir,'file-'+o.copyManifest.entries[0].fileId+'.json'):path.join(o.publicationEvidenceDir,(await fs.readdir(o.publicationEvidenceDir)).find(n=>n.startsWith('file-linked-')));const r=JSON.parse(await fs.readFile(p,'utf8'));r.at='changed';await fs.writeFile(p,JSON.stringify(r));await assert.rejects(verifyRecoverableCopy(o),/receipt.*changed|receipt checksum changed/i);}
});
test('expired window performs no publication',async t=>{
 const o=await fixture(t);o.assertPaused=async()=>({runId:'expired',expiresAt:'2020-01-01',allApiInstancesStopped:true,externalWritersFrozen:true,windowOperator:'tsldata'});await assert.rejects(publishSamples(o),/expired/);assert.deepEqual(await fs.readdir(o.filesystemEvidence.roots[0].canonicalPath),[]);
});
test('a fully receipted directory-only interruption proves an unchanged graph can reopen',async t=>{
 const o=await fixture(t),normal=o.assertPaused;let calls=0;o.assertPaused=async()=>{if(++calls===3)throw Error('pause expired after first directory claim');return normal();};await assert.rejects(publishSamples(o),/pause expired/);
 const p=await verifyRecoverableCopy(o);assert(p.copiesConsistent);assert.equal(p.state,'staged');assert.equal(p.stagedFiles,4);assert.equal(p.publishedFiles,0);assert.equal(p.claimedRoots,1);assert.equal(p.privateRoots,0);
 o.assertPaused=normal;assert((await publishSamples(o)).allPublished);
});
test('a final parent replaced by a symlink is rejected before any payload link',async t=>{
 const o=await fixture(t),normal=o.assertPaused;let calls=0;o.assertPaused=async()=>{if(++calls===3)throw Error('stop after directory');return normal();};await assert.rejects(publishSamples(o),/stop after directory/);const sample=o.filesystemEvidence.samples[0].destinationPath;await fs.rename(sample,sample+'-saved');await fs.symlink(sample+'-saved',sample);await assert.rejects(verifyRecoverableCopy(o),/Symlink/);for(const e of o.copyManifest.entries)assert.equal((await fs.stat(stage(o,e))).nlink,1);
});
test('tampered completion receipt or missing published link cannot authorize verification',async t=>{
 for(const which of ['receipt','link']){const o=await fixture(t);await publishSamples(o);if(which==='receipt'){const p=path.join(o.publicationEvidenceDir,'published-verified.json'),r=JSON.parse(await fs.readFile(p,'utf8'));r.files=3;await fs.writeFile(p,JSON.stringify(r));}else await fs.unlink(o.copyManifest.entries[0].destination);await assert.rejects(verifyPublished(o),/receipt checksum changed|Published file disappeared/);}
});
test('intent-only interrupted link rehash rejects same-size changed bytes with restored mtime',async t=>{
 const o=await fixture(t);o.linkFile=async(a,b)=>{await fs.link(a,b);throw Error('lost acknowledgement');};await assert.rejects(publishSamples(o),/lost acknowledgement/);const e=o.copyManifest.entries[0],p=e.destination,s=await fs.stat(p),bytes=await fs.readFile(p);bytes[0]^=1;await fs.writeFile(p,bytes);await fs.utimes(p,s.atime,new Date(s.mtimeMs));await assert.rejects(verifyRecoverableCopy(o),/Interrupted linked payload sha256 mismatch/);delete o.linkFile;await assert.rejects(publishSamples(o),/Interrupted linked payload sha256 mismatch/);
});
