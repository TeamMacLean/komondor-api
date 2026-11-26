'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {archivePriorWindow}=require('./retry-window-r2.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=x=>Buffer.from(JSON.stringify(x)+'\n');
const HISTORY='retry-history/attempt-01';
function fixture(){
 const files=new Map(),renames=[];const put=(n,x)=>files.set(n,bytes(x));
 const original={version:1,operationId:'gulnara-retry-test',planSha256:'1'.repeat(64),preparedPlanSha256:'2'.repeat(64),copyReceiptSha256:'3'.repeat(64),
  apiHead:'a'.repeat(40),webHead:'b'.repeat(40),runnerFile:'runner.cjs',preparedPlanFile:'db-evidence/prepared-plan.json',copyReceiptFile:'copy-evidence/copy-verified.json',files:{}};
 for(const n of ['runner.cjs','exec/window.cjs','db-evidence/prepared-plan.json','copy-evidence/copy-verified.json']){put(n,{file:n});original.files[n]=hash(files.get(n));}
 original.preparedPlanSha256=original.files[original.preparedPlanFile];original.copyReceiptSha256=original.files[original.copyReceiptFile];put(HISTORY+'/execution-ready.json',original);
 const identity=Object.fromEntries(['operationId','planSha256','preparedPlanSha256','copyReceiptSha256'].map(k=>[k,original[k]]));
 const runId='previous-retry-run',controllerPid=12345;
 const proof={...identity,runId,state:'before',counts:{before:64,applied:0,reversed:0,diverged:0},differences:[],safeToReopen:true,mutationInProgress:false,copiesConsistent:true,journalSha256:hash(Buffer.alloc(0)),snapshotSha256:'9'.repeat(64),
  physical:{state:'staged',stagedFiles:40,publishedFiles:0,claimedRoots:0,privateRoots:0,files:40,bytes:41432635417,copiesConsistent:true}};
 const receipts={'before.json':{...identity,runId,controllerPid},'failed.json':{...identity,runId,controllerPid,error:'API listener remains reachable after stopping'},
  'restored.json':{...identity,runId,controllerPid,apiReady:true,graphState:'before',consistency:proof,
   services:['komondor-api','komondor-nudge','komondor-power','komondor-web'].map((name,i)=>({name,status:'online',pid:i+50}))}};
 for(const[n,r]of Object.entries(receipts)){put('window/'+n,r);put(HISTORY+'/window/'+n,r);}
 put(HISTORY+'/retry-precheck.json',{kind:'safe-pre-pause-window-retry',operationId:original.operationId,previousReadySha256:hash(files.get(HISTORY+'/execution-ready.json')),previousRunId:runId,previousControllerPid:controllerPid,previousControllerExited:true,runtimeUnchanged:true,databaseWrites:0,probe:proof});
 const ready={...original,files:{...original.files},controllerFile:'exec/window-r2.cjs',retryOf:{readySha256:hash(files.get(HISTORY+'/execution-ready.json')),runId,evidenceRoot:HISTORY}};
 for(const n of ['retry-window-r2.cjs','exec/window-r2.cjs','exec/listener-probe.cjs'])put(n,{file:n});
 for(const[n,b]of files)if(!n.startsWith('window/'))ready.files[n]=hash(b);
 const dirs=new Set(['window',HISTORY,HISTORY+'/window']);
 const deps={readBytes:n=>{assert(files.has(n),'Missing fixture file '+n);return files.get(n);},exists:n=>files.has(n)||dirs.has(n),
  names:n=>[...files.keys()].filter(k=>k.startsWith(n+'/')).map(k=>k.slice(n.length+1)),assertDirectory:n=>assert(dirs.has(n)),pidExited:pid=>assert.equal(pid,controllerPid),
  rename:(from,to)=>{assert(!dirs.has(to));renames.push({from,to});dirs.delete(from);dirs.add(to);for(const[n,b]of [...files])if(n.startsWith(from+'/')){files.set(to+n.slice(from.length),b);files.delete(n);}}};
 return {ready,deps,files,dirs,renames,put,receipts};
}
test('launcher archives exact reviewed receipts and preserves the sealed copies',()=>{
 const f=fixture(),r=archivePriorWindow(f.ready,f.deps);assert.equal(r.archivedTo,HISTORY+'/original-window');assert.equal(f.renames.length,1);assert(!f.dirs.has('window'));
 for(const n of Object.keys(f.receipts))assert(f.files.get(HISTORY+'/original-window/'+n).equals(f.files.get(HISTORY+'/window/'+n)));
});
test('changed original receipt, extra receipt or occupied destination refuses any rename',()=>{
 for(const change of [f=>f.put('window/before.json',{changed:true}),f=>f.put('window/paused.json',{}),f=>f.dirs.add(HISTORY+'/original-window')]){
  const f=fixture();change(f);assert.throws(()=>archivePriorWindow(f.ready,f.deps));assert.equal(f.renames.length,0);
 }
});
test('changed sealed input or omitted original seal entry refuses any rename',()=>{
 for(const change of [f=>f.put('exec/listener-probe.cjs',{changed:true}),f=>{delete f.ready.files['runner.cjs'];},f=>{delete f.ready.files['retry-window-r2.cjs'];}]){
  const f=fixture();change(f);assert.throws(()=>archivePriorWindow(f.ready,f.deps));assert.equal(f.renames.length,0);
 }
});
test('any active or already-mutated operation state refuses archival',()=>{
 for(const n of ['mutation.lock','window-reopen.lock','copy-worker.lock','recovery-prepare.lock','db-evidence/active.lock','active-recovery.json','window-complete.json','db-evidence/execution.json','db-evidence/journal.jsonl']){
  const f=fixture();f.put(n,{});assert.throws(()=>archivePriorWindow(f.ready,f.deps));assert.equal(f.renames.length,0);
 }
});
test('live or uninspectable prior controller refuses archival',()=>{
 const f=fixture();f.deps.pidExited=()=>{throw Error('alive or EPERM');};assert.throws(()=>archivePriorWindow(f.ready,f.deps),/alive/);assert.equal(f.renames.length,0);
});
test('launcher requires exact before graph, staged copies, original failure and same heads',()=>{
 for(const mutate of [r=>{r.consistency.counts.before=63;},r=>{r.consistency.physical.stagedFiles=39;},r=>{r.consistency.mutationInProgress=true;},r=>{r.apiReady=false;}]){
  const f=fixture(),r=f.receipts['restored.json'];mutate(r);f.put('window/restored.json',r);f.put(HISTORY+'/window/restored.json',r);f.ready.files[HISTORY+'/window/restored.json']=hash(f.files.get(HISTORY+'/window/restored.json'));
  assert.throws(()=>archivePriorWindow(f.ready,f.deps));assert.equal(f.renames.length,0);
 }
 const f=fixture();f.ready.webHead='c'.repeat(40);assert.throws(()=>archivePriorWindow(f.ready,f.deps),/identity\/head/);assert.equal(f.renames.length,0);
});
