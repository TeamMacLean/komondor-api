'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {parseFlags,assertPidExited,validateJournal,assertRecoveryState,inspectStaleLock}=require('./runner.cjs');
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
