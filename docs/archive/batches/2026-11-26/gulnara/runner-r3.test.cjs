'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {parseFlags,assertPidExited,validateJournal,assertRecoveryState,inspectStaleLock,assertPredecessor,assertPublicationProof}=require('./runner-r3.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const operationId='fixture-operation';
function journal(events){let previous=sha(Buffer.from(operationId));return Buffer.from(events.map((event,sequence)=>{const body={sequence,previous,at:'2026-11-26T12:00:00.000Z',operationId,...event};const sha256=sha(JSON.stringify(body,null,2)+'\n');previous=sha256;return JSON.stringify({...body,sha256})+'\n';}).join(''));}
function state(before,applied,reversed=0){return {state:before===64?'before':applied===64?'applied':applied===0&&reversed?'reversed':'partial',counts:{before,applied,reversed,diverged:0},differences:[]};}
test('CLI requires explicit reviewed flags, rejects duplicate and unknown values',()=>{
 assert.deepEqual(parseFlags(['--action','resume','--mutation-lock-sha256','abc'],['--action','--mutation-lock-sha256']),{'--action':'resume','--mutation-lock-sha256':'abc'});
 assert.throws(()=>parseFlags(['--action','resume','--action','rollback'],['--action']),/Duplicate/);
 assert.throws(()=>parseFlags(['--unknown','x'],[]),/Unexpected/);assert.throws(()=>parseFlags([],['--action']),/Missing/);assert.throws(()=>parseFlags(['--action'],['--action']));
});
test('process absence requires ESRCH; live and inaccessible processes fail closed',()=>{
 assertPidExited(null);assertPidExited(100,()=>{const e=new Error();e.code='ESRCH';throw e;});
 assert.throws(()=>assertPidExited(100,()=>{}),/alive/);assert.throws(()=>assertPidExited(100,()=>{const e=new Error('denied');e.code='EPERM';throw e;}),/denied/);assert.throws(()=>assertPidExited(undefined));
});
test('journal proof binds the full ordered hash chain and operation',()=>{
 const bytes=journal([{event:'apply-intent',id:'1'},{event:'apply-verified',id:'1'}]);assert.equal(validateJournal(bytes,operationId),sha(bytes));assert.equal(validateJournal(Buffer.alloc(0),operationId),sha(Buffer.alloc(0)));
 assert.throws(()=>validateJournal(bytes.subarray(0,-1),operationId),/Incomplete/);assert.throws(()=>validateJournal(Buffer.from(bytes.toString().replace('apply-verified','apply-skipped')),operationId),/chain/);assert.throws(()=>validateJournal(bytes,'another-operation'));
 const lines=bytes.toString().trimEnd().split('\n');assert.throws(()=>validateJournal(Buffer.from(lines.reverse().join('\n')+'\n'),operationId));
});
test('forward recovery accepts only exact 64-document before/partial/applied states',()=>{
 for(const value of [state(64,0),state(59,5),state(0,64)])assertRecoveryState(value,'resume');
 assert.throws(()=>assertRecoveryState(state(50,7,7),'resume'),/reversals/);assert.throws(()=>assertRecoveryState(state(0,0,64),'resume'));
 const divergent=state(59,5);divergent.differences=[{kind:'control-document-changed'}];assert.throws(()=>assertRecoveryState(divergent,'resume'),/closure/);
 assert.throws(()=>assertRecoveryState(state(63,0),'resume'));const wrong=state(59,5);wrong.state='before';assert.throws(()=>assertRecoveryState(wrong,'resume'));
});
test('rollback recovery can resume a mixed applied/reversed graph and terminal reversal',()=>{
 for(const value of [state(64,0),state(59,5),state(20,30,14),state(59,0,5),state(0,0,64)])assertRecoveryState(value,'rollback');
 const divergent=state(63,0);divergent.counts.diverged=1;divergent.state='diverged';assert.throws(()=>assertRecoveryState(divergent,'rollback'));
});
test('stale locks need exact digest, exact owner and a dead PID; inspection does not mutate evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gulnara-runner-lock-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const child=cp.spawnSync(process.execPath,['-e','process.exit(0)']);assert(child.pid>1);assert.equal(child.status,0);
 const owner={operationId,pid:child.pid,command:'apply'},bytes=Buffer.from(JSON.stringify(owner)+'\n');fs.mkdirSync(path.join(root,'mutation.lock'));fs.writeFileSync(path.join(root,'mutation.lock','owner.json'),bytes);
 const before=fs.readFileSync(path.join(root,'mutation.lock','owner.json'));const result=inspectStaleLock(root,'mutation.lock',sha(bytes),operationId);assert.equal(result.pid,child.pid);assert.deepEqual(fs.readFileSync(path.join(root,'mutation.lock','owner.json')),before);
 assert.throws(()=>inspectStaleLock(root,'mutation.lock','absent',operationId),/Unexpected/);assert.throws(()=>inspectStaleLock(root,'mutation.lock','a'.repeat(64),operationId),/differs/);assert.throws(()=>inspectStaleLock(root,'mutation.lock',sha(bytes),'foreign-operation'));
 assert.equal(inspectStaleLock(root,'missing.lock','absent',operationId),null);assert.throws(()=>inspectStaleLock(root,'missing.lock',sha(bytes),operationId),/missing/);
 fs.writeFileSync(path.join(root,'mutation.lock','extra'),'?');assert.throws(()=>inspectStaleLock(root,'mutation.lock',sha(bytes),operationId),/contents/);fs.unlinkSync(path.join(root,'mutation.lock','extra'));
 const live=Buffer.from(JSON.stringify({...owner,pid:process.pid})+'\n');fs.writeFileSync(path.join(root,'mutation.lock','owner.json'),live);assert.throws(()=>inspectStaleLock(root,'mutation.lock',sha(live),operationId),/alive/);
 fs.unlinkSync(path.join(root,'mutation.lock','owner.json'));fs.symlinkSync(path.join(root,'elsewhere'),path.join(root,'mutation.lock','owner.json'));assert.throws(()=>inspectStaleLock(root,'mutation.lock',sha(bytes),operationId));
});
function predecessorFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gulnara-r3-predecessor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'window'));fs.mkdirSync(path.join(root,'db-evidence'));
 const planSha256='a'.repeat(64),copyReceiptSha256='b'.repeat(64),preparedPlanSha256='c'.repeat(64),runId='old-window-run';
 const consistency={operationId,runId,planSha256,copyReceiptSha256,preparedPlanSha256,state:'before',counts:{before:64,applied:0,reversed:0,diverged:0},differences:[],safeToReopen:true,mutationInProgress:false,copiesConsistent:true,journalSha256:sha(Buffer.alloc(0)),physical:{state:'staged',files:40,stagedFiles:40,publishedFiles:0,claimedRoots:0,privateRoots:0,copiesConsistent:true}};
 const restored={operationId,runId,planSha256,copyReceiptSha256,preparedPlanSha256,controllerPid:424242,apiReady:true,graphState:'before',consistency,services:['komondor-api','komondor-web','komondor-power','komondor-nudge'].map(name=>({name,status:'online'}))};
 const bytes=Buffer.from(JSON.stringify(restored)+'\n');fs.writeFileSync(path.join(root,'window/restored.json'),bytes);fs.writeFileSync(path.join(root,'window-complete.json'),JSON.stringify({operationId,runId,planSha256,preparedPlanSha256,state:'before'}));
 const config={operationId,planSha256,predecessor:{pack:root,restoredFile:'window/restored.json',restoredSha256:sha(bytes),mutatorPid:424243}};
 const deps={root,checkProcesses:r=>assert.equal(r,root),kill:()=>{const e=new Error();e.code='ESRCH';throw e;}};
 return {root,restored,config,copyReceiptSha256,deps,verify:()=>assertPredecessor(config,copyReceiptSha256,deps)};
}
test('r3 predecessor accepts only pinned restored-before evidence and matching completion',t=>{
 const f=predecessorFixture(t);assert.equal(f.verify().verified,true);
 fs.writeFileSync(path.join(f.root,'window-complete.json'),JSON.stringify({operationId,runId:'different-window',planSha256:f.config.planSha256,preparedPlanSha256:'c'.repeat(64),state:'before'}));assert.throws(f.verify);
});
test('r3 predecessor rejects renewed old activity and any old database execution',t=>{
 const f=predecessorFixture(t);
 for(const filename of ['mutation.lock','window-reopen.lock','recovery-prepare.lock','active-recovery.json','copy-worker.lock','retry-window-r2.lock','db-evidence/active.lock','db-evidence/execution.json','db-evidence/journal.jsonl','db-evidence/rollback-plan.json']){
  const target=path.join(f.root,filename);fs.writeFileSync(target,'');assert.throws(f.verify,/active or changed/);fs.unlinkSync(target);
 }
 assert.equal(f.verify().verified,true);
});
test('r3 predecessor refuses changed evidence, live PIDs, unknown PID permission and process overlap',t=>{
 const f=predecessorFixture(t),target=path.join(f.root,'window/restored.json'),original=fs.readFileSync(target);fs.appendFileSync(target,' ');assert.throws(f.verify,/evidence changed/);fs.writeFileSync(target,original);
 assert.throws(()=>assertPredecessor(f.config,f.copyReceiptSha256,{...f.deps,kill:()=>{}}),/alive/);
 assert.throws(()=>assertPredecessor(f.config,f.copyReceiptSha256,{...f.deps,kill:()=>{const e=new Error('cannot inspect PID');e.code='EPERM';throw e;}}),/cannot inspect/);
 assert.throws(()=>assertPredecessor(f.config,f.copyReceiptSha256,{...f.deps,checkProcesses:()=>{throw new Error('old worker active');}}),/old worker/);
});
test('r3 predecessor must describe all 64 before and all 40 unlinked staged files',t=>{
 const f=predecessorFixture(t);f.restored.consistency.physical.publishedFiles=1;const bytes=Buffer.from(JSON.stringify(f.restored)+'\n');fs.writeFileSync(path.join(f.root,'window/restored.json'),bytes);f.config.predecessor.restoredSha256=sha(bytes);assert.throws(f.verify);
});
function physical(publishedFiles,claimedRoots=publishedFiles?12:0){return {copiesConsistent:true,privateRoots:0,retainedStageFiles:40,files:40,bytes:41432635417,publishedFiles,stagedFiles:40-publishedFiles,claimedRoots,state:publishedFiles===0?'staged':publishedFiles===40?'published':'partly-published'};}
test('r3 before graph admits inspected partial links while always retaining all staged copies',()=>{
 for(const n of [0,1,19,40])assertPublicationProof(physical(n),'before');
 assertPublicationProof(physical(0),'before',{untouchedStage:true});
 assert.throws(()=>assertPublicationProof(physical(1),'before',{untouchedStage:true}));assert.throws(()=>assertPublicationProof(physical(0,1),'before',{untouchedStage:true}));
 const missing=physical(17);missing.retainedStageFiles=39;assert.throws(()=>assertPublicationProof(missing,'before'));const privateRoot=physical(1);privateRoot.privateRoots=1;assert.throws(()=>assertPublicationProof(privateRoot,'before'));
});
test('r3 changed graph requires all forty published links with consistent progress counts',()=>{
 for(const state of ['partial','applied','reversed']){assertPublicationProof(physical(40),state);assert.throws(()=>assertPublicationProof(physical(39),state),/fully published/);}
 const inconsistent=physical(40);inconsistent.stagedFiles=1;assert.throws(()=>assertPublicationProof(inconsistent,'applied'));
 const falseState=physical(20);falseState.state='published';assert.throws(()=>assertPublicationProof(falseState,'before'));
});
