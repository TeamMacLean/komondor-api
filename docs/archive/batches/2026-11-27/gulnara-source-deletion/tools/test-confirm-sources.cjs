'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validatePlan,validateJobAudit,stripConfirmation,PLAN_SHA}=require('./confirm-sources.cjs');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../komondor-gulnara-source-delete-20261127-01/deletion-plan.json')));
const clone=x=>JSON.parse(JSON.stringify(x));
function audit(){return {
  kind:'gulnara-source-deletion-job-audit-v1',success:true,jobId:'25340876',planSha256:PLAN_SHA,issues:[],
  projects:4,files:452,bytes:482738413472,
  exactTargets:fixture.projects.map(p=>({projectId:p.projectId,hpcPath:p.hpcPath,files:p.fileCount,bytes:p.bytes})),
  events:{started:1,preflightPassed:4,deletionStarted:4,deleted:4,complete:1,total:14},
  protectedCopiesIntact:true,databaseConfirmationRequired:true,execute:true,allEventsWithinReview:true,
  processExitCode:0,slurmStatus:{source:'user-reported',state:'COMPLETED',exitCode:'0:0'},
  inputs:['deletion-plan.json','deletion-25340876.jsonl','komondor-gulnara-4-25340876.log'].map(name=>({name,sha256:'a'.repeat(64),bytes:10})),
  startedAt:'2026-11-27T14:24:34Z',completedAt:'2026-11-27T14:25:04Z',
};}
test('reviewed exact four plan and complete audit are accepted',()=>{validatePlan(fixture);validateJobAudit(audit(),fixture);});
test('different or extra target rejected',()=>{for(const edit of [p=>p.projects[0].projectId='foreign',p=>p.projects.push(clone(p.projects[0])),p=>p.projects[0].hpcPath='/tsl/data/reads/ntalbot']){const p=clone(fixture);edit(p);assert.throws(()=>validatePlan(p));}});
test('protected roots and held project identities cannot change',()=>{for(const edit of [p=>p.protectedRoots.pop(),p=>p.held[0].relativeRoot='two_blades/other']){const p=clone(fixture);edit(p);assert.throws(()=>validatePlan(p));}});
test('job ID, plan binding, totals and target paths are mandatory',()=>{for(const edit of [a=>a.jobId='25340024',a=>a.planSha256='b'.repeat(64),a=>a.files=451,a=>a.bytes--,a=>a.exactTargets[0].hpcPath+='/extra']){const a=audit();edit(a);assert.throws(()=>validateJobAudit(a,fixture));}});
test('partial deletion, failed process and missing protected-copy proof rejected',()=>{for(const edit of [a=>a.events.deleted=3,a=>a.events.complete=0,a=>a.processExitCode=1,a=>a.protectedCopiesIntact=false,a=>a.execute=false,a=>a.success=false,a=>a.issues.push('problem')]){const a=audit();edit(a);assert.throws(()=>validateJobAudit(a,fixture));}});
test('all three exact raw input names required',()=>{for(const edit of [a=>a.inputs.pop(),a=>a.inputs[0].name='../deletion-plan.json',a=>a.inputs[1].sha256='invalid',a=>a.inputs[1].bytes=0]){const a=audit();edit(a);assert.throws(()=>validateJobAudit(a,fixture));}});
test('deletion after expiry or before reviewed window rejected',()=>{for(const edit of [a=>a.completedAt='2026-11-27T20:13:24Z',a=>a.startedAt='2026-11-27T14:13:22Z',a=>a.completedAt='invalid',a=>a.completedAt='2026-11-27T14:23:00Z']){const a=audit();edit(a);assert.throws(()=>validateJobAudit(a,fixture));}});
test('unverified scheduler success is never silently relabelled',()=>{const a=audit();validateJobAudit(a,fixture);assert.equal(a.slurmStatus.source,'user-reported');});
test('normalization only removes native confirmation fields, preserving AWS identity/dates/hold',()=>{
 const p={name:'source',updatedAt:new Date(),preserveOnHpcUntil:null,storage:{state:'aws',hpcVerifiedAbsentAt:new Date(),archivedAt:new Date(),s3Uri:'s3://bucket/path',s3VerifiedAt:new Date('2026-10-27')},archiveMigration:{id:'id',phase:'completed',confirmedAbsentBy:'deeks',updatedAt:new Date(),manifests:{sourceSha256:'x'}}};
 const before=JSON.stringify(p),value=stripConfirmation(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(Object.keys(value.storage).sort(),['s3Uri','s3VerifiedAt']);assert.deepEqual(Object.keys(value.archiveMigration).sort(),['id','manifests']);assert.equal(value.preserveOnHpcUntil,null);assert.equal(value.name,'source');
});
