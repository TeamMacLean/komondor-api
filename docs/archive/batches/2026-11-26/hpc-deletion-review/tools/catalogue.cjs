'use strict';
// Independent catalogue ownership/active-ingest check. Reads only.
const fs=require('fs'),assert=require('assert/strict');
const {connect,api}=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const {resolveHpcPreservation}=require(api+'/lib/hpc-preservation');
const {projectStorageLocations}=require(api+'/lib/project-storage-locations');
const pre=JSON.parse(fs.readFileSync(__dirname+'/preflight.json'));
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--final'));
const output=process.argv[2]==='--final'?'catalogue-final.json':'catalogue.json';
const normalize=p=>String(p||'').replace(/^\/+|\/+$/g,'');
let c;
(async()=>{
 c=await connect();const db=c.mongoose.connection.db;
 const [projects,samples,runs,files,reads,additional,jobs]=await Promise.all([
 db.collection('projects').find({},{projection:{name:1,path:1,storage:1,archiveMigration:1,preserveOnHpcUntil:1}}).toArray(),
 db.collection('samples').find({},{projection:{project:1}}).toArray(),
 db.collection('runs').find({},{projection:{sample:1,status:1,md5VerificationStatus:1}}).toArray(),
 db.collection('files').find({},{projection:{path:1}}).toArray(),
 db.collection('reads').find({},{projection:{run:1,file:1}}).toArray(),
 db.collection('additionalfiles').find({},{projection:{project:1,sample:1,run:1,file:1}}).toArray(),
 db.collection('ingestjobs').find({status:{$in:['pending','claimed']}},{projection:{runId:1,status:1}}).toArray()
 ]);
 const sm=new Map(samples.map(s=>[String(s._id),String(s.project)])),rm=new Map(runs.map(r=>[String(r._id),sm.get(String(r.sample))]));
 const candidates=pre.projects.filter(p=>!p.excluded),ids=new Set(candidates.map(p=>p.projectId));
 const fileOwners=new Map(),issues=[];
 for(const f of files){const p=normalize(f.path),owner=candidates.find(c=>p.startsWith(normalize(c.hpcPath.slice('/mnt/reads'.length))+'/'));if(owner)fileOwners.set(String(f._id),owner.projectId);}
 let referenceCount=0;
 for(const [kind,records]of [['read',reads],['additionalFile',additional]])for(const r of records){
  const physical=fileOwners.get(String(r.file));if(!physical)continue;referenceCount++;
  const owner=kind==='read'?rm.get(String(r.run)):r.run?rm.get(String(r.run)):r.sample?sm.get(String(r.sample)):String(r.project);
  if(owner!==physical)issues.push({kind,recordId:String(r._id),fileId:String(r.file),physicalProject:physical,relatedProject:owner||null});
 }
 for(const r of runs)if(ids.has(rm.get(String(r._id)))&&(['pending','processing'].includes(r.status)||r.md5VerificationStatus==='in_progress'))issues.push({kind:'active-run',runId:String(r._id),projectId:rm.get(String(r._id)),status:r.status,md5VerificationStatus:r.md5VerificationStatus});
 for(const j of jobs)if(ids.has(rm.get(String(j.runId))))issues.push({kind:'active-ingest',jobId:String(j._id),projectId:rm.get(String(j.runId))});
 const locations=[];
 for(const r of pre.projects){const p=projects.find(p=>String(p._id)===r.projectId);assert(p);const hold=resolveHpcPreservation(p);if(hold.invalid||(!r.excluded&&hold.active))issues.push({kind:'hold-changed',projectId:r.projectId,hold});locations.push({projectId:r.projectId,name:p.name,preservation:hold,locations:await projectStorageLocations(p,{datastoreRoot:'/mnt/reads'})});}
 const report={at:new Date().toISOString(),projects:pre.projects.length,candidateFilesInCatalogue:fileOwners.size,checkedReferences:referenceCount,issues,locations};
 fs.writeFileSync(__dirname+'/'+output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({at:report.at,files:fileOwners.size,references:referenceCount,issues}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(c)await c.mongoose.disconnect();});
