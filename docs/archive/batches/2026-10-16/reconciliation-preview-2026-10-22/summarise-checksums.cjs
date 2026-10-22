// Merge successful current-observation receipts into the local live preview.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const folder=__dirname,read=f=>JSON.parse(fs.readFileSync(path.join(folder,f)));
const lines=f=>fs.readFileSync(path.join(folder,f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const runs=[
  ['hash-20261022T165213Z','current-checksum-targets-initial.json'],
  ['hash-20261022T165341Z','current-checksum-targets-path-corrections.json'],
];
const verified=new Map(),receipts=[];
for(const [name,targetFile]of runs){
  const receipt=read('live-evidence/'+name+'.command.json');
  assert.equal(receipt.exitCode,0);
  const bytes=fs.readFileSync(path.join(folder,'live-evidence/'+name+'.jsonl'));
  assert.equal(sha(bytes),receipt.outputSha256);
  const events=bytes.toString().trim().split('\n').map(JSON.parse),start=events[0],end=events.at(-1);
  assert.equal(start.type,'start');assert.equal(end.type,'complete');assert.equal(end.errors,0);
  assert.equal(start.collectorSha256,receipt.collectorSha256);
  assert.equal(sha(fs.readFileSync(path.join(folder,'live-evidence/collector-current-checksums.cjs'))),start.collectorSha256);
  const targets=read(targetFile);assert.equal(sha(JSON.stringify(targets)),receipt.targetsSha256);
  const expected=new Map(targets.flatMap(t=>t.files.map(f=>[t.entryId+'|'+f.relPath,{file:f,root:t.root}])));
  const completed=events.filter(e=>e.type==='checksum');assert.equal(completed.length,expected.size);assert.equal(end.completed,expected.size);
  for(const event of completed){const key=event.entryId+'|'+event.relPath;const target=expected.get(key);assert(target);assert(!verified.has(key));assert.equal(event.canonicalPath,target.root+'/'+target.file.relPath);assert.equal(event.bytes,target.file.size);assert.equal(event.stable,true);assert.equal(event.purpose,'current-baseline-only');assert.equal(event.historicalVerification,'not-established');assert.match(event.md5,/^[a-f0-9]{32}$/);assert.match(event.sha256,/^[a-f0-9]{64}$/);verified.set(key,{...event,receipt:'live-evidence/'+name+'.command.json'});}
  receipts.push({file:'live-evidence/'+name+'.command.json',sha256:sha(fs.readFileSync(path.join(folder,'live-evidence/'+name+'.command.json'))),completed:end.completed,bytes:end.totalBytes,startedAt:start.at,finishedAt:end.at});
}
const inventory=lines('live-evidence/inventory-20261022T164605Z.jsonl');
const files=lines('live-files.jsonl');
for(const file of files){const digest=verified.get(file.entryId+'|'+file.relPath);file.currentChecksum=digest?{md5:digest.md5,sha256:digest.sha256,bytes:digest.bytes,observedAt:digest.observedAt,byteScope:digest.byteScope,historicalVerification:digest.historicalVerification,stable:digest.stable,receipt:digest.receipt}:null;}
const scope=files.filter(f=>f.inArchiveScope),pending=scope.filter(f=>!f.currentChecksum),targets=[];
for(const event of inventory.filter(e=>e.type==='project')){const names=new Set(pending.filter(f=>f.entryId===event.entryId).map(f=>f.relPath));const entries=(event.inventory?.entries||[]).filter(e=>e.type==='file'&&names.has(e.relPath));if(entries.length)targets.push({entryId:event.entryId,root:event.physicalRoot,files:entries});}
const totalBytes=scope.reduce((n,f)=>n+f.bytes,0),completedBytes=[...verified.values()].reduce((n,v)=>n+v.bytes,0);
assert.equal(read('policy.json').checksumPolicy.separateBulkSweep,false);
const report={at:new Date().toISOString(),status:'partial-current-observations-retained; separate-bulk-audit-sweep-cancelled',separateBulkSweep:false,remainingMeasurementRoute:'normal-per-project-archive-manifest-and-upload-verification',archiveFileCount:scope.length,archiveBytes:totalBytes,completedFiles:verified.size,completedBytes,pendingFiles:pending.length,pendingBytes:totalBytes-completedBytes,errors:0,legacyFieldsChanged:0,databaseWrites:0,productionFilesystemWrites:0,receipts,note:'Initial pass covers files <=1 MiB, all three pilot projects, and the three proposed filename corrections. pendingFiles/pendingBytes and current-checksum-pending.json describe audit coverage only: no queued or required audit sweep. Normal archive copy still hashes each project before transfer and checks streamed bytes and S3. Preserve legacy verification gaps.'};
assert.equal(report.completedFiles+report.pendingFiles,scope.length);
fs.writeFileSync(path.join(folder,'live-files.jsonl'),files.map(f=>JSON.stringify(f)).join('\n')+'\n');
fs.writeFileSync(path.join(folder,'current-checksums.jsonl'),[...verified.values()].map(v=>JSON.stringify(v)).join('\n')+'\n');
fs.writeFileSync(path.join(folder,'current-checksum-pending.json'),JSON.stringify(targets,null,2)+'\n');
fs.writeFileSync(path.join(folder,'current-checksum-summary.json'),JSON.stringify(report,null,2)+'\n');
const summary=read('live-summary.json');summary.currentChecksumsCalculated=verified.size;summary.currentChecksumBytes=completedBytes;summary.currentChecksumsPending=pending.length;summary.currentChecksumPendingBytes=report.pendingBytes;summary.currentChecksumStatus=report.status;
fs.writeFileSync(path.join(folder,'live-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
