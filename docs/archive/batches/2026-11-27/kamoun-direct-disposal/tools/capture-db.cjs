'use strict';
// Read-only raw Mongo capture: no model middleware, payload reads or database writes.
const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const API='/storage/www/komondor-api';
const TYPED={promoteValues:false,promoteLongs:false,promoteBuffers:false};
const id=x=>String(x?._id||x||'');
const clean=x=>String(x||'').replace(/^\//,'');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const escaped=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function capture(db,targets,ObjectId){
  const O=a=>a.map(x=>new ObjectId(id(x))), q=async(c,f)=>db.collection(c).find(f,TYPED).sort({_id:1}).maxTimeMS(60000).toArray();
  const P=O(targets.map(t=>t.projectId)),R=targets.map(t=>new RegExp('^/?'+escaped(t.relativeRoot)+'(?:/|$)'));
  const projects=await q('projects',{_id:{$in:P}});
  const samples=await q('samples',{$or:[{project:{$in:P}},{path:{$in:R}}]});
  const S=O(samples);
  const runs=await q('runs',{$or:[{sample:{$in:S}},{path:{$in:R}}]});
  const U=O(runs);
  const reads=await q('reads',{run:{$in:U}});
  const additionalfiles=await q('additionalfiles',{$or:[{project:{$in:P}},{sample:{$in:S}},{run:{$in:U}}]});
  const F=O([...new Set([...reads,...additionalfiles].map(x=>id(x.file)).filter(Boolean))]);
  const files=await q('files',{$or:[{_id:{$in:F}},{path:{$in:R}}]});
  const allF=O(files), allReads=O(reads), allIds=[...P,...S,...U];
  const ingestjobs=await q('ingestjobs',{$or:[{runId:{$in:U}},{run:{$in:U}},{sample:{$in:S}},{project:{$in:P}}]});
  const newsitems=await q('newsitems',{typeId:{$in:[...allIds,...allIds.map(id)]}});
  const external={
    reads:await q('reads',{_id:{$nin:allReads},$or:[{file:{$in:allF}},{sibling:{$in:allReads}}]}),
    additionalfiles:await q('additionalfiles',{_id:{$nin:O(additionalfiles)},file:{$in:allF}}),
    projects:await q('projects',{_id:{$nin:P},path:{$in:R}}),
  };
  return {collections:{projects,samples,runs,reads,additionalfiles,files,ingestjobs,newsitems},external};
}
function review(graph,targets){
  const g=graph.collections,issues=[],sets=Object.fromEntries(Object.entries(g).map(([k,v])=>[k,new Set(v.map(id))]));
  const fail=(ok,why)=>{if(!ok)issues.push(why);};
  fail(g.projects.length===6,'Expected six Projects');
  const roots=targets.map(t=>t.relativeRoot),inside=p=>roots.some(r=>clean(p)===r||clean(p).startsWith(r+'/'));
  for(const t of targets){const p=g.projects.find(x=>id(x)===t.projectId);if(!p){issues.push('Missing '+t.projectId);continue;}
    fail(clean(p.path)===t.relativeRoot,'Project path differs '+id(p));
    fail(!p.reconciliation?.retiredAt,'Project already retired '+id(p));
    fail(!p.preserveOnHpcUntil,'Project has preservation date '+id(p));
    fail(!p.archiveMigration?.migrationId&&!p.storage?.s3VerifiedAt&&!p.storage?.s3Uri&&(!p.storage?.state||p.storage.state==='hpc'),'Unexpected archive state '+id(p));
  }
  for(const s of g.samples){fail(sets.projects.has(id(s.project)),'Outside Sample parent '+id(s));fail(inside(s.path),'Outside Sample path '+id(s));}
  for(const r of g.runs){fail(sets.samples.has(id(r.sample)),'Outside Run parent '+id(r));fail(inside(r.path),'Outside Run path '+id(r));fail(!['pending','processing','moving','queued','running','verifying'].includes(r.status),'Active Run '+id(r)+':'+r.status);fail(!['pending','processing','running','queued','verifying'].includes(r.md5VerificationStatus),'Active MD5 '+id(r)+':'+r.md5VerificationStatus);}
  for(const r of g.reads){fail(sets.runs.has(id(r.run)),'Outside Read parent '+id(r));fail(sets.files.has(id(r.file)),'Missing Read File '+id(r));if(r.sibling)fail(sets.reads.has(id(r.sibling)),'Outside sibling '+id(r));}
  for(const a of g.additionalfiles){let parents=0;for(const[k,s]of [['project','projects'],['sample','samples'],['run','runs']])if(a[k]){parents++;fail(sets[s].has(id(a[k])),'Outside AdditionalFile '+k+' '+id(a));}fail(parents>0,'Orphan AdditionalFile '+id(a));fail(sets.files.has(id(a.file)),'Missing AdditionalFile File '+id(a));}
  for(const f of g.files)fail(inside(f.path),'Outside File path '+id(f));
  for(const j of g.ingestjobs)fail(['done','failed'].includes(j.status),'Unfinished ingest '+id(j)+':'+j.status);
  for(const[k,v]of Object.entries(graph.external))fail(v.length===0,'External '+k+' references: '+v.length);
  const fileIds=[...g.reads,...g.additionalfiles].map(x=>id(x.file));
  for(const f of g.files)fail(fileIds.includes(id(f)),'Unreferenced File '+id(f));
  return issues;
}
async function main(){
 const spec=JSON.parse(fs.readFileSync(process.argv[2]));
 const head=cp.execFileSync('git',['-C',API,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(head,spec.apiHead);
 assert.equal(cp.execFileSync('git',['-C',API,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
 const {MongoClient,ObjectId}=require(API+'/node_modules/mongodb'),BSON=require(API+'/node_modules/bson'),bson=new BSON();let client;
 try{client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});const db=client.db('komondor');
 const graph=await capture(db,spec.targets,ObjectId),issues=review(graph,spec.targets);
 const held=await db.collection('projects').find({_id:{$in:spec.protected.map(p=>new ObjectId(p.projectId))}},TYPED).sort({_id:1}).toArray();
 const preservation=spec.protected.map(t=>{const p=held.find(p=>id(p)===t.projectId);assert(p,'Missing protected Project');const v={projectId:t.projectId,name:p.name,path:p.path,preserveOnHpcUntil:p.preserveOnHpcUntil||null,requestedBy:p.hpcPreservationRequestedBy||null,reason:p.hpcPreservationReason||null,historyEntries:p.hpcPreservationHistory?.length||0,retired:!!p.reconciliation?.retiredAt};v.ok=clean(p.path)===t.relativeRoot&&!v.retired&&(!t.date||(p.preserveOnHpcUntil instanceof Date&&p.preserveOnHpcUntil.toISOString()===t.date&&p.hpcPreservationRequestedBy===t.requestedBy));if(!v.ok)issues.push('Protected Project differs '+t.projectId);return v;});
 const encode=g=>Object.fromEntries(Object.entries(g).map(([k,rows])=>[k,rows.map(d=>{const raw=bson.serialize(d);return{id:id(d),bson:raw.toString('base64'),sha256:sha(raw)};})]));
 const result={at:new Date().toISOString(),apiHead:head,databaseIdentity:'v1333:28015/komondor',targets:spec.targets,counts:Object.fromEntries(Object.entries(graph.collections).map(([k,v])=>[k,v.length])),issues,preservation,collections:encode(graph.collections),protectedCollections:encode({projects:held}),externalCounts:Object.fromEntries(Object.entries(graph.external).map(([k,v])=>[k,v.length])),runStates:graph.collections.runs.map(r=>({id:id(r),status:r.status,md5VerificationStatus:r.md5VerificationStatus})),projectStates:graph.collections.projects.map(p=>({id:id(p),path:p.path,storage:p.storage,archiveMigration:p.archiveMigration,nudgeable:p.nudgeable,doNotSendToEna:p.doNotSendToEna,reconciliation:p.reconciliation}))};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }finally{if(client)await client.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={capture,review,TYPED};
