'use strict';
// Read-only review of exactly four old Gulnara source archives. Never executes rm.
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert/strict');
const { connect, createAws, api, sha } = require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli = require(api + '/lib/s3-archive/cli');
const { collectProjectDatabase, collectHardBlockers } = require(api + '/lib/s3-archive/preflight');
const { resolveHpcPreservation } = require(api + '/lib/hpc-preservation');
const ROOT = '/mnt/reads', HEAD = '12e7f1da1537b693f60c86d692f0c3236edcf299';
const IDS = ['61204424e788b405b6ce6bde','611ff26de788b405b6ce6a4c','5fd1ed55d8dd4a63058cc1c9','5fdb2d62d7661b6ec22a0571'];
const DEST = '6ae4ac89a6b876c643741d27', GARGY = '5fc012bda3efcb29338b7d58';
const STAGE = ROOT + '/ntalbot/.gulnara-staging-20261126-c1f78c6d-3a3f-4165-abe5-706ded74bf99';
const DESTROOT = ROOT + '/ntalbot/xanthoria_parietina_mycobiont_rnaseq';
const PACK = __dirname, plain = x => JSON.parse(JSON.stringify(x));
const read = n => JSON.parse(fs.readFileSync(path.join(PACK,n)));
function save(n,x) { const fd=fs.openSync(path.join(PACK,n),'wx',0o600); try {fs.writeFileSync(fd,Buffer.isBuffer(x)?x:JSON.stringify(x,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);} }
const register=read('register.json'), release=read('hold-release.json');
assert.equal(sha(fs.readFileSync(PACK+'/register.json')),'557a299be606cce3bef82f8db7963e7a4c7a88485a1229633a7293b98c576c8c');
assert.equal(sha(fs.readFileSync(PACK+'/hold-release.json')),'76e1ae65dd6126942c6383034b9a7d88d85dbb6c2ae1b5048a4060cdefb305f0');
assert.deepEqual(register.projects.map(p=>p.projectId).sort(),IDS.slice().sort());
assert.deepEqual(release.sourceProjectIds.slice().sort(),IDS.slice().sort());
assert.equal(release.waitingForReplyWaivedByGeorge,true);
let c; const baseline=new Map(), results=[];
function directory(p) {assert(fs.lstatSync(p).isDirectory(),p);assert.equal(fs.realpathSync(p),p);}
function mount() {
 const m=JSON.parse(cp.execFileSync('findmnt',['-J','-T',ROOT,'-o','TARGET,SOURCE,FSTYPE'])).filesystems[0];
 assert.equal(m.target,ROOT);assert.equal(m.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(m.fstype.startsWith('nfs'));
 for(const p of [ROOT,ROOT+'/ntalbot',ROOT+'/two_blades',DESTROOT,STAGE,ROOT+'/two_blades/gargy_2019_rnaseq'])directory(p);
 return m;
}
function identity(r,p) {
 assert(p);assert.equal(String(p._id),r.projectId);assert.equal(p.path,r.hpcPath.slice(ROOT.length));
 assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');
 assert.equal(String(p.archiveMigration.id),r.migrationId);assert.equal(p.archiveMigration.sourceRoot,r.hpcPath);
 assert.equal(p.archiveMigration.sourceRelativeRoot,r.hpcPath.slice(ROOT.length+1));
 assert.equal(p.storage.s3Uri,r.s3Uri);assert.equal(p.storage.s3VerifiedAt.toISOString(),r.s3VerifiedAt);
 for(const k of ['sourceSha256','verificationSha256','sourceS3Uri','verificationS3Uri'])assert.equal(p.archiveMigration.manifests[k],r[k]);
 assert.equal(p.archiveMigration.manifests.fileCount,r.fileCount);assert.equal(p.archiveMigration.manifests.totalBytes,r.bytes);
 const hold=resolveHpcPreservation(p);assert.equal(hold.invalid,false);assert.equal(hold.active,false);directory(r.hpcPath);return hold;
}
async function snapshot(id) {return {project:await c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId(id)}),database:await collectProjectDatabase(c.models,id)};}
function awsFor(r) {
 const aws=createAws(c.config),run=aws.run.bind(aws),get=aws.getObjectBuffer.bind(aws),head=aws.headObject.bind(aws);
 const allowed=new Set(['sts get-caller-identity','s3api head-bucket','s3api get-bucket-versioning','s3api get-bucket-lifecycle-configuration','s3api head-object','s3api list-objects-v2','s3api list-multipart-uploads']);
 aws.run=(args,opts)=>{assert(allowed.has(args.slice(0,2).join(' '))||args[0]==='--version'||args.at(-1)==='help','Unexpected AWS operation');return run(args,opts);};
 aws.getObjectBuffer=async key=>{assert([r.sourceS3Uri,r.verificationS3Uri].some(uri=>uri.endsWith('/'+key)));const b=await get(key);save(r.projectId+'/'+path.basename(key),b);return b;};
 aws.headObject=async key=>{const h=await head(key);fs.appendFileSync(PACK+'/'+r.projectId+'/heads.jsonl',JSON.stringify({at:new Date().toISOString(),key,head:h})+'\n',{mode:0o600});return h;};
 return aws;
}
async function catalogue() {
 const db=c.mongoose.connection.db;
 const [samples,runs,files,reads,additional,jobs]=await Promise.all([
 db.collection('samples').find({},{projection:{project:1,path:1}}).toArray(),
 db.collection('runs').find({},{projection:{sample:1,path:1,status:1,md5VerificationStatus:1}}).toArray(),
 db.collection('files').find({},{projection:{path:1}}).toArray(),
 db.collection('reads').find({},{projection:{run:1,file:1}}).toArray(),
 db.collection('additionalfiles').find({},{projection:{project:1,sample:1,run:1,file:1}}).toArray(),
 db.collection('ingestjobs').find({status:{$in:['pending','claimed']}},{projection:{runId:1,status:1}}).toArray()]);
 const copyBytes=fs.readFileSync('/storage/komondor-gulnara-20261126-r3/copy-manifest.json');
 assert.equal(sha(copyBytes),'0a2efc9c49c37c5da0a402d0a4906355583e50684331a2c02abd451e9768371e');
 const copies=JSON.parse(copyBytes).entries;assert.equal(copies.length,40);
 const sm=new Map(samples.map(s=>[String(s._id),String(s.project)])),rm=new Map(runs.map(r=>[String(r._id),sm.get(String(r.sample))]));
 const fileMap=new Map(files.map(f=>[String(f._id),f])),references=new Map();
 const expectedPaths=new Map(),issues=[];const norm=p=>String(p||'').replace(/^\/+|\/+$/g,'');
 for(const r of register.projects) {
  const m=read(r.projectId+'/source-manifest.v1.json');
  for(const e of m.entries.filter(e=>e.type==='file'&&e.disposition==='copy')) {
   const original=r.hpcPath+'/'+e.relPath;
   const moved=copies.find(x=>x.source===original);
   if(moved){const f=fileMap.get(moved.fileId);assert(f);assert.equal(norm(f.path),norm(moved.destination.slice(ROOT.length)));}
   else expectedPaths.set(norm(original.slice(ROOT.length)),r.projectId);
  }
 }
 const actual=new Map();
 for(const f of files) {const p=norm(f.path);if(register.projects.some(r=>p.startsWith(norm(r.hpcPath.slice(ROOT.length))+'/'))){assert(expectedPaths.has(p),'Unexpected old-source catalogue file '+p);assert(!actual.has(p),'Duplicate catalogue path '+p);actual.set(p,String(f._id));references.set(String(f._id),[]);}}
 assert.equal(expectedPaths.size,412);assert.equal(actual.size,expectedPaths.size,'Old-source catalogue coverage differs');
 for(const [p,pid] of expectedPaths)assert(actual.has(p),'Missing old-source File '+p);
 for(const [kind,items] of [['read',reads],['additionalFile',additional]])for(const x of items) {
  if(!references.has(String(x.file)))continue;
  const owner=kind==='read'?rm.get(String(x.run)):x.run?rm.get(String(x.run)):x.sample?sm.get(String(x.sample)):String(x.project);
  const expected=expectedPaths.get(norm(fileMap.get(String(x.file)).path));
  assert.equal(owner,expected,'Cross-project reference to old source');references.get(String(x.file)).push({kind,id:String(x._id),owner});
 }
 for(const refs of references.values())assert.equal(refs.length,1,'Unexpected reference coverage');
 const relevant=new Set([...IDS,DEST]);
 for(const r of runs)if(relevant.has(rm.get(String(r._id))))assert(!['pending','processing'].includes(r.status)&&r.md5VerificationStatus!=='in_progress','Active relevant Run');
 for(const j of jobs)assert(!relevant.has(rm.get(String(j.runId))),'Active relevant ingest');
 return {at:new Date().toISOString(),success:true,issues,sourceProjects:4,sourceManifestFiles:452,candidateFilesInCatalogue:actual.size,checkedReferences:[...references.values()].reduce((n,v)=>n+v.length,0),movedFilesNowInDestination:40,expectedSourcePaths:[...expectedPaths.keys()].sort()};
}
(async()=>{
 assert.deepEqual(process.argv.slice(2),['--audit']);c=await connect();assert.equal(c.toolVersion,HEAD);assert.equal(c.config.datastoreRoot,ROOT);
 const initialMount=mount(),all=await c.models.Project.collection.find({},{projection:{name:1,path:1,storage:1,archiveMigration:1,preserveOnHpcUntil:1}}).toArray();
 for(const r of register.projects) {
  const s=await snapshot(r.projectId);identity(r,s.project);assert.deepEqual(collectHardBlockers(s.database),[]);baseline.set(r.projectId,s);save(r.projectId+'-before.json',s);
  for(const p of all)if(String(p._id)!==r.projectId&&p.path){const a=r.hpcPath.slice(ROOT.length),b=p.path.replace(/\/$/,'');assert(!(a===b||a.startsWith(b+'/')||b.startsWith(a+'/')),'Overlapping Project roots');}
 }
 const protectedBefore=await Promise.all([DEST,GARGY].map(snapshot));
 assert.equal(protectedBefore[0].project.path,'/ntalbot/xanthoria_parietina_mycobiont_rnaseq');
 assert.equal(protectedBefore[0].project.storage?.state||'hpc','hpc');
 assert(resolveHpcPreservation(protectedBefore[1].project).active);save('protected-before.json',protectedBefore);
 save('preflight.json',{at:new Date().toISOString(),apiHead:HEAD,mount:initialMount,projects:register.projects,protectedProjectIds:[DEST,GARGY],stageRoot:STAGE});
 await Promise.all(register.projects.map(async r=>{
  fs.mkdirSync(PACK+'/'+r.projectId,{mode:0o700});let stdout='',stderr='';const startedAt=new Date().toISOString();
  try {
   mount();const aws=awsFor(r);assert.equal((await aws.listMultipartUploads(r.hpcPath.slice(ROOT.length+1))).length,0);
   const exitCode=await cli.runCli(['deletion-command','--project-id',r.projectId],{...c,aws,stdout:s=>stdout+=s,stderr:s=>stderr+=s});
   assert.equal(exitCode,0,stderr);assert.equal(stderr,'');
   assert.equal(stdout.split('\n').filter(s=>s.startsWith('rm -rf -- ')).length,1);
   assert(stdout.split('\n').includes("rm -rf -- '"+r.hpcPath+"'"));
   for(const [n,digest]of [['source-manifest.v1.json',r.sourceSha256],['verification-report.v1.json',r.verificationSha256]])assert.equal(sha(fs.readFileSync(PACK+'/'+r.projectId+'/'+n)),digest);
   const m=read(r.projectId+'/source-manifest.v1.json');assert.equal(m.projectId,r.projectId);assert.equal(m.migrationId,r.migrationId);
   const uncopied=m.entries.filter(e=>e.type!=='dir'&&e.disposition!=='copy');assert.equal(uncopied.length,0);
   const result={projectId:r.projectId,startedAt,finishedAt:new Date().toISOString(),exitCode,stdout,stderr,uncopied,reviewPassed:true};save(r.projectId+'/result.json',result);results.push(result);
   console.log(JSON.stringify({at:result.finishedAt,projectId:r.projectId,reviewPassed:true,done:results.length,total:4}));
  }catch(e){const result={projectId:r.projectId,startedAt,finishedAt:new Date().toISOString(),exitCode:1,stdout,stderr,error:e.stack,reviewPassed:false};save(r.projectId+'/result.json',result);results.push(result);console.error(JSON.stringify(result));}
 }));
 assert.equal(results.filter(x=>x.reviewPassed).length,4,'One or more native archive checks failed');
 const cat=await catalogue();save('catalogue-final.json',cat);
 const final=[];for(const r of register.projects){const s=await snapshot(r.projectId);const hold=identity(r,s.project);assert.deepEqual(plain(s),plain(baseline.get(r.projectId)),'Source Project or associated records changed');final.push({projectId:r.projectId,name:s.project.name,preservation:hold});}
 const protectedAfter=await Promise.all([DEST,GARGY].map(snapshot));assert.deepEqual(plain(protectedAfter),plain(protectedBefore));save('protected-after.json',protectedAfter);
 assert.equal(cp.execFileSync('git',['-C',api,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),HEAD);
 const result={at:new Date().toISOString(),success:true,mount:mount(),apiHead:HEAD,total:4,passed:4,failed:[],finalProjects:final,catalogue:cat,sourceDatabaseUnchanged:true,protectedDatabaseUnchanged:true};save('summary.json',result);console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);save('fatal.json',{at:new Date().toISOString(),error:e.stack});process.exitCode=1;}).finally(async()=>{if(c)await c.mongoose.disconnect();});
