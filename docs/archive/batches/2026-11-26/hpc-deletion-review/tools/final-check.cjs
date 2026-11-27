'use strict';
// Final read-only recheck; fresh current HEADs must match previously captured version IDs.
// Explicit version reads are unavailable to this role (GetObjectVersion is not granted).
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
const {connect,createAws,api,sha}=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const {compareTreeToManifest}=require(api+'/lib/s3-archive/inventory');
const {verifyHead}=require(api+'/lib/s3-archive/upload');
const {resolveHpcPreservation}=require(api+'/lib/hpc-preservation');
const read=p=>JSON.parse(fs.readFileSync(__dirname+'/'+p));
const save=(p,d)=>fs.writeFileSync(__dirname+'/'+p,JSON.stringify(d,null,2)+'\n',{flag:'wx',mode:0o600});
let c;
(async()=>{
 assert.deepEqual(process.argv.slice(2),['--review']);
 const pre=read('preflight.json'),summary=read('summary.json');assert.equal(summary.total,170);
 const candidates=pre.projects.filter(p=>!p.excluded);
 const large=[...candidates].sort((a,b)=>b.bytes-a.bytes)[0].projectId;
 const many=[...candidates].sort((a,b)=>b.fileCount-a.fileCount)[0].projectId;
 const registered=[...candidates].filter(p=>p.projectId.startsWith('6ada')).sort((a,b)=>b.fileCount-a.fileCount)[0].projectId;
 const deep=new Set([large,many,registered,'5fc012bda3efcb29338b7d4b']);
 c=await connect();assert.equal(c.toolVersion,pre.apiHead,'API checkout changed during audit');
 let index=0;const results=[];
 async function work(){while(index<candidates.length){const r=candidates[index++],id=r.projectId;try{
  const native=read(id+'/result.json');assert.equal(native.exitCode,0,native.stderr||native.error);assert(!native.stderr.trim());
  const source=fs.readFileSync(__dirname+'/'+id+'/source-manifest.v1.json');assert.equal(sha(source),r.sourceSha256);
  const verification=fs.readFileSync(__dirname+'/'+id+'/verification-report.v1.json');assert.equal(sha(verification),r.verificationSha256);
  const m=JSON.parse(source),v=JSON.parse(verification);assert(v.verified);assert.equal(v.sourceManifestSha256,r.sourceSha256);
  Object.defineProperty(m,'sourceManifestSha256',{value:r.sourceSha256});
  const payload=m.entries.filter(e=>e.disposition==='copy'),uncopied=m.entries.filter(e=>e.disposition!=='copy'&&e.type!=='dir');assert.equal(uncopied.length,0,'Unarchived non-directory entries');
  assert.equal(payload.length,r.fileCount);assert.equal(payload.reduce((a,e)=>a+e.size,0),r.bytes);
  const heads=fs.readFileSync(__dirname+'/'+id+'/heads.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const headByKey=new Map(heads.map(h=>[h.key,h]));
  for(const e of payload){const h=headByKey.get(e.s3Key)?.head;assert(h,'Missing HEAD');assert(verifyHead(h,m,e).ok);assert.equal(h.ServerSideEncryption,'AES256');assert(h.VersionId&&h.VersionId!=='null');assert(Date.parse(h.LastModified)<=Date.parse(r.s3VerifiedAt),'Object changed after verification');const old=v.entries.find(x=>x.s3Key===e.s3Key);assert(old&&old.verified);assert.equal(old.contentLength,h.ContentLength);assert.equal(old.checksumCRC64NVME,h.ChecksumCRC64NVME);}
  const aws=createAws(c.config),listed=await aws.listObjectsAtOrBelow(m.dataKeyPrefix);assert.deepEqual(listed.map(x=>x.Key).sort(),payload.map(x=>x.s3Key).sort());
  const byKey=new Map(payload.map(e=>[e.s3Key,e]));for(const o of listed){assert.equal(o.Size,byKey.get(o.Key).size);const h=headByKey.get(o.Key).head;assert.equal(o.ETag,h.ETag,'Object ETag changed after native check');assert.equal(Date.parse(o.LastModified),Date.parse(h.LastModified),'Object modified after native check');assert(Date.parse(o.LastModified)<=Date.parse(r.s3VerifiedAt));}
  const multipart=await aws.listMultipartUploads(m.dataKeyPrefix+'/');assert.equal(multipart.length,0);
  const tree=await compareTreeToManifest(r.hpcPath,m.entries);assert(tree.matches,JSON.stringify(tree.differences));
  const p=await c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId(id)});assert.equal(p.path,'/'+m.sourceRelativeRoot);assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');assert.equal(String(p.archiveMigration.id),r.migrationId);assert.equal(p.storage.s3Uri,r.s3Uri);assert.equal(p.archiveMigration.manifests.sourceSha256,r.sourceSha256);assert.equal(p.archiveMigration.manifests.verificationSha256,r.verificationSha256);assert.equal(p.storage.s3VerifiedAt.toISOString(),r.s3VerifiedAt);const hold=resolveHpcPreservation(p);assert(!hold.active&&!hold.invalid);
  const samples=[];
  if(deep.has(id)){
   const entries=[...new Map([payload[0],payload.at(-1),[...payload].sort((a,b)=>b.size-a.size)[0]].map(e=>[e.s3Key,e])).values()];
   for(const e of entries){const previous=headByKey.get(e.s3Key).head;const h=await aws.headObject(e.s3Key);assert(verifyHead(h,m,e).ok);assert.equal(h.VersionId,previous.VersionId);assert.equal(h.ServerSideEncryption,'AES256');samples.push({key:e.s3Key,versionId:previous.VersionId,method:'fresh-current-head-compared-to-native-version',head:h});}
  }
  if(id==='5fc012bda3efcb29338b7d4b'){const pilot=pre.pilot,e=payload.find(e=>e.s3Key===pilot.key);assert(e);assert.equal(e.sha256,pilot.sha256);assert.equal(e.crc64nvme,pilot.crc64nvme);assert.equal(e.size,pilot.bytes);assert.equal(headByKey.get(e.s3Key).head.VersionId,pilot.versionId);}
  const result={projectId:id,name:p.name,at:new Date().toISOString(),passed:true,hpcPath:'/tsl/data/reads/'+m.sourceRelativeRoot,vmPath:r.hpcPath,s3Uri:r.s3Uri,bytes:r.bytes,files:r.fileCount,emptyOrStructuralDirectories:m.entries.filter(e=>e.type==='dir').length,preservation:hold,tree,inventory:listed,multipart,deepSamples:samples};save(id+'/final-check-r2.json',result);results.push(result);
 }catch(e){const result={projectId:id,passed:false,at:new Date().toISOString(),error:e.stack};save(id+'/final-check-r2.json',result);results.push(result);}}}
 await Promise.all(Array.from({length:4},work));
 const mounted=JSON.parse(cp.execFileSync('findmnt',['-J','-T','/mnt/reads','-o','TARGET,SOURCE,FSTYPE'],{encoding:'utf8'})).filesystems[0];assert.deepEqual(mounted,pre.mount);
 save('final-review-r2.json',{at:new Date().toISOString(),apiHead:c.toolVersion,mount:mounted,total:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed),representatives:[...deep],projects:results.map(({inventory,tree,deepSamples,...r})=>r)});
 console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed)}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(c)await c.mongoose.disconnect();});
