// Local, repeatable analysis of the read-only JSONL evidence. No remote operations.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const folder=__dirname,input=path.resolve(process.argv[2]);
const events=fs.readFileSync(input,'utf8').trim().split('\n').map(JSON.parse);
const complete=events.findLast(e=>e.type==='complete'),start=events.find(e=>e.type==='start');
assert(complete && complete.completed+complete.errors===197,'A complete 197-target inventory is required');
assert.equal(start.mode,'inventory');
const expected=JSON.parse(fs.readFileSync(path.join(folder,'projects.json')));
const oldLocations=JSON.parse(fs.readFileSync(path.join(folder,'location-proposals.json')));
const write=(name,data)=>fs.writeFileSync(path.join(folder,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
const norm=p=>typeof p==='string'?'/'+p.replace(/^\/mnt\/reads(?=\/)/,'').replace(/^\/+|\/+$/g,''):null;
const tally=(rows,key)=>rows.reduce((out,row)=>{const k=typeof key==='function'?key(row):row[key];out[k]=(out[k]||0)+1;return out;},{});
const fileClass=p=>{
  const n=path.posix.basename(p).toLowerCase();
  if(/\.(?:md5|sha1|sha256|sha512)(?:sum)?(?:\.txt)?$/.test(n)||/^(?:md5|sha1|sha256|sha512)sums?(?:\.txt)?$/.test(n))return 'checksum-file-candidate';
  if(/\.(?:fastq|fq)(?:\.gz|\.bz2|\.txt)?$/.test(n))return 'fastq-candidate';
  if(/\.(?:fasta|fa|fna|fas|sff|bam|cram|h5|fast5|pod5)(?:\.gz|\.bz2)?$/.test(n))return 'other-sequence-data-candidate';
  if(/\.(?:xml|json|csv|tsv|txt|log|pdf|html|htm|xlsx|xls|doc|docx|png|jpg|jpeg|svg|r|sh|py|pl|gff|gff3|gtf|bed|bai|fai)$/.test(n))return 'supporting-file-candidate';
  return 'unclassified-preserve';
};
const physical=[],projects=[],exceptions=[],smallTargets=[],largeTargets=[];
for(const event of events.filter(e=>e.type==='project-error'))exceptions.push({entryId:event.entryId,kind:'live-collection-failed',detail:event.error,blocksExecution:true});
for(const row of events.filter(e=>e.type==='project')) {
  const before=expected.find(e=>e.entryId===row.entryId);assert(before);
  const db=row.database,root=norm(row.physicalRoot),archive=before.disposition==='archive';
  const files=(row.inventory?.entries||[]).filter(e=>e.type==='file');
  const bytes=files.reduce((s,f)=>s+f.size,0);
  const note=(kind,detail,blocksExecution=true)=>exceptions.push({entryId:row.entryId,kind,detail,blocksExecution});
  if(before.projectId&&!db.project)note('registered-project-missing',before.projectId);
  if(db.project&&db.project.path!==before.registeredPath)note('project-path-changed',{before:before.registeredPath,now:db.project.path});
  if(archive&&!row.rootExists)note('physical-root-absent',row.physicalRoot);
  if(archive&&db.project?.storage?.state&&db.project.storage.state!=='hpc')note('storage-state-not-hpc',db.project.storage);
  if(archive&&(row.activeIngest.length||db.runs.some(r=>['pending','processing'].includes(r.status)||r.md5VerificationStatus==='in_progress')))note('active-work','Current ingest/run/MD5 work requires separate resolution');
  if(archive&&(row.outsideReads.length||row.outsideAdditional.length))note('outside-file-references',{reads:row.outsideReads,additional:row.outsideAdditional});
  const allowedParents={project:new Set(db.project?[String(db.project._id)]:[]),sample:new Set(db.samples.map(s=>String(s._id))),run:new Set(db.runs.map(r=>String(r._id)))};
  const crossParent=db.additional.filter(a=>Object.keys(allowedParents).some(k=>a[k]&&!allowedParents[k].has(String(a[k]))));
  if(archive&&crossParent.length)note('cross-parent-additional-files',crossParent.map(a=>({id:a._id,project:a.project,sample:a.sample,run:a.run})));
  if(before.expectedFileCount!==null&&(before.expectedFileCount!==files.length||before.expectedBytes!==bytes))note('inventory-count-or-byte-change',{previousFiles:before.expectedFileCount,nowFiles:files.length,previousBytes:before.expectedBytes,nowBytes:bytes},archive);
  if(archive&&(row.inventory?.entries||[]).some(e=>!['file','dir'].includes(e.type)))note('nonregular-entries',(row.inventory.entries.filter(e=>!['file','dir'].includes(e.type))).map(e=>({path:e.relPath,type:e.type})),true);
  if(!before.projectId&&row.projectClaims.length)note('new-existing-project-claim',row.projectClaims);
  const ownerChanged=!!db.project&&(db.project.owner||null)!==before.owner.existingDatabaseOwner;
  if(ownerChanged)note('owner-changed',{previous:before.owner.existingDatabaseOwner,current:db.project.owner},false);
  const physicalSet=new Set(files.map(f=>root+'/'+f.relPath));
  const actualReferences=new Map();
  for(const file of db.files) {
    const refs=[...db.reads.filter(r=>String(r.file)===String(file._id)).map(r=>({kind:'Read',id:r._id,runId:r.run,fileId:file._id})),...db.additional.filter(a=>String(a.file)===String(file._id)).map(a=>({kind:'AdditionalFile',id:a._id,runId:a.run,sampleId:a.sample,projectId:a.project,fileId:file._id}))];
    const stored=norm(file.path), prior=oldLocations.find(p=>p.fileId===String(file._id));
    const resolved=stored&&physicalSet.has(stored)?stored:prior&&physicalSet.has(prior.proposedPhysicalFilePath)?prior.proposedPhysicalFilePath:null;
    if(resolved){const list=actualReferences.get(resolved)||[];list.push({fileId:file._id,storedPath:file.path,pathCorrectionNeeded:resolved!==stored,references:refs});actualReferences.set(resolved,list);}
    else if(archive&&refs.length)note('referenced-file-location-unresolved',{fileId:file._id,storedPath:file.path,references:refs});
  }
  const fileIds=new Set(db.files.map(f=>String(f._id)));
  for(const record of [...db.reads,...db.additional])if(archive&&!fileIds.has(String(record.file)))note('missing-file-document',{recordId:record._id,fileId:record.file});
  const relatedByPrefix=(docs,absolute)=>docs.filter(d=>norm(d.path)&&absolute.startsWith(norm(d.path)+'/')).sort((a,b)=>norm(b.path).length-norm(a.path).length);
  const small=[],large=[];
  for(const f of files){
    const absolute=root+'/'+f.relPath,associated=actualReferences.get(absolute)||[];
    const runCandidates=relatedByPrefix(db.runs,absolute),sampleCandidates=relatedByPrefix(db.samples,absolute);
    const runMatches=runCandidates.length?runCandidates.filter(r=>norm(r.path).length===norm(runCandidates[0].path).length):[];
    const sampleMatches=sampleCandidates.length?sampleCandidates.filter(s=>norm(s.path).length===norm(sampleCandidates[0].path).length):[];
    const parent=runMatches.length===1?{kind:'Run',id:runMatches[0]._id,path:runMatches[0].path}:sampleMatches.length===1?{kind:'Sample',id:sampleMatches[0]._id,path:sampleMatches[0].path}:db.project?{kind:'Project',id:db.project._id,path:db.project.path}:{kind:'Project-to-register',id:null,path:root};
    const classification=fileClass(f.relPath);
    const sequence=['fastq-candidate','other-sequence-data-candidate'].includes(classification);
    const hasRecord=associated.some(a=>a.references.length);
    const linkStatus=hasRecord?'existing-record':associated.length?'orphan-file-document':'no-file-document';
    const rawRun=runMatches.length===1&&absolute.startsWith(norm(runMatches[0].path)+'/raw/');
    const proposedAction=!archive?'no-reconciliation-change':hasRecord?'retain-existing-record-and-physical-path':associated.length?'reuse-file-document-attach-supported-parent':sequence?'preserve-unclassified-sequence; consider-Read-only-after-content-and-identity-review':'register-supporting-or-unclassified-file';
    const out={entryId:row.entryId,relPath:f.relPath,canonicalPath:row.physicalRoot+'/'+f.relPath,bytes:f.size,inArchiveScope:archive,classification,classificationBasis:'filename-and-directory-only',linkStatus,existingFileReferences:associated,parentCandidate:parent,parentBasis:'longest-existing-path-prefix; not-scientific-identity-proof',ambiguousParent:runMatches.length>1||sampleMatches.length>1,rawRunCandidate:rawRun,proposedAction,currentChecksum:null,observationAt:row.finishedAt,executionStatus:'proposal-only'};
    physical.push(out);
    if(archive){if(f.size<=1024*1024)small.push(f);else large.push(f);}
  }
  if(small.length)smallTargets.push({entryId:row.entryId,root:row.physicalRoot,files:small});
  if(large.length)largeTargets.push({entryId:row.entryId,root:row.physicalRoot,files:large});
  projects.push({entryId:row.entryId,disposition:before.disposition,projectId:db.project?String(db.project._id):null,physicalRoot:row.physicalRoot,rootExists:row.rootExists,files:files.length,bytes,countsAndBytesAgreeWithPrevious:files.length===before.expectedFileCount&&bytes===before.expectedBytes,countsAgreementIsNotContentEquality:true,existingOwner:db.project?.owner||null,existingSecondaryOwner:db.project?.secondaryOwner||null,exportOwner:before.owner.exportOwner,unixOwner:row.unixOwner,ownerChanged,projectClaims:row.projectClaims,dbCounts:{samples:db.samples.length,runs:db.runs.length,reads:db.reads.length,additionalFiles:db.additional.length,files:db.files.length},observationAt:row.finishedAt,atomicSnapshot:false});
}
const archiveFiles=physical.filter(f=>f.inArchiveScope),newFiles=archiveFiles.filter(f=>f.linkStatus==='no-file-document'),existing=archiveFiles.filter(f=>f.linkStatus==='existing-record');
const summary={preparedAt:new Date().toISOString(),evidence:path.relative(folder,input),evidenceSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),sourceStartedAt:start.at,sourceFinishedAt:complete.at,collectorSha256:start.collectorSha256,gitBefore:start.gitBefore,gitAfter:complete.gitAfter,projectsObserved:projects.length,collectionErrors:complete.errors,totalPhysicalFiles:physical.length,totalBytes:physical.reduce((s,f)=>s+f.bytes,0),archivePhysicalFiles:archiveFiles.length,archiveBytes:archiveFiles.reduce((s,f)=>s+f.bytes,0),archiveLinkCounts:tally(archiveFiles,'linkStatus'),uncataloguedClassification:tally(newFiles,'classification'),uncataloguedParentCounts:tally(newFiles,f=>f.parentCandidate.kind),uncataloguedRawFastqWithRun:newFiles.filter(f=>f.classification==='fastq-candidate'&&f.rawRunCandidate).length,ambiguousParentFiles:archiveFiles.filter(f=>f.ambiguousParent).length,pathCorrectionFiles:existing.filter(f=>f.existingFileReferences.some(r=>r.pathCorrectionNeeded)).length,technicalExceptions:exceptions.length,exceptionKinds:tally(exceptions,'kind'),blockingExceptionEntries:[...new Set(exceptions.filter(e=>e.blocksExecution).map(e=>e.entryId))],smallHashTargetFiles:smallTargets.reduce((s,t)=>s+t.files.length,0),smallHashTargetBytes:smallTargets.flatMap(t=>t.files).reduce((s,f)=>s+f.size,0),largeHashTargetFiles:largeTargets.reduce((s,t)=>s+t.files.length,0),largeHashTargetBytes:largeTargets.flatMap(t=>t.files).reduce((s,f)=>s+f.size,0),humanDispositionDecisionsOutstanding:0,ownerEnquiriesOutstanding:0,currentChecksumsCalculated:0,productionWrites:false};
write('live-projects.json',projects);write('live-files.jsonl',physical.map(f=>JSON.stringify(f)).join('\n')+'\n');write('live-exceptions.json',exceptions);write('current-checksum-targets-small.json',smallTargets);write('current-checksum-pending-large.json',largeTargets);write('live-summary.json',summary);console.log(JSON.stringify(summary,null,2));
