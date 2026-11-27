'use strict';
// Read-only destination/graph audit. Writes only new execution evidence.
// No database updates, source removal, service control, AWS operation or retry.
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path');
const crypto = require('node:crypto'), os = require('node:os'), cp = require('node:child_process');
const assert = require('node:assert/strict');
const API = '/storage/www/komondor-api', R3 = '/storage/komondor-gulnara-20261126-r3';
const MD5 = '/storage/komondor-gulnara-md5-20261126-01', ROOT = '/mnt/reads';
const TARGET = '6ae4ac89a6b876c643741d27';
const RELATIVE = 'ntalbot/xanthoria_parietina_mycobiont_rnaseq';
const SOURCES = {
  '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
  '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
  '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
  '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
};
const PINS = {
  [MD5 + '/post-db-snapshot.json']: '964fd3f322666bb2f2004de64ac620c3cdee9a92f51b316332fed0e8f78c5601',
  [R3 + '/config.json']: 'e3cfd9680d507828c3e5beb0bc00da81a4e552bb4eb29b141303d42c7df9c77b',
  [R3 + '/scope.json']: 'c4a06402be3a548ccc24497aff9d0ec598b854f6979bd4efe64e65a3e73a039e',
  [R3 + '/filesystem-baseline.json']: '015b882e5bee71b1c34897638b60bc0a4be7793d5c30d1cfe205b6cb50e93832',
  [R3 + '/copy-manifest.json']: '0a2efc9c49c37c5da0a402d0a4906355583e50684331a2c02abd451e9768371e',
  [R3 + '/exec/copy.cjs']: 'b88a35e4d16e307a3e6cd690a8008abad5d1e17b00d5a9f722bdf9ad4544e754',
  [R3 + '/exec/link-publication.cjs']: 'ffe110e82df9dc12cd100ebbe4b1435ad89278c52d60ccfc578f051bb4cdfcef',
  [R3 + '/copy-evidence/copy-verified.json']: 'd9d62d7686775b5d859adc5ff86f926d0f139de29e3c5fdbc16b9adf88121c06',
};
const EXPECTED_COUNTS = { projects: 5, samples: 12, runs: 12, reads: 31, additionalfiles: 9, files: 40, ingestjobs: 0 };
const TYPED = { promoteValues: false, promoteLongs: false, promoteBuffers: false };
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const id = value => String(value?._id || value);
const clean = value => value.replace(/^\//, '');
const plain = x => x && Object.getPrototypeOf(x) === Object.prototype;
const ordered = x => Array.isArray(x) ? x.map(ordered) : plain(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered(x[k])])) : x;
const meta = s => Object.fromEntries(['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs'].map(k => [k, s[k]]));
const sameMeta = (a,b) => assert.deepEqual(a,b,'File metadata changed during fresh verification');
let client, output, startedAt;
const verified = [];
function safe(filename, directory = false) {
  assert(path.isAbsolute(filename) && path.normalize(filename) === filename);
  let here = path.parse(filename).root, stat;
  for (const part of filename.slice(here.length).split('/').filter(Boolean)) {
    here = path.join(here, part); stat = fs.lstatSync(here);
    assert(!stat.isSymbolicLink(), 'Symlink in path: ' + here);
    if (here !== filename || directory) assert(stat.isDirectory(), 'Not a directory: ' + here);
  }
  return stat;
}
function read(filename) {
  assert(safe(filename).isFile()); const fd = fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd); } finally { fs.closeSync(fd); }
}
function save(name, value) {
  assert.equal(path.basename(name),name);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value,null,2)+'\n');
  const fd=fs.openSync(path.join(output,name),'wx',0o600);
  try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(path.join(output,name),0o400);return sha(bytes);
}
function mount() {
  const m=JSON.parse(cp.execFileSync('findmnt',['-J','-T',ROOT,'-o','TARGET,SOURCE,FSTYPE'])).filesystems[0];
  assert.equal(m.target,ROOT); assert.equal(m.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');
  assert(m.fstype.startsWith('nfs'));safe(ROOT,true);return m;
}
async function hashFile(filename) {
  const before=meta(safe(filename));assert(safe(filename).isFile());
  const handle=await fsp.open(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    sameMeta(meta(await handle.stat()),before);
    const sh=crypto.createHash('sha256'),md=crypto.createHash('md5');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false,start:0,highWaterMark:4*1024*1024})) {
      sh.update(chunk);md.update(chunk);bytes+=chunk.length;
    }
    sameMeta(meta(await handle.stat()),before);sameMeta(meta(safe(filename)),before);
    return {bytes,sha256:sh.digest('hex'),md5:md.digest('hex'),metadata:before};
  } finally { await handle.close(); }
}
async function main() {
  assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'deeks');
  assert.equal(process.argv.length,5);assert.equal(process.argv[2],'--audit');assert.equal(process.argv[3],'--output-dir');
  output=process.argv[4];assert(path.isAbsolute(output)&&path.normalize(output)===output&&output.startsWith('/storage/'));
  assert.equal(path.basename(output),'destination-evidence');safe(path.dirname(output),true);
  process.umask(0o077);fs.mkdirSync(output,{mode:0o700});startedAt=new Date().toISOString();
  console.log(JSON.stringify({event:'started',at:startedAt,output,files:40,bytes:41432635417}));
  save('checker.cjs',read(__filename));
  const contents={};
  for(const [filename,digest] of Object.entries(PINS)) {
    const bytes=read(filename);assert.equal(sha(bytes),digest,'Pinned input changed: '+filename);contents[filename]=bytes;
  }
  const j=filename=>JSON.parse(contents[filename]);
  const snapshot=j(MD5+'/post-db-snapshot.json'),config=j(R3+'/config.json'),scope=j(R3+'/scope.json');
  const manifest=j(R3+'/copy-manifest.json'),filesystemEvidence=j(R3+'/filesystem-baseline.json');
  assert.equal(manifest.count,40);assert.equal(manifest.entries.length,40);assert.equal(manifest.bytes,41432635417);
  assert.equal(config.stageRoot,ROOT+'/ntalbot/.gulnara-staging-20261126-c1f78c6d-3a3f-4165-abe5-706ded74bf99');
  const {MongoClient,ObjectId}=require(API+'/node_modules/mongodb'),BSON=require(API+'/node_modules/bson'),bson=new BSON();
  const unpack=s=>bson.deserialize(Buffer.from(s,'base64'),TYPED);
  const baseline=Object.fromEntries(Object.entries(snapshot.collections).map(([c,rows])=>[c,rows.map(r=>{const d=unpack(r.bson);assert.equal(id(d),r.id);return d;})]));
  const counts=rows=>Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length]));assert.deepEqual(counts(baseline),EXPECTED_COUNTS);
  const map=rows=>new Map(rows.map(d=>[id(d),d]));
  const samples=map(baseline.samples),runs=map(baseline.runs),files=map(baseline.files),readsByFile=new Map(baseline.reads.map(r=>[id(r.file),r]));
  assert.equal(readsByFile.size,31);
  assert.deepEqual(baseline.projects.map(id).sort(),[...Object.keys(SOURCES),TARGET].sort());
  const project=baseline.projects.find(p=>id(p)===TARGET);assert.equal(project.path,'/'+RELATIVE);assert.equal(project.storage.state,'hpc');
  for(const p of baseline.projects.filter(p=>id(p)!==TARGET)) {
    assert.equal(p.path,'/'+SOURCES[id(p)]);assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');
    assert.equal(p.archiveMigration.sourceRelativeRoot,SOURCES[id(p)]);
  }
  for(const s of samples.values()) {assert.equal(id(s.project),TARGET);assert(clean(s.path).startsWith(RELATIVE+'/'));}
  for(const r of runs.values()) {assert(samples.has(id(r.sample)));assert(clean(r.path).startsWith(clean(samples.get(id(r.sample)).path)+'/'));assert.equal(r.status,'complete');assert.equal(r.md5VerificationStatus,'complete');}
  const sampleIds=[...samples.keys()],runIds=[...runs.keys()],fileIds=[...files.keys()],O=ids=>ids.map(x=>new ObjectId(x));
  const regex=new RegExp('^/?'+RELATIVE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)');
  const queries={
    projects:{_id:{$in:O([...Object.keys(SOURCES),TARGET])}},
    samples:{$or:[{_id:{$in:O(sampleIds)}},{project:new ObjectId(TARGET)}]},
    runs:{$or:[{_id:{$in:O(runIds)}},{sample:{$in:O(sampleIds)}}]},
    reads:{$or:[{run:{$in:O(runIds)}},{file:{$in:O(fileIds)}}]},
    additionalfiles:{$or:[{sample:{$in:O(sampleIds)}},{run:{$in:O(runIds)}},{project:new ObjectId(TARGET)},{file:{$in:O(fileIds)}}]},
    files:{$or:[{_id:{$in:O(fileIds)}},{path:regex}]},
    ingestjobs:{$or:[{runId:{$in:O(runIds)}},{run:{$in:O(runIds)}},{sample:{$in:O(sampleIds)}},{project:new ObjectId(TARGET)}]},
  };
  client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});
  const db=client.db('komondor');
  async function capture() {
    const result={};for(const[c,q]of Object.entries(queries))result[c]=await db.collection(c).find(q,TYPED).sort({_id:1}).maxTimeMS(30000).toArray();return result;
  }
  function checkGraph(current) {
    assert.deepEqual(counts(current),EXPECTED_COUNTS);
    for(const[c,rows]of Object.entries(baseline)) {
      const observed=map(current[c]);for(const before of rows) {
        const actual=observed.get(id(before));assert(actual,'Missing '+c+'/'+id(before));
        assert(bson.serialize(ordered(before)).equals(bson.serialize(ordered(actual))),'Post-MD5 record changed: '+c+'/'+id(before));
      }
    }
  }
  const serialize=collections=>Object.fromEntries(Object.entries(collections).map(([c,rows])=>[c,rows.map(d=>({id:id(d),bson:bson.serialize(d).toString('base64')}))]));
  const mountBefore=mount(),before=await capture();checkGraph(before);
  const beforeSha256=save('destination-db-before.json',{at:new Date().toISOString(),collections:serialize(before)});
  const publication=require(R3+'/exec/link-publication.cjs');
  const copyOptions={copyManifest:manifest,filesystemEvidence,scope,stageRoot:config.stageRoot,evidenceDir:R3+'/copy-evidence',publicationEvidenceDir:R3+'/publication-evidence',operationId:config.operationId,planSha256:config.planSha256};
  // Complete publication receipts must exist. This verifier only reads metadata;
  // a missing receipt safely fails instead of using a recovery/adoption path.
  for(const e of manifest.entries) {
    const digest=sha(Buffer.from(JSON.stringify(e.fileId)));
    assert(safe(R3+'/publication-evidence/file-linked-'+digest+'.json').isFile());
  }
  const physicalBefore=await publication.verifyPublished(copyOptions);assert.equal(physicalBefore.allVerified,true);
  save('publication-before.json',physicalBefore);
  let fastqs=0,md5Verified=0;
  for(const e of manifest.entries) {
    const f=files.get(e.fileId);assert(f,'Missing moved File');assert.equal(clean(f.path),clean(e.destination.slice(ROOT.length)));
    assert.equal(e.source,ROOT+'/'+SOURCES[e.projectId]+'/'+path.relative(ROOT+'/'+SOURCES[e.projectId],e.source));
    assert(e.source.startsWith(ROOT+'/'+SOURCES[e.projectId]+'/'));assert(e.destination.startsWith(ROOT+'/'+RELATIVE+'/'));
    const stage=path.join(config.stageRoot,path.relative(ROOT+'/'+RELATIVE,e.destination));
    const sourceMetadata=meta(safe(e.source)),stageMetadata=meta(safe(stage)),destinationMetadata=meta(safe(e.destination));
    assert(safe(e.source).isFile()&&safe(stage).isFile()&&safe(e.destination).isFile());
    assert.equal(stageMetadata.dev,destinationMetadata.dev);assert.equal(stageMetadata.ino,destinationMetadata.ino);
    assert.equal(stageMetadata.nlink,2);assert.equal(destinationMetadata.nlink,2);
    assert(!(sourceMetadata.dev===destinationMetadata.dev&&sourceMetadata.ino===destinationMetadata.ino),'Source shares destination inode');
    const digest=await hashFile(e.destination);assert.equal(digest.bytes,e.bytes);assert.equal(digest.sha256,e.sha256,'Destination SHA-256 mismatch');
    sameMeta(meta(safe(e.source)),sourceMetadata);sameMeta(meta(safe(stage)),stageMetadata);sameMeta(meta(safe(e.destination)),destinationMetadata);
    const readRecord=readsByFile.get(e.fileId);
    if(readRecord) {assert.equal(digest.md5,readRecord.MD5);assert.equal(digest.md5,readRecord.destinationMd5);assert.equal(readRecord.md5Mismatch,false);md5Verified++;}
    if(/\.(fastq|fq)(\.gz)?$/i.test(e.destination)) {assert(readRecord,'FASTQ lacks Read record');fastqs++;}
    const result={fileId:e.fileId,projectId:e.projectId,source:e.source,destination:e.destination,stage,bytes:digest.bytes,sha256:digest.sha256,md5:digest.md5,md5ComparedToRead:!!readRecord,sourceMetadata,destinationMetadata,stageMetadata};
    save('file-'+e.fileId+'.json',result);verified.push(result);
    console.log(JSON.stringify({at:new Date().toISOString(),event:'file-verified',done:verified.length,total:40,bytesVerified:verified.reduce((n,r)=>n+r.bytes,0)}));
  }
  assert.equal(fastqs,24);assert.equal(md5Verified,31);assert.equal(verified.length,40);assert.equal(verified.reduce((n,r)=>n+r.bytes,0),41432635417);
  const physicalAfter=await publication.verifyPublished(copyOptions);assert.equal(physicalAfter.allVerified,true);save('publication-after.json',physicalAfter);
  for(const r of verified) {sameMeta(meta(safe(r.source)),r.sourceMetadata);sameMeta(meta(safe(r.destination)),r.destinationMetadata);sameMeta(meta(safe(r.stage)),r.stageMetadata);}
  const after=await capture();checkGraph(after);const afterSha256=save('destination-db-after.json',{at:new Date().toISOString(),collections:serialize(after)});
  const result={kind:'gulnara-source-deletion-destination-check-v1',success:true,startedAt,at:new Date().toISOString(),issues:[],
    sourceProjects:Object.entries(SOURCES).map(([projectId,relativeRoot])=>({projectId,relativeRoot})),
    destination:{projectId:TARGET,relativeRoot:RELATIVE,vmPath:ROOT+'/'+RELATIVE,hpcPath:'/tsl/data/reads/'+RELATIVE},
    stage:{vmPath:config.stageRoot,hpcPath:config.stageRoot.replace(ROOT,'/tsl/data/reads')},
    files:40,bytes:41432635417,sha256Verified:40,md5Verified,fastqsVerified:fastqs,
    graph:{counts:EXPECTED_COUNTS,unchangedSincePostMd5:true,baselineSha256:PINS[MD5+'/post-db-snapshot.json'],beforeSha256,afterSha256},
    entries:verified,controlsUnchanged:true,originalsDistinctFromCopies:true,stagingIntact:true,
    mountBefore,mountAfter:mount(),pinnedInputs:PINS,databaseWrites:0,payloadWrites:0,scope:'Destination integrity and scoped post-MD5 graph only; fresh source/archive review is separate'};
  save('destination-check.json',result);console.log(JSON.stringify({success:true,at:result.at,files:40,bytes:result.bytes,output:path.join(output,'destination-check.json')}));
}
main().catch(error=>{if(output&&fs.existsSync(output)){try{save('failure.json',{at:new Date().toISOString(),error:error.stack,verifiedFiles:verified.map(r=>r.fileId),retryRequiresInspection:true});}catch(_){}}console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(client)await client.close();});
