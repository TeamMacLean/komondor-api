'use strict';
// Read-only proof for the staged/published hybrid state. Never changes access,
// receipts, payloads or services; caller must run under an identity able to read.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {context,verifySourceMetadata}=require('./copy.cjs');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b,fields=['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'])=>fields.every(k=>k.endsWith('Ms')?Math.abs(a[k]-b[k])<=1:a[k]===b[k]);
async function stat(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safe(p){let here=path.parse(p).root;assert(path.isAbsolute(p)&&path.normalize(p)===p);for(const item of p.slice(here.length).split(path.sep).filter(Boolean)){here=path.join(here,item);const s=await fs.lstat(here);assert(!s.isSymbolicLink(),'Symlink in recovery path');if(here!==p)assert(s.isDirectory());}return fs.lstat(p);}
async function json(p){const s=await safe(p);assert(s.isFile());return JSON.parse(await fs.readFile(p,'utf8'));}
async function rows(root){const out=[];async function walk(p){const s=await safe(p);assert(s.isDirectory()||s.isFile(),'Nonregular recovery entry');out.push({relative:path.relative(root,p),type:s.isDirectory()?'dir':'file',stat:s,path:p});if(s.isDirectory())for(const n of(await fs.readdir(p)).sort())await walk(path.join(p,n));}await walk(root);return out;}
async function verifyRecoverableCopy(options){
 const c=context(options),copy=await json(path.join(c.evidenceDir,'copy-verified.json'));
 assert.equal(copy.operationId,c.operationId);assert.equal(copy.planSha256,c.planSha256);assert.equal(copy.copyDigest,c.copyDigest);assert(copy.allVerified);assert.equal(copy.files,c.entries.length);assert.equal(copy.bytes,c.copyManifest.bytes);
 assert.equal(copy.receiptDigests.length,c.entries.length);const digests=new Map(copy.receiptDigests.map(x=>[x.fileId,x.digest]));assert.equal(digests.size,c.entries.length);
 const stageIdentity=await json(path.join(c.evidenceDir,'stage-identity.json')),stage=await safe(c.stageRoot),target=await safe(c.destinationRoot);
 assert.equal(stageIdentity.operationId,c.operationId);assert.equal(stageIdentity.planSha256,c.planSha256);assert.equal(stageIdentity.copyDigest,c.copyDigest);assert.equal(stageIdentity.stageRoot,c.stageRoot);assert.equal(stage.dev,stageIdentity.dev);assert.equal(stage.ino,stageIdentity.ino);
 assert(same(target,c.target,['dev','ino','uid','gid','mode']),'Destination Project root changed');
 const sampleNames=Array.from(c.samples,s=>s.name).sort();
 assert.deepEqual((await fs.readdir(c.stageRoot)).sort(),sampleNames,'Unexpected staging Project root entries');
 assert((await fs.readdir(c.destinationRoot)).every(name=>sampleNames.includes(name)),'Unexpected destination Project root entry');
 await verifySourceMetadata(c);let stagedFiles=0,publishedFiles=0,claimedRoots=0,privateRoots=0;
 for(const sample of c.samples){
  const expectedChildren=sample.entries.filter(e=>e.relPath.split('/').length===2);assert(expectedChildren.every(e=>e.type==='dir'));
  const names=expectedChildren.map(e=>e.relPath.split('/')[1]),stageSample=await safe(sample.stage),destination=await stat(sample.destination);
  assert(stageSample.isDirectory());assert((await fs.readdir(sample.stage)).every(n=>names.includes(n)),'Unexpected staged child');
  let claim;
  if(destination){
   const pubIntent=await json(path.join(c.evidenceDir,'publish-intent-'+sample.id+'.json'));claim=await json(path.join(c.evidenceDir,'claimed-'+sample.id+'.json'));
   for(const r of [pubIntent,claim]){assert.equal(r.operationId,c.operationId);assert.equal(r.planSha256,c.planSha256);assert.equal(r.sampleId,sample.id);assert.equal(r.destination,sample.destination);}
   assert.equal(pubIntent.source,sample.stage);assert.equal(pubIntent.stageDev,stageSample.dev);assert.equal(pubIntent.stageIno,stageSample.ino);assert.equal(claim.intentDigest,digest(pubIntent));
   const actual=await safe(sample.destination);assert(actual.isDirectory());assert(same(actual,claim,['dev','ino','uid','gid']),'Claimed root changed');
   const mode=actual.mode&0o777,originalMode=sample.entries.find(e=>e.relPath===sample.name).mode&0o777;
   assert(mode===0o700||mode===originalMode,'Unexpected claimed-root permissions');
   if(mode!==0o700){const fin=await json(path.join(c.evidenceDir,'finalizing-'+sample.id+'.json'));assert.equal(fin.claimDigest,digest(claim));assert.deepEqual(await fs.readdir(sample.stage),[],'Nonprivate root still has staged children');}
   assert((await fs.readdir(sample.destination)).every(n=>names.includes(n)),'Unexpected published child');claimedRoots++;if(mode===0o700)privateRoots++;
  }
  for(const name of names){
   const source=path.join(sample.stage,name),dest=path.join(sample.destination,name),a=await stat(source),b=destination?await stat(dest):null;
   assert(!!a!==!!b,'Child does not exist in exactly one owned location');const root=a?source:dest;
   if(b){const ci=await json(path.join(c.evidenceDir,'child-intent-'+sample.id+'-'+name+'.json'));assert.equal(ci.operationId,c.operationId);assert.equal(ci.planSha256,c.planSha256);assert.equal(ci.source,source);assert.equal(ci.destination,dest);assert.equal(ci.claimDigest,digest(claim));assert.equal(b.dev,ci.dev);assert.equal(b.ino,ci.ino);}
   const actual=await rows(root),expected=new Map(sample.entries.filter(e=>e.relPath===sample.name+'/'+name||e.relPath.startsWith(sample.name+'/'+name+'/')).map(e=>[e.relPath.split('/').slice(2).join('/'),e.type]));
   assert.equal(actual.length,expected.size,'Copy child entry set changed');for(const row of actual)assert.equal(row.type,expected.get(row.relative));
   for(const e of c.entries.filter(e=>e.sampleId===sample.id&&path.relative(sample.stage,e.stage).split(path.sep)[0]===name)){
    const r=await json(e.receipt);assert.equal(digest(r),digests.get(e.fileId),'Immutable copy receipt changed');assert.equal(r.operationId,c.operationId);assert.equal(r.planSha256,c.planSha256);assert.equal(r.fileId,e.fileId);assert.equal(r.copyDigest,c.copyDigest);assert.equal(r.source,e.source);assert.equal(r.destination,e.destination);assert.equal(r.stage,e.stage);
    for(const k of ['bytes','sha256','crc64nvme']){assert.equal(r.sourceDigest[k],e[k]);assert.equal(r.destinationDigest[k],e[k]);}
    const live=await safe(path.join(root,path.relative(path.join(sample.stage,name),e.stage)));assert(live.isFile());assert(same(live,r.destinationDigest.metadata),'Copied file changed since verification');a?stagedFiles++:publishedFiles++;
   }
  }
 }
 assert.equal(stagedFiles+publishedFiles,c.entries.length);
 return {at:new Date().toISOString(),copiesConsistent:true,state:publishedFiles===0?'staged':stagedFiles===0?'published':'partly-published',stagedFiles,publishedFiles,claimedRoots,privateRoots,files:c.entries.length,bytes:c.copyManifest.bytes,payloadRehashed:false};
}
module.exports={verifyRecoverableCopy};
