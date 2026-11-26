'use strict';
// Atomic no-overwrite publication of verified staged inodes. The independently
// copied staging links are retained; original source files are never linked or
// removed. NFS identity/ACL behavior is checked explicitly, not assumed private.
const fs=require('node:fs/promises'),C=require('node:fs').constants,path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {context,verifySourceMetadata,digestFile}=require('./copy.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const meta=s=>Object.fromEntries(['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
const stable=['dev','ino','size','mode','uid','gid','mtimeMs'];
const same=(a,b,fields=stable)=>fields.every(k=>k.endsWith('Ms')?Math.abs(a[k]-b[k])<=1:a[k]===b[k]);
async function exists(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safe(p,{missing=false}={}){assert(path.isAbsolute(p)&&path.normalize(p)===p);let here=path.parse(p).root;const parts=p.slice(here.length).split(path.sep).filter(Boolean);for(let i=0;i<parts.length;i++){here=path.join(here,parts[i]);const s=await exists(here);if(!s){assert(missing&&i===parts.length-1,'Missing path: '+here);return null;}assert(!s.isSymbolicLink(),'Symlink in publication path');if(i<parts.length-1)assert(s.isDirectory());if(i===parts.length-1)return s;}}
async function read(p){assert((await safe(p)).isFile());const fd=await fs.open(p,C.O_RDONLY|C.O_NOFOLLOW);try{return JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}}
async function syncDir(p){const fd=await fs.open(p,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
async function receipt(p){const value=await read(p),{sha256,...body}=value;assert.equal(hash(body),sha256,'Publication receipt checksum changed');return value;}
async function write(p,body){await safe(path.dirname(p));const value={...body,sha256:hash(body)},fd=await fs.open(p,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o640);try{await fd.chmod(0o640);await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}await syncDir(path.dirname(p));return value;}
function make(options){const c=context(options);assert(options.publicationEvidenceDir,'Separate publication evidence directory is required');c.publicationEvidenceDir=path.resolve(options.publicationEvidenceDir);assert.equal(c.publicationEvidenceDir,options.publicationEvidenceDir);for(const root of[c.stageRoot,c.destinationRoot,...c.samples.map(s=>s.source)])assert(!c.publicationEvidenceDir.startsWith(root+'/')&&c.publicationEvidenceDir!==root);c.dirs=c.samples.flatMap(sample=>sample.entries.filter(e=>e.type==='dir').map(e=>({relative:e.relPath,sampleId:sample.id,path:path.join(c.destinationRoot,e.relPath)}))).sort((a,b)=>a.relative.split('/').length-b.relative.split('/').length||a.relative.localeCompare(b.relative));assert.equal(new Set(c.dirs.map(d=>d.relative)).size,c.dirs.length);return c;}
const names=(c,kind,key)=>path.join(c.publicationEvidenceDir,kind+'-'+hash(key)+'.json');
const bind=c=>({version:1,operationId:c.operationId,planSha256:c.planSha256,copyDigest:c.copyDigest});
function checkBind(r,c){for(const[k,v]of Object.entries(bind(c)))assert.equal(r[k],v,'Publication identity changed: '+k);}
async function paused(c){assert.equal(typeof c.assertPaused,'function');const p=await c.assertPaused();assert(p.runId&&Date.parse(p.expiresAt)>Date.now(),'Maintenance window expired');assert(p.allApiInstancesStopped&&p.externalWritersFrozen&&p.windowOperator==='tsldata');return p;}
async function originals(c){
 await safe(c.publicationEvidenceDir);assert((await safe(c.publicationEvidenceDir)).isDirectory());
 const target=await safe(c.destinationRoot),stage=await safe(c.stageRoot);assert(target.isDirectory()&&stage.isDirectory());assert(same(target,c.target,['dev','ino','mode','uid','gid']),'Destination Project root changed');
 const identity=await read(path.join(c.evidenceDir,'stage-identity.json'));for(const k of ['operationId','planSha256','copyDigest','stageRoot'])assert.equal(identity[k],c[k]);assert.equal(stage.dev,identity.dev);assert.equal(stage.ino,identity.ino);
 const copy=await read(path.join(c.evidenceDir,'copy-verified.json'));for(const k of ['operationId','planSha256','copyDigest'])assert.equal(copy[k],c[k]);assert.equal(copy.allVerified,true);assert.equal(copy.files,c.entries.length);assert.equal(copy.bytes,c.copyManifest.bytes);
 const seals=new Map(copy.receiptDigests.map(r=>[r.fileId,r.digest]));assert.equal(seals.size,c.entries.length);assert.equal(copy.receiptDigests.length,c.entries.length);
 const files=new Map();for(const e of c.entries){const r=await read(e.receipt);assert.equal(hash(r),seals.get(e.fileId),'Immutable copy receipt changed');for(const k of ['operationId','planSha256','copyDigest'])assert.equal(r[k],c[k]);for(const k of ['fileId','source','stage','destination'])assert.equal(r[k],e[k]);for(const k of ['bytes','sha256','crc64nvme']){assert.equal(r.sourceDigest[k],e[k]);assert.equal(r.destinationDigest[k],e[k]);}assert.equal(r.destinationDigest.metadata.nlink,1,'Staged copy was not independent at verification');assert(!(r.destinationDigest.metadata.dev===e.sourceMetadata.dev&&r.destinationDigest.metadata.ino===e.sourceMetadata.ino),'Original source shares staging inode');files.set(e.fileId,r);}
 await verifySourceMetadata(c);return {copy,files};
}
async function walk(root){const out=[];async function visit(p){const s=await safe(p);assert(s.isFile()||s.isDirectory(),'Nonregular publication entry');out.push({relative:path.relative(root,p),type:s.isDirectory()?'dir':'file'});if(s.isDirectory())for(const name of(await fs.readdir(p)).sort())await visit(path.join(p,name));}await visit(root);return out;}
async function directoryProof(c,d){
 const observed=await exists(d.path),st=observed?await safe(d.path):null,intentPath=names(c,'directory-intent',d.relative),claimPath=names(c,'directory-claim',d.relative);
 if(!st){assert(!await exists(claimPath),'Claimed directory disappeared');return null;}
 assert(st.isDirectory(),'Directory collision');assert(await exists(intentPath)&&await exists(claimPath),'Unreceipted directory collision');
 const intent=await receipt(intentPath),claim=await receipt(claimPath);checkBind(intent,c);checkBind(claim,c);assert.equal(intent.relative,d.relative);assert.equal(intent.destination,d.path);assert.equal(claim.intentSha256,intent.sha256);assert.equal(claim.destination,d.path);
 const parent=await safe(path.dirname(d.path));assert.equal(parent.dev,intent.parentDev);assert.equal(parent.ino,intent.parentIno);
 assert(same(st,claim.metadata,['dev','ino','mode','uid','gid']),'Claimed directory identity changed');assert.equal(st.uid,c.target.uid);assert.equal(st.gid,c.target.gid);assert.equal(st.mode&0o777,c.target.mode&0o777,'Unexpected NFS directory permissions');return claim;
}
async function fileIntent(c,e,old){const intent=await receipt(names(c,'file-intent',e.fileId));checkBind(intent,c);assert.equal(intent.fileId,e.fileId);assert.equal(intent.source,e.stage);assert.equal(intent.destination,e.destination);assert.equal(intent.copyReceiptDigest,hash(old));assert.deepEqual(intent.before,meta(old.destinationDigest.metadata));const parent=await safe(path.dirname(e.destination));assert.equal(parent.dev,intent.parentDev);assert.equal(parent.ino,intent.parentIno);return intent;}
async function fileProof(c,e,old,{justLinked=false}={}){
 const a=await safe(e.stage),b=await safe(e.destination,{missing:true});assert(a.isFile());const baseline=old.destinationDigest.metadata;
 assert(same(a,baseline),'Verified staged file metadata changed');assert(!(a.dev===e.sourceMetadata.dev&&a.ino===e.sourceMetadata.ino),'Original source shares copied inode');
 const intentPath=names(c,'file-intent',e.fileId),claimPath=names(c,'file-linked',e.fileId);
 if(!b){assert(!await exists(claimPath),'Published file disappeared');assert.equal(a.nlink,1,'Unexpected staged link count');assert(same(a,baseline,['ctimeMs']),'Unlinked staged file ctime changed');if(await exists(intentPath))await fileIntent(c,e,old);return {linked:false};}
 assert(b.isFile(),'Published file is not regular');assert(await exists(intentPath),'Unreceipted file collision');
 const intent=await fileIntent(c,e,old);
 assert.equal(a.dev,b.dev);assert.equal(a.ino,b.ino,'Foreign destination file collision');assert(same(b,baseline),'Published payload metadata changed');assert.equal(a.nlink,2,'Unexpected copied link count');assert.equal(b.nlink,2);assert(same(a,b,['ctimeMs']));assert(a.ctimeMs>=baseline.ctimeMs-1,'Copied ctime moved backwards');
 if(await exists(claimPath)){const claim=await receipt(claimPath);checkBind(claim,c);assert.equal(claim.intentSha256,intent.sha256);assert.equal(claim.fileId,e.fileId);assert.equal(claim.source,e.stage);assert.equal(claim.destination,e.destination);assert(same(a,claim.metadata,[...stable,'nlink','ctimeMs']),'Published file changed after its link receipt');return {linked:true,intent,claim};}
 // An interrupted link has no anchored post-link ctime. Rehash that specific
 // inode before adopting it; preserved size/mtime alone cannot prove its bytes.
 if(!justLinked){const current=await digestFile(e.destination,c.crcFactory,meta(a));for(const k of ['bytes','sha256','crc64nvme'])assert.equal(current[k],e[k],'Interrupted linked payload '+k+' mismatch');}
 return {linked:true,intent,claim:null,metadata:meta(a),payloadRehashed:!justLinked};
}
async function verifyRecoverableCopy(options){
 const c=make(options),{files}=await originals(c),expected=new Map([...c.dirs.map(d=>[d.relative,'dir']),...c.entries.map(e=>[path.relative(c.destinationRoot,e.destination),'file'])]);
 const staged=await walk(c.stageRoot);assert.equal(staged.length,expected.size+1,'Staging tree entry set changed');for(const row of staged.filter(r=>r.relative))assert.equal(row.type,expected.get(row.relative),'Unexpected staged entry');
 const live=await walk(c.destinationRoot);for(const row of live.filter(r=>r.relative))assert.equal(row.type,expected.get(row.relative),'Unexpected destination entry');
 let claimedRoots=0,linked=0,missingReceipts=0,rehashes=0;const proofs=[];
 for(const d of c.dirs){const claim=await directoryProof(c,d);if(claim){if(!d.relative.includes('/'))claimedRoots++;proofs.push({name:path.basename(names(c,'directory-claim',d.relative)),sha256:claim.sha256});}}
 for(const e of c.entries){const parentPresent=await exists(path.dirname(e.destination));if(!parentPresent){const old=files.get(e.fileId),a=await safe(e.stage);assert(a.isFile()&&same(a,old.destinationDigest.metadata,[...stable,'nlink','ctimeMs']),'Unlinked stage changed');assert(!await exists(names(c,'file-linked',e.fileId)),'Published parent disappeared');continue;}
  const proof=await fileProof(c,e,files.get(e.fileId));if(proof.linked){linked++;if(proof.payloadRehashed)rehashes++;if(!proof.claim)missingReceipts++;else proofs.push({name:path.basename(names(c,'file-linked',e.fileId)),sha256:proof.claim.sha256});}}
 const completionPath=path.join(c.publicationEvidenceDir,'published-verified.json');if(await exists(completionPath)){const done=await receipt(completionPath);checkBind(done,c);assert.equal(done.allPublished,true);assert.equal(done.samples,c.samples.length);assert.equal(done.method,'atomic-hardlinks-from-independent-staged-copies');assert.equal(done.files,c.entries.length);assert.equal(done.bytes,c.copyManifest.bytes);assert.equal(done.retainedStageFiles,c.entries.length);assert.equal(linked,c.entries.length);assert.equal(missingReceipts,0);assert.deepEqual(done.receipts,proofs,'Publication receipt set changed');}
 return {at:new Date().toISOString(),copiesConsistent:true,state:linked===0?'staged':linked===c.entries.length?'published':'partly-published',stagedFiles:c.entries.length-linked,publishedFiles:linked,retainedStageFiles:c.entries.length,claimedRoots,privateRoots:0,files:c.entries.length,bytes:c.copyManifest.bytes,payloadRehashed:rehashes>0,rehashedFiles:rehashes,pendingFileReceipts:missingReceipts,receipts:proofs};
}
async function publishSamples(options){
 const c=make(options);await paused(c);await verifyRecoverableCopy(c);const {files}=await originals(c);
 for(const d of c.dirs){
  await paused(c);if(await directoryProof(c,d))continue;const parent=await safe(path.dirname(d.path));const ip=names(c,'directory-intent',d.relative);let intent;
  if(await exists(ip)){intent=await receipt(ip);checkBind(intent,c);assert.equal(intent.destination,d.path);assert.equal(intent.relative,d.relative);assert.equal(intent.parentDev,parent.dev);assert.equal(intent.parentIno,parent.ino);}else intent=await write(ip,{...bind(c),at:new Date().toISOString(),relative:d.relative,destination:d.path,parentDev:parent.dev,parentIno:parent.ino});
  assert.equal(await exists(d.path),null,'Directory collision');await fs.mkdir(d.path,{mode:c.target.mode&0o777});await syncDir(path.dirname(d.path));const st=await safe(d.path);assert(st.isDirectory());assert.equal(st.uid,c.target.uid,'Unexpected NFS directory owner');assert.equal(st.gid,c.target.gid);assert.equal(st.mode&0o777,c.target.mode&0o777,'Unexpected NFS directory permissions');
  await write(names(c,'directory-claim',d.relative),{...bind(c),at:new Date().toISOString(),destination:d.path,intentSha256:intent.sha256,metadata:meta(st)});
 }
 for(const e of c.entries){
  await paused(c);let proof=await fileProof(c,e,files.get(e.fileId));if(proof.claim)continue;
  const ip=names(c,'file-intent',e.fileId);let intent;if(await exists(ip)){intent=await receipt(ip);checkBind(intent,c);}else{const parent=await safe(path.dirname(e.destination));intent=await write(ip,{...bind(c),at:new Date().toISOString(),fileId:e.fileId,source:e.stage,destination:e.destination,copyReceiptDigest:hash(files.get(e.fileId)),before:meta(files.get(e.fileId).destinationDigest.metadata),parentDev:parent.dev,parentIno:parent.ino});}
  if(!proof.linked){assert.equal(await exists(e.destination),null,'File collision');await paused(c);assert.equal((await fileProof(c,e,files.get(e.fileId))).linked,false);await (c.linkFile||fs.link)(e.stage,e.destination);await syncDir(path.dirname(e.destination));proof=await fileProof(c,e,files.get(e.fileId),{justLinked:true});}
  assert(proof.linked);const actual=await safe(e.destination);assert(same(actual,proof.metadata,[...stable,'nlink','ctimeMs']),'Linked inode changed before receipt');
  await write(names(c,'file-linked',e.fileId),{...bind(c),at:new Date().toISOString(),fileId:e.fileId,source:e.stage,destination:e.destination,intentSha256:intent.sha256,metadata:meta(actual)});
 }
 const proof=await verifyRecoverableCopy(c);assert.equal(proof.state,'published');assert.equal(proof.pendingFileReceipts,0);await paused(c);
 const output=path.join(c.publicationEvidenceDir,'published-verified.json');if(await exists(output))return receipt(output);
 return write(output,{...bind(c),at:new Date().toISOString(),allPublished:true,files:c.entries.length,bytes:c.copyManifest.bytes,samples:c.samples.length,retainedStageFiles:c.entries.length,method:'atomic-hardlinks-from-independent-staged-copies',receipts:proof.receipts});
}
async function verifyPublished(options){const r=await verifyRecoverableCopy(options);assert.equal(r.state,'published');assert.equal(r.pendingFileReceipts,0,'Publication receipts incomplete');assert(await exists(path.join(options.publicationEvidenceDir,'published-verified.json')),'Publication completion receipt missing');return {...r,allVerified:true};}
module.exports={publishSamples,verifyPublished,verifyRecoverableCopy};
