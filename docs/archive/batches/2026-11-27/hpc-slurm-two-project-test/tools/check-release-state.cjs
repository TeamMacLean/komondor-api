'use strict';
// Read-only release check. Reuses the still-current native archive review;
// checks current identities, holds, roots, catalogue ownership and ingest.
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
const {connect,api,sha}=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const {resolveHpcPreservation}=require(api+'/lib/hpc-preservation');
const planBytes=fs.readFileSync('/storage/komondor-hpc-delete-split-20261127-01/hpc-slurm-two-project-test/remaining-167/deletion-plan.json');
assert.equal(sha(planBytes),'038bad960ea1a3fca7b9c445a9f3d603500aadee9c6725978dcccdefc474155c');
const plan=JSON.parse(planBytes),root='/mnt/reads';
const finished={
 '5fc012bda3efcb29338b7d4b':'jjones/plant_capture_enhancer',
 '5fc012bda3efcb29338b7d13':'jjones/miseq_renseq_of_brassica_accessions_',
 '5fc012bda3efcb29338b7d4e':'jjones/resistance_to_albugo_laibachii_in_sf_2'
};
const projection={name:1,path:1,storage:1,archiveMigration:1,preserveOnHpcUntil:1};
const normalize=p=>String(p||'').replace(/^\/+|\/+$/g,'');
function directory(p){assert(fs.lstatSync(p).isDirectory());assert.equal(fs.realpathSync(p),p);}
function mount(){const m=JSON.parse(cp.execFileSync('findmnt',['-J','-T',root,'-o','TARGET,SOURCE,FSTYPE'])).filesystems[0];assert.equal(m.target,root);assert.equal(m.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(m.fstype.startsWith('nfs'));directory(root);return m;}
let c;
(async()=>{
 assert.deepEqual(process.argv.slice(2),['--read-only']);
 assert.equal(plan.projects.length,167);assert(new Date()<new Date(plan.expiresAt),'Original native review expired');
 c=await connect();assert.equal(c.toolVersion,plan.apiHead);const initialMount=mount(),db=c.mongoose.connection.db;
 const [all,samples,runs,files,reads,additional,jobs]=await Promise.all([
  db.collection('projects').find({},{projection}).toArray(),
  db.collection('samples').find({},{projection:{project:1}}).toArray(),
  db.collection('runs').find({},{projection:{sample:1,status:1,md5VerificationStatus:1}}).toArray(),
  db.collection('files').find({},{projection:{path:1}}).toArray(),
  db.collection('reads').find({},{projection:{run:1,file:1}}).toArray(),
  db.collection('additionalfiles').find({},{projection:{project:1,sample:1,run:1,file:1}}).toArray(),
  db.collection('ingestjobs').find({status:{$in:['pending','claimed']}},{projection:{runId:1,status:1}}).toArray()
 ]);
 const byId=new Map(all.map(p=>[String(p._id),p]));
 const sm=new Map(samples.map(s=>[String(s._id),String(s.project)]));
 const rm=new Map(runs.map(r=>[String(r._id),sm.get(String(r.sample))]));
 const projects=plan.projects.map(r=>{
  const p=byId.get(r.projectId);assert(p);assert.equal(p.path,'/'+r.relativeRoot);
  assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');
  assert.equal(String(p.archiveMigration.id),r.migrationId);assert.equal(p.archiveMigration.sourceRoot,root+'/'+r.relativeRoot);
  assert.equal(p.archiveMigration.sourceRelativeRoot,r.relativeRoot);assert.equal(p.storage.s3Uri,r.s3Uri);
  assert.equal(p.storage.s3VerifiedAt.toISOString(),r.s3VerifiedAt);
  for(const k of ['sourceSha256','verificationSha256'])assert.equal(p.archiveMigration.manifests[k],r[k]);
  assert.equal(p.archiveMigration.manifests.fileCount,r.fileCount);assert.equal(p.archiveMigration.manifests.totalBytes,r.bytes);
  const preservation=resolveHpcPreservation(p);assert(!preservation.active&&!preservation.invalid);
  directory(root+'/'+r.relativeRoot.split('/')[0]);directory(root+'/'+r.relativeRoot);
  const unfinishedJobs=jobs.filter(j=>rm.get(String(j.runId))===r.projectId).length;
  const activeRuns=runs.filter(run=>rm.get(String(run._id))===r.projectId&&(['pending','processing'].includes(run.status)||run.md5VerificationStatus==='in_progress')).length;
  assert.equal(unfinishedJobs,0);assert.equal(activeRuns,0);
  for(const other of all){if(String(other._id)===r.projectId||!other.path)continue;const rel=normalize(other.path);assert(!(r.relativeRoot===rel||r.relativeRoot.startsWith(rel+'/')||rel.startsWith(r.relativeRoot+'/')),'Overlapping Project root');}
  return {...Object.fromEntries(['projectId','relativeRoot','migrationId','sourceSha256','verificationSha256','s3Uri','s3VerifiedAt','fileCount','bytes'].map(k=>[k,r[k]])),state:p.storage.state,phase:p.archiveMigration.phase,preservation,unfinishedJobs,activeRuns,sourcePresent:true};
 });
 const held=plan.held.map(r=>{const p=byId.get(r.projectId);assert(p);assert.equal(p.path,'/'+r.relativeRoot);assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');directory(root+'/'+r.relativeRoot);const preservation=resolveHpcPreservation(p);assert(!preservation.invalid);if(r.projectId==='5fc012bda3efcb29338b7d58')assert(preservation.active);return {projectId:r.projectId,relativeRoot:r.relativeRoot,present:true,preservation};});
 const completed=Object.entries(finished).map(([projectId,relativeRoot])=>{const p=byId.get(projectId);assert(p);assert.equal(p.path,'/'+relativeRoot);assert.equal(p.storage.state,'aws');assert.equal(p.archiveMigration.phase,'completed');assert(p.storage.hpcVerifiedAbsentAt instanceof Date);assert.equal(p.archiveMigration.confirmedAbsentBy,'deeks');directory(root+'/'+relativeRoot.split('/')[0]);assert.throws(()=>fs.lstatSync(root+'/'+relativeRoot),{code:'ENOENT'});return {projectId,relativeRoot,state:p.storage.state,phase:p.archiveMigration.phase,hpcAbsent:true,confirmedAbsentAt:p.storage.hpcVerifiedAbsentAt};});
 const owners=new Map();
 for(const file of files){const rel=normalize(file.path),owner=plan.projects.find(p=>rel.startsWith(p.relativeRoot+'/'));if(owner)owners.set(String(file._id),owner.projectId);}
 let references=0;
 for(const [kind,records] of [['read',reads],['additional',additional]])for(const r of records){const physical=owners.get(String(r.file));if(!physical)continue;const owner=kind==='read'?rm.get(String(r.run)):r.run?rm.get(String(r.run)):r.sample?sm.get(String(r.sample)):String(r.project);assert.equal(owner,physical,'Catalogue ownership changed');references++;}
 assert.equal(owners.size,plan.projects.reduce((n,p)=>n+p.fileCount,0));assert.equal(references,owners.size);
 // Reject concurrent changes to any of the 175 scoped Project identities/holds.
 for(const id of [...projects,...held,...completed].map(p=>p.projectId)){const p=await db.collection('projects').findOne({_id:byId.get(id)._id},{projection});assert.deepEqual(p,byId.get(id));}
 assert.deepEqual(mount(),initialMount);assert(new Date()<new Date(plan.expiresAt));
 console.log(JSON.stringify({at:new Date().toISOString(),readOnly:true,apiHead:c.toolVersion,mount:initialMount,originalReviewCompletedAt:plan.reviewCompletedAt,originalExpiresAt:plan.expiresAt,projects,held,completed,catalogue:{files:owners.size,references,issues:[]},issues:[]},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{if(c)await c.mongoose.disconnect()});
