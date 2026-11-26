'use strict';
// Query-only inventory. No model hooks, collection writes, or index creation.
const crypto = require('crypto');
const id = x => x == null ? null : String(x);
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalized = s => typeof s === 'string' ? '/' + s.replace(/^\/+/, '').replace(/\/+$/, '') : null;
const within = (root, value) => normalized(value) === normalized(root) || normalized(value)?.startsWith(normalized(root) + '/');
const pathQuery = roots => ({ $or: roots.map(p => ({ path: new RegExp('^/?' + escape(p.replace(/^\//, '')) + '(?:/|$)') })) });

async function collectDatabase(db, scope, ObjectId) {
  const startedAt = new Date().toISOString(), issues = [], notes = [];
  const ids = xs => xs.map(x => new ObjectId(id(x)));
  const query = (name, filter, projection) => db.collection(name).find(filter, projection ? {projection} : {}).maxTimeMS(30000).toArray();
  const sourceIds = scope.sourceProjects.map(p => p._id), projectIds = [...sourceIds, scope.targetProject._id];
  const sampleIds = scope.matches.map(m => m.sample._id), runIds = scope.matches.flatMap(m => m.runs.map(r => r._id));
  const selectedSamples = new Set(sampleIds), selectedRuns = new Set(runIds);
  const sampleRoots = scope.matches.map(m => m.sample.path);
  const targetRoots = scope.matches.map(m => scope.targetProject.path + '/' + m.sample.safeName);
  const projects = await query('projects', {_id: {$in: ids(projectIds)}});
  const allSamples = await query('samples', {$or: [{project: {$in: ids(projectIds)}}, {_id: {$in: ids(sampleIds)}}, pathQuery([...sampleRoots, scope.targetProject.path])]});
  const allRuns = await query('runs', {$or: [{sample: {$in: allSamples.map(s => s._id)}}, {_id: {$in: ids(runIds)}}, pathQuery([...sampleRoots, scope.targetProject.path])]});
  const samples = allSamples.filter(s => selectedSamples.has(id(s._id))), runs = allRuns.filter(r => selectedRuns.has(id(r._id)));
  const reads = await query('reads', {run: {$in: ids(runIds)}});
  const additionalFiles = await query('additionalfiles', {$or: [{sample: {$in: ids(sampleIds)}}, {run: {$in: ids(runIds)}}, {project: {$in: ids(projectIds)}}]});
  const selectedAdditional = additionalFiles.filter(a => selectedSamples.has(id(a.sample)) || selectedRuns.has(id(a.run)));
  for(const [collection, rows] of [['reads',reads],['additionalfiles',selectedAdditional]]) for(const row of rows) {
    if(!row.file || !/^[a-f0-9]{24}$/.test(id(row.file))) issues.push({kind:'missing-or-invalid-file-reference',collection,id:id(row._id)});
  }
  const linkedFileIds = [...new Set([...reads, ...selectedAdditional].map(r => id(r.file)).filter(x=>/^[a-f0-9]{24}$/.test(x || '')))];
  const files = await query('files', {$or: [{_id: {$in: ids(linkedFileIds)}}, pathQuery([...sampleRoots, scope.targetProject.path])]});
  const movingFiles = files.filter(f=>linkedFileIds.includes(id(f._id)) || sampleRoots.some(p=>within(p,f.path)));
  const inboundReads = movingFiles.length ? await query('reads', {file: {$in: movingFiles.map(f => f._id)}}) : [];
  const inboundAdditional = movingFiles.length ? await query('additionalfiles', {file: {$in: movingFiles.map(f => f._id)}}) : [];
  const siblings = [...new Set(reads.map(r => id(r.sibling)).filter(Boolean))];
  const siblingReads = siblings.length ? await query('reads', {_id: {$in: ids(siblings)}}) : [];
  const ingestJobs = await query('ingestjobs', {runId: {$in: allRuns.map(r => r._id)}}, {_id:1,runId:1,type:1,status:1,attempts:1,leaseExpiresAt:1,createdAt:1,updatedAt:1,workerHost:1});
  const byId = rows => new Map(rows.map(r => [id(r._id), r]));
  const projectMap=byId(projects), sampleMap=byId(samples), runMap=byId(runs), fileMap=byId(files);
  for (const expected of [...scope.sourceProjects, scope.targetProject]) {
    const actual=projectMap.get(expected._id);
    if (!actual) {issues.push({kind:'missing-project',id:expected._id}); continue;}
    for (const key of ['name','path','safeName','group']) if (id(actual[key]) !== id(expected[key])) issues.push({kind:'project-identity-changed',id:expected._id,key,expected:expected[key],actual:actual[key]});
    const state=actual.storage?.state || 'hpc';
    if(state !== expected.storage.state) issues.push({kind:'project-state-changed',id:expected._id,state,expected:expected.storage.state});
    if(expected._id===scope.targetProject._id && ['s3Uri','s3VerifiedAt','hpcVerifiedAbsentAt','archivedAt'].some(k=>actual.storage?.[k]!=null && actual.storage[k]!=='')) issues.push({kind:'target-has-unexpected-archive-evidence',id:expected._id});
    if(sourceIds.includes(expected._id)) {
      for(const key of ['id','phase','sourceRoot','sourceRelativeRoot']) if(id(actual.archiveMigration?.[key])!==id(expected.archiveMigration[key])) issues.push({kind:'archive-identity-changed',id:expected._id,key});
      for(const key of ['sourceSha256','verificationSha256','fileCount','totalBytes']) if(actual.archiveMigration?.manifests?.[key]!==expected.archiveMigration.manifests[key]) issues.push({kind:'archive-manifest-changed',id:expected._id,key});
      const at=new Date(actual.storage?.s3VerifiedAt).getTime();
      if(actual.storage?.s3Uri!==expected.storage.s3Uri || !Number.isFinite(at) || new Date(at).toISOString()!==expected.storage.s3VerifiedAt) issues.push({kind:'archive-verification-changed',id:expected._id});
    }
  }
  for(const expected of scope.matches) {
    const sample=sampleMap.get(expected.sample._id);
    if(!sample) {issues.push({kind:'missing-sample',id:expected.sample._id});continue;}
    for(const key of ['name','path','safeName','project','group']) if(id(sample[key])!==id(expected.sample[key])) issues.push({kind:'sample-identity-changed',id:expected.sample._id,key,expected:expected.sample[key],actual:sample[key]});
    const currentRuns=allRuns.filter(r=>id(r.sample)===expected.sample._id);
    if(currentRuns.length!==1 || id(currentRuns[0]?._id)!==expected.runs[0]._id) issues.push({kind:'run-coverage-changed',sampleId:expected.sample._id,runs:currentRuns.map(r=>({_id:r._id,name:r.name}))});
    for(const er of expected.runs) {
      const run=runMap.get(er._id);
      if(!run) {issues.push({kind:'missing-run',id:er._id});continue;}
      for(const key of ['name','path','safeName','sample','group']) if(id(run[key])!==id(er[key])) issues.push({kind:'run-identity-changed',id:er._id,key,expected:er[key],actual:run[key]});
      if(['pending','processing'].includes(run.status)) issues.push({kind:'run-active',id:er._id,status:run.status});
      if(run.md5VerificationStatus==='in_progress') issues.push({kind:'run-md5-active',id:er._id});
    }
  }
  for(const sample of allSamples.filter(s=>id(s.project)===scope.targetProject._id)) {
    notes.push({kind:'existing-target-sample',id:id(sample._id),name:sample.name,path:sample.path});
    if(targetRoots.some(p=>within(p,sample.path)) || scope.matches.some(m=>m.sample.name===sample.name || m.sample.safeName===sample.safeName)) issues.push({kind:'target-sample-collision',id:id(sample._id),path:sample.path});
  }
  for(const run of allRuns) if(targetRoots.some(p=>within(p,run.path))) issues.push({kind:'target-run-collision',id:id(run._id),path:run.path});
  for(const sample of allSamples) if(!selectedSamples.has(id(sample._id)) && sampleRoots.some(p=>within(p,sample.path))) issues.push({kind:'external-sample-in-selected-tree',id:id(sample._id),path:sample.path});
  for(const run of allRuns) if(!selectedRuns.has(id(run._id)) && sampleRoots.some(p=>within(p,run.path))) issues.push({kind:'external-run-in-selected-tree',id:id(run._id),path:run.path});
  const mappings=[];
  for(const file of files) {
    const match=scope.matches.find(m=>within(m.sample.path,file.path));
    if(match) {
      const newPath=scope.targetProject.path+'/'+match.sample.safeName+normalized(file.path).slice(match.sample.path.length);
      mappings.push({collection:'files',id:id(file._id),oldPath:file.path,newPath:file.path.startsWith('/')?newPath:newPath.slice(1),sampleId:match.sample._id});
    }
    else if(linkedFileIds.includes(id(file._id))) issues.push({kind:'linked-file-outside-selected-trees',id:id(file._id),path:file.path});
    if(targetRoots.some(p=>within(p,file.path))) issues.push({kind:'target-file-collision',id:id(file._id),path:file.path});
  }
  for(const rid of linkedFileIds) if(!fileMap.has(rid)) issues.push({kind:'missing-linked-file',id:rid});
  for(const read of reads) {
    if(read.sibling && !siblingReads.some(s=>id(s._id)===id(read.sibling)&&id(s.run)===id(read.run)&&id(s.sibling)===id(read._id))) issues.push({kind:'invalid-paired-read-sibling',id:id(read._id),sibling:id(read.sibling)});
  }
  for(const read of inboundReads) if(!selectedRuns.has(id(read.run))) issues.push({kind:'external-read-reference',id:id(read._id),file:id(read.file),run:id(read.run)});
  for(const a of inboundAdditional) {
    const selected=selectedRuns.has(id(a.run))||selectedSamples.has(id(a.sample));
    if(!selected) issues.push({kind:'external-additional-file-reference',id:id(a._id),file:id(a.file),run:id(a.run),sample:id(a.sample),project:id(a.project)});
    if([a.project,a.sample,a.run].filter(Boolean).length!==1) issues.push({kind:'mixed-additional-parent',id:id(a._id),project:id(a.project),sample:id(a.sample),run:id(a.run)});
  }
  for(const j of ingestJobs) if(['pending','claimed'].includes(j.status)) issues.push({kind:'active-ingest-job',id:id(j._id),runId:id(j.runId),status:j.status});
  const selectedDocuments={projects,samples,runs,reads,additionalFiles:selectedAdditional,files};
  const pins=[];
  for(const [collection,rows] of Object.entries(selectedDocuments)) for(const d of rows) {
    if(d.reconciliation && (d.reconciliation.version!==1 || !d.reconciliation.operationId || !d.reconciliation.identity || typeof d.reconciliation.identity!=='object' || Array.isArray(d.reconciliation.identity))) issues.push({kind:'malformed-reconciliation-state',collection,id:id(d._id)});
    if(d.reconciliationHistory!==undefined && !Array.isArray(d.reconciliationHistory)) issues.push({kind:'malformed-reconciliation-history',collection,id:id(d._id)});
    if(d.reconciliation && Object.prototype.hasOwnProperty.call(d.reconciliation,'retiredAt')) issues.push({kind:'retired-or-malformed-retirement',collection,id:id(d._id)});
    if(d.reconciliation?.identity) {
      pins.push({collection,id:id(d._id),operationId:d.reconciliation.operationId,identity:d.reconciliation.identity,historyEntries:d.reconciliationHistory?.length||0});
      for(const [key,value] of Object.entries(d.reconciliation.identity)) if(id(d[key])!==id(value)) issues.push({kind:'pinned-identity-mismatch',collection,id:id(d._id),key});
    }
  }
  for(const match of scope.matches) {
    mappings.push({collection:'samples',id:match.sample._id,oldProject:match.sample.project,newProject:scope.targetProject._id,oldPath:match.sample.path,newPath:scope.targetProject.path+'/'+match.sample.safeName});
    for(const run of match.runs) mappings.push({collection:'runs',id:run._id,oldPath:run.path,newPath:scope.targetProject.path+'/'+match.sample.safeName+run.path.slice(match.sample.path.length)});
  }
  const drift=[];
  for(const [collection,rows] of Object.entries(selectedDocuments)) {
    const reread=rows.length ? await query(collection.toLowerCase(),{_id:{$in:rows.map(r=>r._id)}}) : [];
    const latest=byId(reread);
    for(const row of rows) if(!latest.has(id(row._id)) || sha(row)!==sha(latest.get(id(row._id)))) drift.push({collection,id:id(row._id)});
  }
  if(drift.length) issues.push({kind:'changed-during-observation',documents:drift});
  const hello=await db.admin().command({isMaster:1});
  return {kind:'gulnara-read-only-db-preflight',startedAt,finishedAt:new Date().toISOString(),database:db.databaseName,
    topology:{setName:hello.setName||null,isWritablePrimary:hello.ismaster===true,logicalSessionTimeoutMinutes:hello.logicalSessionTimeoutMinutes||null},
    observationIsTransactionSnapshot:false,documents:selectedDocuments,related:{allSamples,allRuns,projectAdditionalFiles:additionalFiles.filter(a=>!selectedAdditional.includes(a)),inboundReads,inboundAdditional,siblingReads,ingestJobs},
    summary:{projects:projects.length,samples:samples.length,runs:runs.length,reads:reads.length,selectedAdditionalFiles:selectedAdditional.length,files:files.length,pinnedDocuments:pins.length,proposedPathUpdates:mappings.length,issues:issues.length},
    pins,mappings,issues,notes};
}
module.exports={collectDatabase,normalized,within};
