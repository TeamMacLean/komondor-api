'use strict';
// Inspected r2 continuation after an API-head fence stopped r1 before any native command.
// Finalize only the four user-deleted Gulnara sources via native confirm-absent.
// No payload/S3 deletion, direct database writes, service control or automatic retry.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const cp = require('node:child_process'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const ROOT = '/mnt/reads';
const REVIEW = '/storage/komondor-gulnara-source-review-20261127-01';
const PACKAGE = '/storage/komondor-gulnara-source-delete-20261127-01';
const RESULTS = REVIEW + '/results-25340876';
const PLAN_SHA = 'e136a50e1ac04046197eafb51f60e08bade81fa750c16d30870ec1366302f8cf';
const REVIEW_HEAD = '12e7f1da1537b693f60c86d692f0c3236edcf299';
const CONFIRM_HEAD = '2474c4a4b070041a4e42f4148a25f8c7832137eb';
const CODE_REVIEW_SHA = 'dde08a598d49cbe36edc147db13988a5e241462fe18978a12075c606edbfebfe';
const CONFIRM_FUNCTION_SHA = '3938ad016a9534487eb42ea6e11a76c2b2c7b4bad542c1a8b80fe5ca795ed9c1';
const COPY_SHA = '92c5eeeaa09aa4952da5386b9f365bb039775b7e074b699f09e9c03dc81d3bf9';
const GRAPH_SHA = 'bad9782ead46998a2c60d011fb8f6546cd05bb01d6639d3367f6ae81b42e6a3d';
const TARGETS = {
  '61204424e788b405b6ce6bde': 'ntalbot/lichen_coculture_i_2_days',
  '611ff26de788b405b6ce6a4c': 'ntalbot/lichen_coculture_i_9_days',
  '5fd1ed55d8dd4a63058cc1c9': 'ntalbot/lichen_coculture_i_21_days',
  '5fdb2d62d7661b6ec22a0571': 'ntalbot/lichen_coculture_i_42_days',
};
const DEST = '6ae4ac89a6b876c643741d27', GARGY = '5fc012bda3efcb29338b7d58';
const HELD = { [DEST]: 'ntalbot/xanthoria_parietina_mycobiont_rnaseq', [GARGY]: 'two_blades/gargy_2019_rnaseq' };
const STAGE = 'ntalbot/.gulnara-staging-20261126-c1f78c6d-3a3f-4165-abe5-706ded74bf99';
const JOB = '25340876', LOG = 'komondor-gulnara-4-25340876.log', JSONL = 'deletion-25340876.jsonl';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const id = value => String(value?._id || value);
const ordered = x => Array.isArray(x) ? x.map(ordered) : x && Object.getPrototypeOf(x) === Object.prototype
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered(x[k])])) : x;
const TYPED = { promoteValues: false, promoteLongs: false, promoteBuffers: false };
let c, api, cli, createAws, collectProjectDatabase, collectHardBlockers, resolveHpcPreservation, projectStorageLocations, bson;
let pack, startedAt, plan, copies, graphBaseline, graphQueries;
const commands = [], confirmed = [], completed = [];
function saveBytes(name, bytes) {
  assert.equal(path.basename(name), name); const fd = fs.openSync(path.join(pack, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(path.join(pack, name), 0o400); return sha(bytes);
}
const save = (name, value) => saveBytes(name, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
function safe(filename, directory = false) {
  assert(path.isAbsolute(filename) && path.normalize(filename) === filename);
  let current = path.parse(filename).root, st;
  for (const part of filename.slice(current.length).split('/').filter(Boolean)) {
    current = path.join(current, part); st = fs.lstatSync(current); assert(!st.isSymbolicLink(), 'Symlink: ' + current);
    if (current !== filename || directory) assert(st.isDirectory(), 'Not a directory: ' + current);
  }
  return st;
}
function read(filename) { assert(safe(filename).isFile()); return fs.readFileSync(filename); }
function validatePlan(value) {
  assert.equal(value.apiHead, REVIEW_HEAD, 'Original historical plan API head differs');
  assert.equal(value.kind, 'komondor-reviewed-hpc-deletion-v1'); assert.equal(value.stage, 'gulnara-four-sources');
  assert.equal(value.releaseStatus, 'ready-for-user-submission'); assert.equal(value.hpcRoot, '/tsl/data/reads');
  assert.equal(value.projects.length, 4);
  assert.deepEqual(Object.fromEntries(value.projects.map(p => [p.projectId, p.relativeRoot])), TARGETS);
  assert.deepEqual(Object.fromEntries(value.held.map(p => [p.projectId, p.relativeRoot])), HELD);
  assert.deepEqual(value.protectedRoots, [...Object.values(HELD), STAGE].sort());
  assert.equal(value.projects.reduce((n,p) => n+p.fileCount, 0), 452);
  assert.equal(value.projects.reduce((n,p) => n+p.bytes, 0), 482738413472);
  for (const p of value.projects) assert.equal(p.hpcPath, '/tsl/data/reads/' + TARGETS[p.projectId]);
}
function validateJobAudit(audit, value) {
  assert.equal(audit.kind, 'gulnara-source-deletion-job-audit-v1'); assert.equal(audit.success, true);
  assert.equal(String(audit.jobId), JOB); assert.equal(audit.planSha256, PLAN_SHA); assert.deepEqual(audit.issues, []);
  assert.equal(audit.projects, 4); assert.equal(audit.files, 452); assert.equal(audit.bytes, 482738413472);
  const sort = rows => rows.slice().sort((a,b) => a.projectId.localeCompare(b.projectId));
  assert.deepEqual(sort(audit.exactTargets), sort(value.projects.map(p => ({ projectId:p.projectId,hpcPath:p.hpcPath,files:p.fileCount,bytes:p.bytes }))));
  assert.deepEqual(audit.events, { started:1, preflightPassed:4, deletionStarted:4, deleted:4, complete:1, total:14 });
  for (const key of ['protectedCopiesIntact','databaseConfirmationRequired','execute','allEventsWithinReview']) assert.equal(audit[key], true);
  assert.equal(audit.processExitCode, 0); assert.equal(audit.slurmStatus.state, 'COMPLETED'); assert.equal(audit.slurmStatus.exitCode, '0:0');
  assert.deepEqual(audit.inputs.map(x=>x.name).sort(), ['deletion-plan.json', JSONL, LOG].sort());
  for (const input of audit.inputs) { assert.match(input.sha256,/^[a-f0-9]{64}$/); assert(Number.isSafeInteger(input.bytes) && input.bytes > 0); }
  const start=Date.parse(audit.startedAt), end=Date.parse(audit.completedAt);
  assert(Number.isFinite(start)&&Number.isFinite(end)&&start<=end);
  assert(start>=Date.parse(value.reviewCompletedAt)&&end<=Date.parse(value.expiresAt), 'Deletion outside reviewed window');
}
function validateCodeReview(value) {
  assert.equal(value.oldHead, REVIEW_HEAD); assert.equal(value.newHead, CONFIRM_HEAD);
  assert.equal(value.workingTreeClean, true);
  assert.deepEqual(value.runtimeChangedFiles, ['lib/s3-archive/cli.js']);
  assert.equal(value.confirmAbsentIdentical, true); assert.equal(value.confirmAbsentSha256, CONFIRM_FUNCTION_SHA);
  assert.deepEqual(value.failedAttemptConfirmedProjects, []);
  assert.deepEqual(value.failedAttemptNativeCommands, []);
}
function stripConfirmation(project) {
  const result = { ...project, storage:{...project.storage}, archiveMigration:{...project.archiveMigration} };
  delete result.updatedAt;
  for (const key of ['state','hpcVerifiedAbsentAt','archivedAt']) delete result.storage[key];
  for (const key of ['phase','confirmedAbsentBy','updatedAt']) delete result.archiveMigration[key];
  return result;
}
function sameBson(a,b,ignoreConfirmation=false) {
  const clean = x => ordered(ignoreConfirmation ? stripConfirmation(x) : x);
  assert(bson.serialize(clean(a)).equals(bson.serialize(clean(b))), 'Scoped BSON record changed');
}
function checkCopies() {
  const expected = new Map(copies.entries.map(e => [e.destination.slice((ROOT+'/'+HELD[DEST]+'/').length), e]));
  assert.equal(expected.size,40);
  for (const relativeRoot of [HELD[DEST],STAGE]) {
    const root=ROOT+'/'+relativeRoot; const rootStat=safe(root,true), found=new Set();
    function walk(directory) {
      for (const name of fs.readdirSync(directory)) {
        const filename=path.join(directory,name), st=safe(filename);
        assert.equal(st.dev,rootStat.dev,'Protected nested device');
        if(st.isDirectory()) {walk(filename);continue;}
        assert(st.isFile(),'Unexpected protected file type');
        const relative=path.relative(root,filename), e=expected.get(relative);assert(e,'Unexpected protected file: '+filename);
        const metadata=relativeRoot===STAGE?e.stageMetadata:e.destinationMetadata;
        for(const key of ['ino','size','mtimeMs','ctimeMs','nlink']) assert.equal(st[key],metadata[key],'Protected copy metadata changed: '+filename+'/'+key);
        assert.equal(st.nlink,2);assert.notEqual(st.ino,e.sourceMetadata.ino); found.add(relative);
      }
    }
    walk(root);assert.equal(found.size,40);for(const relative of expected.keys())assert(found.has(relative),'Missing protected copy');
  }
  safe(ROOT+'/'+HELD[GARGY],true);
}
function observe() {
  const mount=JSON.parse(cp.execFileSync('findmnt',['-J','-T',ROOT,'-o','TARGET,SOURCE,FSTYPE'])).filesystems[0];
  assert.equal(mount.target,ROOT);assert.equal(mount.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(mount.fstype.startsWith('nfs'));
  safe(ROOT,true);safe(ROOT+'/ntalbot',true);safe(ROOT+'/two_blades',true);
  for(const relative of Object.values(TARGETS)) assert.throws(()=>fs.lstatSync(ROOT+'/'+relative),{code:'ENOENT'});
  checkCopies();return {at:new Date().toISOString(),mount,absentTargets:4,destinationFiles:40,stagingFiles:40,gargyPresent:true};
}
const readProject = projectId => c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId(projectId)});
async function snapshot(projectId) {return {project:await readProject(projectId),database:await collectProjectDatabase(c.models,projectId)};}
function identity(project, reviewed, state='aws_pending_hpc_deletion') {
  assert(project);assert.equal(id(project),reviewed.projectId);assert.equal(project.path,'/'+reviewed.relativeRoot);
  assert.equal(project.storage.state,state);assert.equal(project.archiveMigration.phase,state==='aws'?'completed':'verified');
  assert.equal(project.archiveMigration.sourceRoot,ROOT+'/'+reviewed.relativeRoot);assert.equal(project.archiveMigration.sourceRelativeRoot,reviewed.relativeRoot);
  assert.equal(String(project.archiveMigration.id),reviewed.migrationId);assert.equal(project.storage.s3Uri,reviewed.s3Uri);
  assert.equal(project.storage.s3VerifiedAt.toISOString(),reviewed.s3VerifiedAt);
  for(const key of ['sourceSha256','verificationSha256'])assert.equal(project.archiveMigration.manifests[key],reviewed[key]);
  assert.equal(project.archiveMigration.manifests.fileCount,reviewed.fileCount);assert.equal(project.archiveMigration.manifests.totalBytes,reviewed.bytes);
  const hold=resolveHpcPreservation(project);assert.equal(hold.active,false);assert.equal(hold.invalid,false);
}
function localControls(reviewed) {
  for(const [name,kind,digest] of [['source-manifest.v1.json','source',reviewed.sourceSha256],['verification-report.v1.json','verification',reviewed.verificationSha256]]) {
    const bytes=read(REVIEW+'/'+reviewed.projectId+'/'+name);assert.equal(sha(bytes),digest);
    const record=JSON.parse(bytes);assert.equal(record.kind,kind);assert.equal(String(record.projectId),reviewed.projectId);assert.equal(String(record.migrationId),reviewed.migrationId);
    if(kind==='source') {assert.equal(record.sourceRoot,ROOT+'/'+reviewed.relativeRoot);assert.equal(record.sourceRelativeRoot,reviewed.relativeRoot);assert.equal(record.dataPrefix,reviewed.s3Uri);assert(record.entries.every(e=>e.type==='dir'||e.disposition==='copy'));}
    else {assert.equal(record.verified,true);assert.equal(record.sourceManifestSha256,reviewed.sourceSha256);}
    saveBytes(reviewed.projectId+'-'+name,bytes);
  }
}
async function protectedSnapshot() {
  const rows=[];
  for(const [projectId,relative] of Object.entries(HELD)) {
    const value=await snapshot(projectId);assert(value.project);assert.equal(value.project.path,'/'+relative);
    assert.equal(resolveHpcPreservation(value.project).invalid,false);
    if(projectId===DEST)assert.equal(value.project.storage?.state||'hpc','hpc');
    else {assert.equal(value.project.storage.state,'aws_pending_hpc_deletion');assert.equal(value.project.archiveMigration.phase,'verified');assert.equal(resolveHpcPreservation(value.project).active,true);}
    rows.push(value);
  }
  return rows;
}
function prepareGraph() {
  const raw=read(REVIEW+'/destination-evidence/destination-db-after.json');assert.equal(sha(raw),GRAPH_SHA);saveBytes('destination-graph-baseline.json',raw);
  const saved=JSON.parse(raw);graphBaseline=Object.fromEntries(Object.entries(saved.collections).map(([name,rows])=>[name,rows.map(r=>{const d=bson.deserialize(Buffer.from(r.bson,'base64'),TYPED);assert.equal(id(d),r.id);return d;})]));
  const O=rows=>rows.map(r=>new c.mongoose.Types.ObjectId(id(r)));
  const sampleIds=O(graphBaseline.samples),runIds=O(graphBaseline.runs),fileIds=O(graphBaseline.files);
  const regex=new RegExp('^/?'+HELD[DEST].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)');
  graphQueries={
    projects:{_id:{$in:O(graphBaseline.projects)}}, samples:{$or:[{_id:{$in:sampleIds}},{project:new c.mongoose.Types.ObjectId(DEST)}]},
    runs:{$or:[{_id:{$in:runIds}},{sample:{$in:sampleIds}}]}, reads:{$or:[{run:{$in:runIds}},{file:{$in:fileIds}}]},
    additionalfiles:{$or:[{sample:{$in:sampleIds}},{run:{$in:runIds}},{project:new c.mongoose.Types.ObjectId(DEST)},{file:{$in:fileIds}}]},
    files:{$or:[{_id:{$in:fileIds}},{path:regex}]},
    ingestjobs:{$or:[{runId:{$in:runIds}},{run:{$in:runIds}},{sample:{$in:sampleIds}},{project:new c.mongoose.Types.ObjectId(DEST)}]},
  };
}
async function checkGraph() {
  const evidence={};
  for(const [name,query] of Object.entries(graphQueries)) {
    const current=await c.mongoose.connection.db.collection(name).find(query,TYPED).sort({_id:1}).maxTimeMS(30000).toArray();
    assert.equal(current.length,graphBaseline[name].length,'Scoped graph count changed: '+name);const byId=new Map(current.map(d=>[id(d),d]));
    for(const before of graphBaseline[name]) {const actual=byId.get(id(before));assert(actual,'Missing scoped graph record');sameBson(before,actual,name==='projects'&&confirmed.includes(id(before)));}
    evidence[name]=current.map(d=>({id:id(d),bson:bson.serialize(d).toString('base64')}));
  }
  return evidence;
}
async function native(reviewed, project, execute) {
  const aws=createAws(c.config), run=aws.run.bind(aws),get=aws.getObjectBuffer.bind(aws);
  const allowed=new Set(['sts get-caller-identity','s3api head-bucket','s3api get-bucket-versioning','s3api get-bucket-lifecycle-configuration','s3api head-object','s3api list-objects-v2','s3api list-multipart-uploads']);
  aws.run=(args,options)=>{assert(allowed.has(args.slice(0,2).join(' '))||args[0]==='--version'||args.at(-1)==='help','Unexpected AWS operation');return run(args,options);};
  aws.getObjectBuffer=async key=>{
    const matched=[['sourceS3Uri','sourceSha256'],['verificationS3Uri','verificationSha256']].find(([uri])=>project.archiveMigration.manifests[uri].endsWith('/'+key));assert(matched,'Unreviewed control read');
    const bytes=await get(key);assert.equal(sha(bytes),project.archiveMigration.manifests[matched[1]],'Native remote control changed');return bytes;
  };
  let stdout='',stderr='';const args=['confirm-absent','--project-id',reviewed.projectId,'--confirmed-by','deeks',...(execute?['--execute']:[])];
  const exitCode=await cli.runCli(args,{...c,aws,stdout:x=>stdout+=x,stderr:x=>stderr+=x});
  const receipt={at:new Date().toISOString(),projectId:reviewed.projectId,args,exitCode,stdout,stderr};commands.push(receipt);save(reviewed.projectId+(execute?'-confirmation.json':'-dry-run.json'),receipt);
  assert.equal(exitCode,0,stderr||'Native confirmation failed');assert.equal(stderr,'');const result=JSON.parse(stdout);
  assert.equal(result.command,'confirm-absent');assert.equal(String(result.migrationId),reviewed.migrationId);
  if(execute){assert.equal(result.state,'aws');assert.equal(result.phase,'completed');}else assert.equal(result.would,'finalize project as aws');
}
async function checkAfter(item) {
  const {reviewed,project:before,database:beforeDatabase}=item,value=await snapshot(reviewed.projectId);identity(value.project,reviewed,'aws');
  const project=value.project;assert.equal(project.archiveMigration.confirmedAbsentBy,'deeks');assert(project.storage.hpcVerifiedAbsentAt instanceof Date);
  assert(project.storage.hpcVerifiedAbsentAt.getTime()>=Date.parse(startedAt));assert.equal(project.storage.archivedAt.toISOString(),project.storage.hpcVerifiedAbsentAt.toISOString());
  assert.deepEqual(plain(stripConfirmation(project)),plain(stripConfirmation(before)),'Unexpected Project field changed');
  assert.deepEqual(plain(value.database),plain(beforeDatabase),'Associated source records changed');
  const locations=await projectStorageLocations(project,{datastoreRoot:ROOT,readsRoot:'/tsl/data/reads'});
  assert.equal(locations.hpc.status,'absent');assert.equal(locations.aws.status,'verified');assert.equal(locations.hpc.uri,reviewed.hpcPath);assert.equal(locations.aws.uri,reviewed.s3Uri);
  return {...value,locations};
}
async function main() {
  assert.equal(process.argv.length,5);assert.equal(process.argv[2],'--execute-audited-deletion');assert.equal(process.argv[3],'--job-audit-sha256');assert.match(process.argv[4],/^[a-f0-9]{64}$/);
  assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'deeks');process.umask(0o077);startedAt=new Date().toISOString();
  const rawPlan=read(PACKAGE+'/deletion-plan.json');assert.equal(sha(rawPlan),PLAN_SHA);plan=JSON.parse(rawPlan);validatePlan(plan);
  const codeReviewBytes=read(REVIEW+'/api-change-review.json');assert.equal(sha(codeReviewBytes),CODE_REVIEW_SHA);validateCodeReview(JSON.parse(codeReviewBytes));
  const auditBytes=read(RESULTS+'/job-'+JOB+'-audit.json');assert.equal(sha(auditBytes),process.argv[4]);const audit=JSON.parse(auditBytes);validateJobAudit(audit,plan);
  for(const input of audit.inputs){const bytes=read((input.name==='deletion-plan.json'?PACKAGE:RESULTS)+'/'+input.name);assert.equal(bytes.length,input.bytes);assert.equal(sha(bytes),input.sha256);}
  const copyBytes=read(PACKAGE+'/destination-check.json');assert.equal(sha(copyBytes),COPY_SHA);copies=JSON.parse(copyBytes);assert(copies.success&&copies.files===40&&copies.sha256Verified===40&&copies.md5Verified===31&&copies.graph.unchangedSincePostMd5);
  const common=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');api=common.api;createAws=common.createAws;cli=require(api+'/lib/s3-archive/cli');
  ({collectProjectDatabase,collectHardBlockers}=require(api+'/lib/s3-archive/preflight'));({resolveHpcPreservation}=require(api+'/lib/hpc-preservation'));({projectStorageLocations}=require(api+'/lib/project-storage-locations'));
  const BSON=require(api+'/node_modules/bson');bson=new BSON();
  pack='/storage/komondor-gulnara-source-confirm-r2-'+startedAt.replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');fs.mkdirSync(pack,{mode:0o700});
  console.log(JSON.stringify({event:'started',at:startedAt,serverEvidence:pack,projects:4,jobId:JOB}));
  saveBytes('confirm-sources-r2.cjs',read(__filename));saveBytes('api-change-review.json',codeReviewBytes);saveBytes('deletion-plan.json',rawPlan);saveBytes('job-'+JOB+'-audit.json',auditBytes);saveBytes('destination-check.json',copyBytes);
  for(const input of audit.inputs)if(input.name!=='deletion-plan.json')saveBytes(input.name,read(RESULTS+'/'+input.name));
  c=await common.connect();assert.equal(c.toolVersion,CONFIRM_HEAD);assert.equal(c.config.datastoreRoot,ROOT);
  const user=await c.models.User.findOne({username:'deeks'}).lean();assert(user&&user.name==='George Deeks');
  save('initial-observations.json',observe());prepareGraph();save('destination-graph-before.json',{at:new Date().toISOString(),collections:await checkGraph()});
  const protectedBefore=await protectedSnapshot();
  assert.deepEqual(plain(protectedBefore),plain(JSON.parse(read(REVIEW+'/protected-after.json'))),'Protected Projects changed since source review');save('protected-before.json',protectedBefore);
  const baseline=[];
  for(const reviewed of plan.projects) {
    const value=await snapshot(reviewed.projectId);identity(value.project,reviewed);assert.deepEqual(collectHardBlockers(value.database),[]);
    assert.deepEqual(plain(value),JSON.parse(read(REVIEW+'/'+reviewed.projectId+'-before.json')),'Source Project or associated records changed since review');
    const item={reviewed,...value};baseline.push(item);save(reviewed.projectId+'-before.json',item);localControls(reviewed);
  }
  assert.equal(baseline.length,4);save('all-before-snapshots-passed.json',{at:new Date().toISOString(),projects:4,observations:observe()});
  for(const item of baseline){observe();await native(item.reviewed,item.project,false);}
  await checkGraph();assert.deepEqual(plain(await protectedSnapshot()),plain(protectedBefore));
  save('all-dry-runs-passed.json',{at:new Date().toISOString(),projects:4,observations:observe()});
  for(const item of baseline) {
    const now=await snapshot(item.reviewed.projectId);identity(now.project,item.reviewed);assert.deepEqual(plain(now),plain({project:item.project,database:item.database}));assert.deepEqual(collectHardBlockers(now.database),[]);
    await checkGraph();assert.deepEqual(plain(await protectedSnapshot()),plain(protectedBefore));observe();
    assert.equal(cp.execFileSync('git',['-C',api,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),CONFIRM_HEAD);
    await native(item.reviewed,now.project,true);confirmed.push(item.reviewed.projectId);
    save(item.reviewed.projectId+'-after.json',{at:new Date().toISOString(),...await snapshot(item.reviewed.projectId)});
    const after=await checkAfter(item);await checkGraph();observe();
    const result={at:new Date().toISOString(),projectId:item.reviewed.projectId,state:after.project.storage.state,phase:after.project.archiveMigration.phase,storage:after.project.storage,locations:after.locations,associatedRecordsUnchanged:true,s3VerifiedAtUnchanged:true,onlyNativeConfirmationFieldsChanged:true};
    completed.push(result);save(item.reviewed.projectId+'-completed.json',result);
  }
  for(const item of baseline)await checkAfter(item);
  save('destination-graph-after.json',{at:new Date().toISOString(),collections:await checkGraph()});
  const protectedAfter=await protectedSnapshot();assert.deepEqual(plain(protectedAfter),plain(protectedBefore));save('protected-after.json',protectedAfter);
  assert.equal(confirmed.length,4);assert.equal(completed.length,4);save('commands.json',commands);
  const result={at:new Date().toISOString(),success:true,projects:4,confirmed:4,verified:4,jobId:JOB,jobAuditSha256:process.argv[4],planSha256:PLAN_SHA,reviewApiHead:plan.apiHead,apiHead:c.toolVersion,codeReviewSha256:CODE_REVIEW_SHA,final:completed,observations:observe(),destinationGraphUnchanged:true,sourceAssociationsUnchanged:true,gargyPreserved:true,destinationAndStagingPreserved:true,s3VerifiedAtUnchanged:true,payloadDeletionsByThisScript:0,s3Mutations:0,serverEvidence:pack};
  save('completed.json',result);console.log(JSON.stringify({success:true,at:result.at,confirmed:4,serverEvidence:pack}));
}
if(require.main===module)main().catch(error=>{
  if(pack)try{save('failure.json',{at:new Date().toISOString(),error:error.stack,confirmedProjects:confirmed,verifiedProjects:completed.map(p=>p.projectId),commands,continuationRequiresInspection:true,serverEvidence:pack});}catch(e){console.error(e.stack);}
  console.error(error.stack);process.exitCode=1;
}).finally(async()=>{if(c)await c.mongoose.disconnect();});
module.exports={validatePlan,validateJobAudit,validateCodeReview,stripConfirmation,TARGETS,HELD,PLAN_SHA,REVIEW_HEAD,CONFIRM_HEAD,CODE_REVIEW_SHA};
