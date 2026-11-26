'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {stageCopy,publishSamples}=require('./copy.cjs');
const {verifyRecoverableCopy}=require('./copy-recovery.cjs');
// Reuse the existing, sealed fixture builder without registering its tests.
const fixtureFile=path.join(__dirname,'copy.test.cjs'),fixtureModule={exports:{}};
const fixtureSource=syncFs.readFileSync(fixtureFile,'utf8').split("test('independent staged copies")[0]+'\nmodule.exports={fixture};';
vm.runInNewContext(fixtureSource,{require:createRequire(fixtureFile),__dirname,module:fixtureModule,Buffer});
const {fixture}=fixtureModule.exports;
test('read-only verifier accepts entirely staged and fully published copies',async t=>{
 const o=await fixture(t);await stageCopy(o);const a=await verifyRecoverableCopy(o);assert.equal(a.state,'staged');assert.equal(a.stagedFiles,4);
 await publishSamples(o);const b=await verifyRecoverableCopy(o);assert.equal(b.state,'published');assert.equal(b.publishedFiles,4);
});
test('read-only verifier accepts a durable partial child publication',async t=>{
 const o=await fixture(t);await stageCopy(o);const rename=o.renameChild;let first=true;
 o.renameChild=async(a,b)=>{await rename(a,b);if(first){first=false;throw Error('stop after rename');}};
 await assert.rejects(publishSamples(o),/stop after rename/);const r=await verifyRecoverableCopy(o);assert(r.copiesConsistent);assert.equal(r.claimedRoots,1);assert.equal(r.privateRoots,1);
});
test('unreceipted destination root fails closed',async t=>{
 const o=await fixture(t);await stageCopy(o);await fs.mkdir(o.filesystemEvidence.samples[0].destinationPath,{mode:0o700});await assert.rejects(verifyRecoverableCopy(o));
});
test('changed immutable file receipt is rejected',async t=>{
 const o=await fixture(t);await stageCopy(o);const p=path.join(o.evidenceDir,'file-'+o.copyManifest.entries[0].fileId+'.json');const d=JSON.parse(await fs.readFile(p,'utf8'));d.at='tampered';await fs.writeFile(p,JSON.stringify(d));await assert.rejects(verifyRecoverableCopy(o),/receipt changed/);
});
test('changed destination bytes/metadata is rejected',async t=>{
 const o=await fixture(t);await stageCopy(o);const entry=o.copyManifest.entries[0],p=path.join(o.stageRoot,path.relative(o.filesystemEvidence.roots[0].canonicalPath,entry.destination));await fs.appendFile(p,'changed');await assert.rejects(verifyRecoverableCopy(o),/changed since verification/);
});
test('unexpected staging root children are rejected',async t=>{
 const o=await fixture(t);await stageCopy(o);await fs.mkdir(path.join(o.stageRoot,'unexpected'));await assert.rejects(verifyRecoverableCopy(o),/Unexpected staging Project root entries/);
});
test('unexpected destination Project root children are rejected',async t=>{
 const o=await fixture(t);await stageCopy(o);await fs.mkdir(path.join(o.filesystemEvidence.roots[0].canonicalPath,'unexpected'));await assert.rejects(verifyRecoverableCopy(o),/Unexpected destination Project root entry/);
});
