'use strict';
// Scoped physical copy only. No database imports, service control or S3 writes.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const inside = (root,p) => p===root || p.startsWith(root+path.sep);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const meta = s => ({dev:s.dev,ino:s.ino,size:s.size,mode:s.mode,uid:s.uid,gid:s.gid,nlink:s.nlink,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,type:s.isFile()?'file':s.isDirectory()?'dir':'unsafe'});
const same = (a,b,fields=['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs']) => fields.every(k=>k.endsWith('Ms')?Math.abs(a[k]-b[k])<=1:a[k]===b[k]);
async function exists(p) {try {return await fs.lstat(p);} catch(e) {if(e.code==='ENOENT')return null;throw e;}}
async function safePath(p,{missing=false}={}) {
  assert(path.isAbsolute(p));assert.equal(path.normalize(p),p);
  let current=path.parse(p).root;
  const pieces=p.slice(current.length).split(path.sep).filter(Boolean);
  for(let i=0;i<pieces.length;i++) {
    current=path.join(current,pieces[i]);const s=await exists(current);
    if(!s){assert(missing && i===pieces.length-1,'Missing path component: '+current);return null;}
    assert(!s.isSymbolicLink(),'Symlink component: '+current);
    if(i<pieces.length-1)assert(s.isDirectory(),'Not a directory: '+current);
    if(i===pieces.length-1)return s;
  }
}
async function writeOnce(p,value) {
  const h=await fs.open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o660);
  try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
  await syncDir(path.dirname(p));
}
async function readJson(p){await safePath(p);return JSON.parse(await fs.readFile(p,'utf8'));}
async function syncDir(p){const h=await fs.open(p,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}

function context(options) {
  const {copyManifest,filesystemEvidence,scope,stageRoot,evidenceDir,operationId,planSha256}=options;
  assert(/^[a-f0-9-]{36}$/.test(operationId));assert(/^[a-f0-9]{64}$/.test(planSha256));
  assert.equal(copyManifest.entries.length,copyManifest.count);assert.equal(copyManifest.entries.reduce((n,e)=>n+e.bytes,0),copyManifest.bytes);
  assert.equal(new Set(copyManifest.entries.map(e=>e.fileId)).size,copyManifest.count);
  assert.equal(new Set(copyManifest.entries.map(e=>e.destination)).size,copyManifest.count);
  assert.equal(new Set(scope.matches.map(m=>m.sample._id)).size,scope.matches.length);
  const target=filesystemEvidence.roots.find(r=>r.projectId===scope.targetProject._id);
  assert(target?.canonicalPath && target.type==='dir');
  const destinationRoot=target.canonicalPath;
  assert.equal(path.dirname(stageRoot),path.dirname(destinationRoot),'Stage must be a sibling of the destination Project');
  assert(path.basename(stageRoot).startsWith('.gulnara-staging-'),'Unreviewed staging prefix');
  assert(!inside(destinationRoot,stageRoot));assert(!inside(stageRoot,evidenceDir));
  const samples=scope.matches.map(m=>{
    const observed=filesystemEvidence.samples.find(s=>s.sampleId===m.sample._id);
    assert(observed && observed.sourcePath && observed.destinationPath);
    const name=m.sample.safeName;assert(name && name!=='.' && name!=='..' && !name.includes('/'));
    assert.equal(observed.destinationPath,path.join(destinationRoot,name));
    assert.equal(path.basename(observed.sourcePath),name);
    return {id:m.sample._id,name,source:observed.sourcePath,stage:path.join(stageRoot,name),destination:observed.destinationPath,entries:observed.entries};
  });
  const entries=copyManifest.entries.map(e=>{
    const sample=samples.find(s=>s.id===e.sampleId);assert(sample);
    assert(inside(sample.source,e.source) && e.source!==sample.source);assert(inside(sample.destination,e.destination));
    const rel=path.relative(sample.destination,e.destination);assert.equal(path.relative(sample.source,e.source),rel);
    assert(/^[a-f0-9]{24}$/.test(e.fileId));assert(/^[a-f0-9]{64}$/.test(e.sha256));assert(typeof e.crc64nvme==='string');
    return {...e,stage:path.join(sample.stage,rel),receipt:path.join(evidenceDir,'file-'+e.fileId+'.json')};
  });
  return {...options,destinationRoot,target,samples,entries,copyDigest:hash(copyManifest),evidenceDigest:hash(filesystemEvidence)};
}
async function tree(root) {
  const rows=[];
  async function walk(p) {
    const s=await safePath(p);const row={path:p,relative:path.relative(root,p),...meta(s)};assert(row.type!=='unsafe','Unsafe tree entry: '+p);rows.push(row);
    if(row.type==='dir')for(const name of (await fs.readdir(p)).sort())await walk(path.join(p,name));
  }
  await walk(root);return rows;
}
async function verifySourceMetadata(options) {
  const c=context(options);
  for(const sample of c.samples){
    const rows=await tree(sample.source);
    const expected=new Map(sample.entries.map(e=>[e.relPath.split('/').slice(1).join('/'),e]));
    assert.equal(rows.length,expected.size,'Source tree entry count changed');
    for(const row of rows){const old=expected.get(row.relative);assert(old,'Unexpected source entry');assert.equal(row.type,old.type);assert(same(row,old,row.type==='dir'?['dev','ino','mode','uid','gid','nlink','mtimeMs','ctimeMs']:undefined),'Source metadata changed: '+row.path);}
  }
  return {at:new Date().toISOString(),samples:c.samples.length,files:c.entries.length,unchanged:true};
}

// Use the deployed, already-reviewed checksum implementation. No dependency
// install or alternate checksum polynomial is introduced by this operation.
function createNodeCrcFactory(Crc64Nvme) {
  assert.equal(typeof Crc64Nvme,'function');
  return async()=>{const crc=new Crc64Nvme();return {
    update:async chunk=>{crc.update(chunk);},digest:async()=>crc.toBase64(),abort:async()=>{},
  };};
}
async function digestHandle(handle,crcFactory,onChunk) {
  assert.equal(typeof crcFactory,'function','Explicit checksum implementation required');
  const crc=await crcFactory(), sha=crypto.createHash('sha256');let bytes=0;
  try {
    for await(const chunk of handle.createReadStream({autoClose:false,start:0,highWaterMark:4*1024*1024})) {
      sha.update(chunk);await crc.update(chunk);if(onChunk)await onChunk(chunk);bytes+=chunk.length;
    }
    return {bytes,sha256:sha.digest('hex'),crc64nvme:await crc.digest()};
  }catch(error){await crc.abort?.();throw error;}
}
function assertDigest(actual,expected) {for(const k of ['bytes','sha256','crc64nvme'])assert.equal(actual[k],expected[k],'Payload '+k+' mismatch');}
async function digestFile(filename,crcFactory,expectedMetadata) {
  const before=await safePath(filename);assert(before.isFile());
  const h=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const initial=meta(await h.stat());assert(same(initial,meta(before)),'File replaced before hashing');
    if(expectedMetadata)assert(same(initial,expectedMetadata),'File differs from expected metadata');
    const result=await digestHandle(h,crcFactory);
    assert(same(initial,meta(await h.stat())) && same(initial,meta(await fs.lstat(filename))),'File changed while hashing');
    return {...result,metadata:initial};
  }finally{await h.close();}
}
async function copyOne(c,entry) {
  await safePath(entry.source);await safePath(path.dirname(entry.stage));
  assert.equal(await exists(entry.stage),null,'Unreceipted/partial staging file exists; inspect it before recovery');
  const source=await fs.open(entry.source,constants.O_RDONLY|constants.O_NOFOLLOW);let destination;
  try {
    const sourceBefore=meta(await source.stat());assert(same(sourceBefore,entry.sourceMetadata),'Source changed before copy');
    destination=await fs.open(entry.stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,entry.sourceMetadata.mode&0o777);
    const sourceDigest=await digestHandle(source,c.crcFactory,async chunk=>{let at=0;while(at<chunk.length){const w=await destination.write(chunk,at,chunk.length-at,null);assert(w.bytesWritten>0);at+=w.bytesWritten;}});
    assertDigest(sourceDigest,entry);
    assert(same(sourceBefore,meta(await source.stat())) && same(sourceBefore,meta(await fs.lstat(entry.source))),'Source changed during copy');
    await destination.chmod(entry.sourceMetadata.mode&0o777);await destination.chown(-1,c.target.gid);
    await destination.utimes(new Date(entry.sourceMetadata.mtimeMs),new Date(entry.sourceMetadata.mtimeMs));await destination.sync();await destination.close();destination=null;
    const copied=await digestFile(entry.stage,c.crcFactory);
    assertDigest(copied,entry);assert(!(copied.metadata.dev===sourceBefore.dev && copied.metadata.ino===sourceBefore.ino),'Copy shares source inode');
    assert.equal(copied.metadata.nlink,1,'Destination file must be independent');
    const receipt={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,copyDigest:c.copyDigest,fileId:entry.fileId,
      source:entry.source,stage:entry.stage,destination:entry.destination,sourceDigest,destinationDigest:copied,sourceMetadata:sourceBefore};
    await writeOnce(entry.receipt,receipt);await syncDir(path.dirname(entry.stage));return receipt;
  }finally{await source.close();if(destination)await destination.close();}
}
async function validateFileReceipt(c,entry,{at=entry.stage,rehash=true}={}) {
  const r=await readJson(entry.receipt);assert.equal(r.operationId,c.operationId);assert.equal(r.planSha256,c.planSha256);assert.equal(r.copyDigest,c.copyDigest);assert.equal(r.fileId,entry.fileId);assert.equal(r.stage,entry.stage);assert.equal(r.source,entry.source);assert.equal(r.destination,entry.destination);
  assertDigest(r.sourceDigest,entry);assertDigest(r.destinationDigest,entry);
  const stat=meta(await safePath(at));assert(same(stat,r.destinationDigest.metadata),'Copied file metadata changed');
  if(rehash)assertDigest(await digestFile(at,c.crcFactory,r.destinationDigest.metadata),entry);
  return r;
}
async function verifyCopyTree(c,{published=false,rehash=false}={}) {
  for(const sample of c.samples) {
    await verifySampleTree(sample,published?sample.destination:sample.stage);
  }
  for(const entry of c.entries)await validateFileReceipt(c,entry,{at:published?entry.destination:entry.stage,rehash});
}
async function verifySampleTree(sample,root) {
  const rows=await tree(root),expected=new Map(sample.entries.map(e=>[e.relPath.split('/').slice(1).join('/'),e.type]));
  assert.equal(rows.length,expected.size,'Copy tree entry count changed');
  for(const row of rows)assert.equal(row.type,expected.get(row.relative),'Copy tree entry differs');
}
async function targetIdentity(c) {
  const actual=meta(await safePath(c.destinationRoot));assert.equal(actual.type,'dir');
  assert(same(actual,c.target,['dev','ino','uid','gid','mode']),'Destination Project root identity changed');
}
async function stageCopy(options) {
  const c=context(options);assert.equal(typeof c.crcFactory,'function');assert.equal(typeof c.inspectSource,'function');
  await targetIdentity(c);await safePath(path.dirname(c.stageRoot));await safePath(c.evidenceDir);
  assert.equal((await fs.stat(path.dirname(c.stageRoot))).dev,(await fs.stat(c.destinationRoot)).dev,'Stage is not on destination filesystem');
  const preflight=await c.inspectSource();assert(preflight.ok && preflight.issues.length===0,'Source preflight failed');await verifySourceMetadata(c);
  for(const s of c.samples)assert.equal(await exists(s.destination),null,'Destination already occupied');
  const identityFile=path.join(c.evidenceDir,'stage-identity.json');
  if(await exists(c.stageRoot)) {
    const identity=await readJson(identityFile);assert.equal(identity.operationId,c.operationId);assert.equal(identity.copyDigest,c.copyDigest);assert.equal(identity.planSha256,c.planSha256);assert.equal(identity.stageRoot,c.stageRoot);
    const st=await safePath(c.stageRoot);assert.equal(st.dev,identity.dev);assert.equal(st.ino,identity.ino);
  }else{
    assert.equal(await exists(identityFile),null,'Stage identity exists without its directory');
    await fs.mkdir(c.stageRoot,{mode:0o770});await fs.chown(c.stageRoot,-1,c.target.gid);const st=await fs.stat(c.stageRoot);
    await writeOnce(identityFile,{operationId:c.operationId,copyDigest:c.copyDigest,planSha256:c.planSha256,stageRoot:c.stageRoot,dev:st.dev,ino:st.ino,at:new Date().toISOString()});
  }
  for(const sample of c.samples)for(const directory of sample.entries.filter(e=>e.type==='dir').sort((a,b)=>a.relPath.length-b.relPath.length)) {
    const rel=directory.relPath.split('/').slice(1).join('/'),dest=path.join(sample.stage,rel);
    const current=await exists(dest);if(!current){await safePath(path.dirname(dest));await fs.mkdir(dest,{mode:0o770});await fs.chown(dest,-1,c.target.gid);}else assert((await safePath(dest)).isDirectory(),'Staging path is not directory');
  }
  const receipts=[];
  for(const entry of c.entries){
    const r=await exists(entry.receipt)?await validateFileReceipt(c,entry,{rehash:true}):await copyOne(c,entry);receipts.push(r);
    await c.onProgress?.({at:new Date().toISOString(),completed:receipts.length,total:c.entries.length,bytes:receipts.reduce((n,r)=>n+r.sourceDigest.bytes,0),fileId:entry.fileId});
  }
  for(const sample of c.samples)for(const directory of sample.entries.filter(e=>e.type==='dir').sort((a,b)=>b.relPath.length-a.relPath.length)) {
    const dest=path.join(sample.stage,directory.relPath.split('/').slice(1).join('/'));await fs.chmod(dest,directory.mode&0o777);await fs.utimes(dest,new Date(directory.mtimeMs),new Date(directory.mtimeMs));
  }
  await verifyCopyTree(c);const sourceFinal=await verifySourceMetadata(c);const finalPreflight=await c.inspectSource();assert(finalPreflight.ok && finalPreflight.issues.length===0,'Final source preflight failed');
  const receipt={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,copyDigest:c.copyDigest,stageRoot:c.stageRoot,files:c.entries.length,bytes:c.copyManifest.bytes,allVerified:true,sourceFinal,receiptDigests:receipts.map(r=>({fileId:r.fileId,digest:hash(r)}))};
  const output=path.join(c.evidenceDir,'copy-verified.json');
  if(await exists(output)){const old=await readJson(output);assert.equal(old.operationId,c.operationId);assert.equal(old.copyDigest,c.copyDigest);assert.equal(old.planSha256,c.planSha256);assert.deepEqual(old.receiptDigests,receipt.receiptDigests);return old;}
  await writeOnce(output,receipt);return receipt;
}
async function pause(c) {
  assert.equal(typeof c.assertPaused,'function','Live maintenance verification required');const p=await c.assertPaused();
  assert(p && p.allApiInstancesStopped===true && p.externalWritersFrozen===true && p.windowOperator==='tsldata');
  assert(Date.parse(p.expiresAt)>Date.now(),'Maintenance receipt expired');assert(p.runId);return p;
}
async function verifyChildTree(c,sample,name,root) {
  const rows=await tree(root),expected=new Map(sample.entries.filter(e=>e.relPath.startsWith(sample.name+'/'+name+'/') || e.relPath===sample.name+'/'+name).map(e=>[e.relPath.split('/').slice(2).join('/'),e.type]));
  assert.equal(rows.length,expected.size,'Copy child tree entry count changed');
  for(const row of rows)assert.equal(row.type,expected.get(row.relative),'Copy child tree differs');
  for(const entry of c.entries.filter(e=>e.sampleId===sample.id && path.relative(sample.stage,e.stage).split(path.sep)[0]===name)) {
    const rel=path.relative(path.join(sample.stage,name),entry.stage);await validateFileReceipt(c,entry,{at:path.join(root,rel),rehash:false});
  }
}
function childrenOf(sample) {
  const rows=sample.entries.filter(e=>e.relPath.split('/').length===2);
  assert(rows.every(e=>e.type==='dir'),'This publication requires directory-only immediate children');
  return rows.map(e=>e.relPath.split('/')[1]).sort();
}
async function publishSamples(options) {
  const c=context(options);const verified=await readJson(path.join(c.evidenceDir,'copy-verified.json'));
  assert(verified.allVerified && verified.files===c.entries.length && verified.bytes===c.copyManifest.bytes);assert.equal(verified.operationId,c.operationId);assert.equal(verified.planSha256,c.planSha256);assert.equal(verified.copyDigest,c.copyDigest);
  await pause(c);await targetIdentity(c);await verifySourceMetadata(c);const publications=[];
  // Every byte remains staged or already published under a recorded claim.
  // Validate the entire hybrid tree before publishing any further child.
  for(const sample of c.samples) {
    await safePath(sample.stage);const allowed=childrenOf(sample),stageNames=await fs.readdir(sample.stage);
    assert(stageNames.every(n=>allowed.includes(n)),'Unexpected staged child');
    const final=await exists(sample.destination);
    if(final){
      const claimPath=path.join(c.evidenceDir,'claimed-'+sample.id+'.json');assert(await exists(claimPath),'Unreceipted target root/collision');
      const claim=await readJson(claimPath);assert.equal(claim.operationId,c.operationId);assert.equal(claim.planSha256,c.planSha256);assert.equal(claim.destination,sample.destination);
      const actual=await safePath(sample.destination);assert.equal(actual.dev,claim.dev);assert.equal(actual.ino,claim.ino);
      assert((await fs.readdir(sample.destination)).every(n=>allowed.includes(n)),'Unexpected published child');
    }
    for(const name of allowed){
      const a=path.join(sample.stage,name),b=path.join(sample.destination,name),sa=await exists(a),sb=final?await exists(b):null;
      assert(!!sa!==!!sb,'Child must exist at exactly one scoped location');
      if(sb){const intent=await readJson(path.join(c.evidenceDir,'child-intent-'+sample.id+'-'+name+'.json'));assert.equal(intent.operationId,c.operationId);assert.equal(intent.planSha256,c.planSha256);assert.equal(intent.source,a);assert.equal(intent.destination,b);assert.equal(sb.dev,intent.dev);assert.equal(sb.ino,intent.ino);}
      await verifyChildTree(c,sample,name,sa?a:b);
    }
  }
  for(const sample of c.samples) {
    const paused=await pause(c),sampleStat=await safePath(sample.stage),children=childrenOf(sample);
    const intentPath=path.join(c.evidenceDir,'publish-intent-'+sample.id+'.json'),claimPath=path.join(c.evidenceDir,'claimed-'+sample.id+'.json'),receiptPath=path.join(c.evidenceDir,'published-'+sample.id+'.json');
    let intent;
    if(await exists(intentPath)){intent=await readJson(intentPath);assert.equal(intent.operationId,c.operationId);assert.equal(intent.planSha256,c.planSha256);assert.equal(intent.source,sample.stage);assert.equal(intent.destination,sample.destination);assert.equal(sampleStat.dev,intent.stageDev);assert.equal(sampleStat.ino,intent.stageIno);}
    else {assert.equal(await exists(sample.destination),null,'Publication target collision');intent={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,sampleId:sample.id,source:sample.stage,destination:sample.destination,stageDev:sampleStat.dev,stageIno:sampleStat.ino,runId:paused.runId};await writeOnce(intentPath,intent);}
    let claim;
    if(await exists(claimPath)){claim=await readJson(claimPath);assert.equal(claim.intentDigest,hash(intent));}
    else {
      assert.equal(await exists(sample.destination),null,'Unreceipted target root/collision');await targetIdentity(c);await pause(c);
      // mkdir is the atomic no-overwrite claim supported by this NFS server.
      await fs.mkdir(sample.destination,{mode:0o700});await fs.chown(sample.destination,-1,c.target.gid);await fs.chmod(sample.destination,0o700);await syncDir(path.dirname(sample.destination));
      const st=await fs.stat(sample.destination);claim={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,sampleId:sample.id,destination:sample.destination,dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,intentDigest:hash(intent)};await writeOnce(claimPath,claim);
    }
    const assertClaim=async({finalizing=false}={})=>{
      const st=await safePath(sample.destination);assert(st.isDirectory());assert.equal(st.dev,claim.dev);assert.equal(st.ino,claim.ino);assert.equal(st.uid,claim.uid);assert.equal(st.gid,claim.gid);
      assert.equal(st.uid,process.getuid(),'Publication must own its private destination root');
      if(!finalizing)assert.equal(st.mode&0o777,0o700,'Claimed root must remain private until all children are published');
    };
    const finalizingPath=path.join(c.evidenceDir,'finalizing-'+sample.id+'.json'),finalizing=await exists(finalizingPath);
    if(finalizing){const marker=await readJson(finalizingPath);assert.equal(marker.claimDigest,hash(claim));await assertClaim({finalizing:true});}
    else await assertClaim();
    for(const name of children) {
      const a=path.join(sample.stage,name),b=path.join(sample.destination,name),childIntentPath=path.join(c.evidenceDir,'child-intent-'+sample.id+'-'+name+'.json'),childReceiptPath=path.join(c.evidenceDir,'child-published-'+sample.id+'-'+name+'.json');
      let ci;const sa=await exists(a),sb=await exists(b);
      if(await exists(childIntentPath)){ci=await readJson(childIntentPath);assert.equal(ci.operationId,c.operationId);assert.equal(ci.planSha256,c.planSha256);assert.equal(ci.claimDigest,hash(claim));assert.equal(ci.source,a);assert.equal(ci.destination,b);}
      else {assert(sa && !sb,'Child publication collision');ci={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,claimDigest:hash(claim),source:a,destination:b,dev:sa.dev,ino:sa.ino};await writeOnce(childIntentPath,ci);}
      if(sa){assert(!finalizing,'Finalized root still has an unpublished child');assert(!sb,'Child publication collision');assert.equal(sa.dev,ci.dev);assert.equal(sa.ino,ci.ino);await verifyChildTree(c,sample,name,a);await pause(c);await assertClaim();assert.equal(await exists(b),null,'Child target appeared');
        // All writers are frozen; the newly claimed root is 0700 and held by the
        // parent mutation lock. Fixed child directories are the only rename set.
        await (c.renameChild || fs.rename)(a,b);await syncDir(sample.destination);await syncDir(sample.stage);
      }else {assert(sb,'Child absent from both locations');assert.equal(sb.dev,ci.dev);assert.equal(sb.ino,ci.ino);}
      const current=await safePath(b);assert.equal(current.dev,ci.dev);assert.equal(current.ino,ci.ino);await verifyChildTree(c,sample,name,b);
      if(await exists(childReceiptPath)){const r=await readJson(childReceiptPath);assert.equal(r.intentDigest,hash(ci));assert.equal(r.operationId,c.operationId);}
      else await writeOnce(childReceiptPath,{at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,intentDigest:hash(ci),source:a,destination:b,dev:current.dev,ino:current.ino});
    }
    assert.deepEqual(await fs.readdir(sample.stage),[],'Staging sample not empty after publication');await verifySampleTree(sample,sample.destination);await pause(c);
    if(!finalizing)await writeOnce(finalizingPath,{at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,claimDigest:hash(claim)});
    const originalRoot=sample.entries.find(e=>e.relPath===sample.name);assert(originalRoot?.type==='dir');
    await fs.chmod(sample.destination,originalRoot.mode&0o777);await fs.utimes(sample.destination,new Date(originalRoot.mtimeMs),new Date(originalRoot.mtimeMs));await syncDir(sample.destination);
    const current=await safePath(sample.destination);
    if(await exists(receiptPath)){const r=await readJson(receiptPath);assert.equal(r.operationId,c.operationId);assert.equal(r.planSha256,c.planSha256);assert.equal(r.claimDigest,hash(claim));publications.push(r);}
    else {const r={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,sampleId:sample.id,source:sample.stage,destination:sample.destination,dev:current.dev,ino:current.ino,claimDigest:hash(claim),runId:paused.runId,method:'exclusive-private-root-then-scoped-child-directories'};await writeOnce(receiptPath,r);publications.push(r);}
  }
  await verifyCopyTree(c,{published:true});await verifySourceMetadata(c);await pause(c);
  const receipt={at:new Date().toISOString(),operationId:c.operationId,planSha256:c.planSha256,copyDigest:c.copyDigest,allPublished:true,samples:publications.length,files:c.entries.length,bytes:c.copyManifest.bytes,method:'exclusive-private-root-then-scoped-child-directories'};
  const output=path.join(c.evidenceDir,'published-verified.json');if(await exists(output)){const old=await readJson(output);assert.equal(old.operationId,c.operationId);assert.equal(old.planSha256,c.planSha256);assert.equal(old.copyDigest,c.copyDigest);return old;}await writeOnce(output,receipt);return receipt;
}
async function verifyPublished(options){
  const c=context(options);await targetIdentity(c);
  for(const sample of c.samples){
    const claim=await readJson(path.join(c.evidenceDir,'claimed-'+sample.id+'.json'));
    const receipt=await readJson(path.join(c.evidenceDir,'published-'+sample.id+'.json'));
    assert.equal(claim.operationId,c.operationId);assert.equal(claim.planSha256,c.planSha256);assert.equal(claim.destination,sample.destination);
    assert.equal(receipt.operationId,c.operationId);assert.equal(receipt.planSha256,c.planSha256);assert.equal(receipt.claimDigest,hash(claim));
    const st=await safePath(sample.destination);assert(same(meta(st),claim,['dev','ino','uid','gid']),'Published root identity changed');
    assert.equal(st.mode&0o777,sample.entries.find(e=>e.relPath===sample.name).mode&0o777,'Published root permissions changed');
  }
  await verifyCopyTree(c,{published:true,rehash:options.rehash===true});await verifySourceMetadata(c);return {at:new Date().toISOString(),allVerified:true,files:c.entries.length,bytes:c.copyManifest.bytes};
}
module.exports={stageCopy,publishSamples,verifyPublished,verifySourceMetadata,createNodeCrcFactory,digestFile,context};
