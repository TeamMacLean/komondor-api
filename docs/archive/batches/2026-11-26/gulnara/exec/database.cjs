'use strict';
// Scoped administrative correction. No model hooks, inserts, deletes, storage
// transitions, filesystem payload operations, service control or S3 calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {collectDatabase} = require('../db-preflight.cjs');
const TARGET = '6ae4ac89a6b876c643741d27';
const IDENTITY = ['path','name','safeName','owner','group','project','sample','run','file','originalName'];
const TYPED = {promoteValues:false,promoteLongs:false,promoteBuffers:false};
const id = x => String(x?._id || x);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const json = x => Buffer.from(JSON.stringify(x,null,2)+'\n');
const escape = x => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plain = x => x && Object.getPrototypeOf(x) === Object.prototype;
function ordered(x) {
  if(Array.isArray(x)) return x.map(ordered);
  if(plain(x)) return Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])]));
  return x;
}
function safeDirectory(directory) {
  const resolved=path.resolve(directory);
  assert(resolved===directory && resolved.length>10, 'Absolute evidence directory required');
  assert(!resolved.startsWith('/mnt/reads/') && !resolved.startsWith('/tsl/data/reads/'), 'Evidence must be outside datastore');
  let here=path.parse(resolved).root;
  for(const component of resolved.slice(here.length).split(path.sep)) {
    here=path.join(here,component);
    if(!fs.existsSync(here)) fs.mkdirSync(here,{mode:0o700});
    assert(fs.lstatSync(here).isDirectory()&&!fs.lstatSync(here).isSymbolicLink(),'Unsafe evidence directory');
  }
  return resolved;
}
function readFile(filename) {
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {assert(fs.fstatSync(fd).isFile(),'Evidence must be a regular file');return fs.readFileSync(fd);}
  finally {fs.closeSync(fd);}
}
function writeOnce(filename,value) {
  const bytes=Buffer.isBuffer(value)?value:json(value);
  const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o640);
  try {fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY);
  try {fs.fsyncSync(parent);} finally {fs.closeSync(parent);}
  return hash(bytes);
}

function createExecutor({db,ObjectId,bson,workDir,scope,reviewPlan,actor,toolVersion,operationId,
  reviewedPlanSha256,expectedCopyReceiptSha256,validateWindow,afterWrite}) {
  assert(db&&ObjectId&&bson&&typeof bson.serialize==='function'&&typeof bson.deserialize==='function');
  assert.equal(typeof validateWindow,'function','Live window validation callback is mandatory');
  assert(actor&&toolVersion&&/^[A-Za-z0-9_-]{8,100}$/.test(operationId),'Explicit execution identity required');
  for(const value of [reviewedPlanSha256,expectedCopyReceiptSha256]) assert(/^[a-f0-9]{64}$/.test(value),'Sealed evidence SHA required');
  assert.equal(scope.targetProject._id,TARGET);
  assert.equal(reviewPlan.destinationProjectId,TARGET);
  assert.equal(scope.matches.length,12);assert.equal(scope.sourceProjects.length,4);
  assert.equal(reviewPlan.operations.length,64);assert.equal(reviewPlan.count,64);
  const sourceIds=new Set(scope.sourceProjects.map(p=>p._id));
  assert.equal(sourceIds.size,4);
  const expectedIds={samples:new Set(scope.matches.map(m=>m.sample._id)),runs:new Set(scope.matches.flatMap(m=>m.runs.map(r=>r._id))),files:new Set()};
  for(const op of reviewPlan.operations) if(op.collection==='files') expectedIds.files.add(op.id);
  assert.equal(expectedIds.files.size,40);
  const seen=new Set();
  for(const op of reviewPlan.operations) {
    assert(expectedIds[op.collection]?.has(op.id),'Out-of-scope document');
    assert(!seen.has(op.collection+':'+op.id),'Duplicate operation');seen.add(op.collection+':'+op.id);
    assert.deepEqual(Object.keys(op.businessChanges).sort(),op.collection==='samples'?['path','project']:['path']);
    const p=op.businessChanges.path;
    assert.equal(typeof p.before,'string');assert.equal(typeof p.after,'string');
    assert(p.after.replace(/^\//,'').startsWith(scope.targetProject.path.replace(/^\//,'')+'/'),'Destination path outside target');
    const matched=scope.matches.find(m=>p.before.replace(/^\//,'')===m.sample.path.replace(/^\//,'')||p.before.replace(/^\//,'').startsWith(m.sample.path.replace(/^\//,'')+'/'));
    assert(matched,'Source path outside selected sample trees');
    const expected=p.before.replace(matched.sample.path.replace(/^\//,''),scope.targetProject.path.replace(/^\//,'')+'/'+matched.sample.safeName);
    assert.equal(p.after,expected,'Unreviewed relative path change');
    if(op.collection==='samples') {assert.equal(op.businessChanges.project.before,matched.sample.project);assert.equal(op.businessChanges.project.after,TARGET);}
  }
  const pack=d=>bson.serialize(d).toString('base64');
  const unpack=s=>bson.deserialize(Buffer.from(s,'base64'),TYPED);
  const clone=d=>unpack(pack(d));
  const equal=(a,b)=>a!=null&&b!=null&&bson.serialize(ordered(a)).equals(bson.serialize(ordered(b)));
  const directory=path.resolve(workDir), planFile=path.join(directory,'prepared-plan.json'), executionFile=path.join(directory,'execution.json'), reversalFile=path.join(directory,'rollback-plan.json');
  const journalFile=path.join(directory,'journal.jsonl'), lockDir=path.join(directory,'active.lock');
  const find=(collection,filter)=>db.collection(collection).find(filter,TYPED).sort({_id:1}).maxTimeMS(30000).toArray();
  const findOne=(collection,oid)=>db.collection(collection).findOne({_id:new ObjectId(oid)},TYPED);
  const roots=[...scope.sourceProjects,scope.targetProject].map(p=>p.path);
  const pathFilter={$or:roots.map(root=>({path:new RegExp('^/?'+escape(root.replace(/^\//,''))+'(?:/|$)')}))};
  const objectIds=values=>values.map(x=>new ObjectId(id(x)));
  const projectIds=objectIds([...sourceIds,TARGET]);
  async function snapshot() {
    const data={};
    data.projects=await find('projects',{$or:[{_id:{$in:projectIds}},pathFilter]});
    data.samples=await find('samples',{$or:[{project:{$in:projectIds}},{_id:{$in:objectIds([...expectedIds.samples])}},pathFilter]});
    data.runs=await find('runs',{$or:[{sample:{$in:data.samples.map(x=>x._id)}},{_id:{$in:objectIds([...expectedIds.runs])}},pathFilter]});
    const runs=data.runs.map(x=>x._id),samples=data.samples.map(x=>x._id);
    data.reads=await find('reads',{run:{$in:runs}});
    data.additionalfiles=await find('additionalfiles',{$or:[{project:{$in:projectIds}},{sample:{$in:samples}},{run:{$in:runs}}]});
    const linked=[...data.reads,...data.additionalfiles].filter(x=>x.file).map(x=>x.file);
    data.files=await find('files',{$or:[{_id:{$in:[...linked,...objectIds([...expectedIds.files])]}},pathFilter]});
    const fileIds=data.files.map(x=>x._id);
    // Include inbound references outside the source/destination graph.
    data.reads=await find('reads',{$or:[{run:{$in:runs}},{file:{$in:fileIds}}]});
    data.additionalfiles=await find('additionalfiles',{$or:[{project:{$in:projectIds}},{sample:{$in:samples}},{run:{$in:runs}},{file:{$in:fileIds}}]});
    data.ingestjobs=await find('ingestjobs',{runId:{$in:runs}});
    data.newsitems=await find('newsitems',{typeId:{$in:[...projectIds,...samples,...runs]}});
    return Object.fromEntries(Object.entries(data).map(([name,docs])=>[name,docs.map(doc=>({id:id(doc._id),bson:pack(doc)}))]));
  }
  const snapshotDigest=s=>hash(json(Object.fromEntries(Object.entries(s).map(([name,rows])=>[name,rows.map(r=>({id:r.id,sha256:hash(bson.serialize(ordered(unpack(r.bson))))}))]))));
  async function gate(phase,extra={}) {
    await validateWindow({phase,operationId,reviewedPlanSha256,copyReceiptSha256:expectedCopyReceiptSha256,...extra});
  }
  function load(expectedPlanSha256) {
    const bytes=readFile(planFile),digest=hash(bytes),plan=JSON.parse(bytes);
    assert.equal(digest,expectedPlanSha256,'Prepared plan digest differs');
    assert.equal(plan.kind,'gulnara-database-prepared-plan');assert.equal(plan.version,1);
    for(const [key,value] of Object.entries({operationId,actor,toolVersion,reviewedPlanSha256,copyReceiptSha256:expectedCopyReceiptSha256,database:db.databaseName,scopeSha256:hash(json(scope)),reviewTemplateSha256:hash(json(reviewPlan))})) assert.equal(plan[key],value,'Plan context differs: '+key);
    assert.equal(plan.operations.length,64);
    const execution=fs.existsSync(executionFile)?JSON.parse(readFile(executionFile)):null;
    const reversal=fs.existsSync(reversalFile)?JSON.parse(readFile(reversalFile)):null;
    for(const value of [execution,reversal].filter(Boolean)) {
      assert.equal(value.operationId,operationId);assert.equal(value.preparedPlanSha256,digest);
      assert.equal(value.operations.length,64);
    }
    if(execution) {
      assert.equal(execution.kind,'gulnara-database-execution');assert.equal(execution.version,1);
      const at=new Date(execution.startedAt);assert(Number.isFinite(+at));
      for(let i=0;i<64;i++) {
        const op=plan.operations[i],image=execution.operations[i];
        assert.equal(image.collection,op.collection);assert.equal(image.id,op.id);
        assert(equal(unpack(image.afterBson),materialize(plan,op,at,digest)),'Execution after-image differs from sealed plan');
      }
    }
    if(reversal) {
      assert(execution,'Rollback cannot predate execution');
      assert.equal(reversal.kind,'gulnara-database-rollback');assert.equal(reversal.version,1);
      const at=new Date(reversal.at);assert(Number.isFinite(+at));
      for(let i=0;i<64;i++) {
        const op=plan.operations[i],image=reversal.operations[i];
        assert.equal(image.collection,op.collection);assert.equal(image.id,op.id);
        assert(equal(unpack(image.reversedBson),reverseImage(op,unpack(execution.operations[i].afterBson),at,digest)),'Rollback after-image differs from sealed plan');
      }
    }
    return {plan,digest,execution,reversal};
  }
  function append(event) {
    let previous=hash(Buffer.from(operationId)),sequence=0;
    if(fs.existsSync(journalFile)) {
      const bytes=readFile(journalFile),str=bytes.toString('utf8');assert(str.endsWith('\n'),'Incomplete journal; inspect before continuation');
      for(const line of str.trimEnd().split('\n')) {
        const parsed=JSON.parse(line),{sha256,...body}=parsed;
        assert.equal(body.sequence,sequence);assert.equal(body.previous,previous);assert.equal(hash(json(body)),sha256,'Journal chain differs');
        previous=sha256;sequence++;
      }
    }
    const body={sequence,previous,at:new Date().toISOString(),operationId,...event};
    const fd=fs.openSync(journalFile,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|(fs.constants.O_NOFOLLOW||0),0o640);
    try {fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,JSON.stringify({...body,sha256:hash(json(body))})+'\n');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  }
  async function locked(action) {
    fs.mkdirSync(lockDir,{mode:0o700});
    writeOnce(path.join(lockDir,'owner.json'),{pid:process.pid,at:new Date().toISOString(),operationId});
    try {return await action();}
    finally {fs.unlinkSync(path.join(lockDir,'owner.json'));fs.rmdirSync(lockDir);}
  }
  async function prepare() {
    await gate('prepare');safeDirectory(directory);
    assert(!fs.existsSync(planFile),'Prepared evidence exists; inspect and use its digest');
    const preflight=await collectDatabase(db,scope,ObjectId);
    assert.equal(preflight.issues.length,0,'Fresh database preflight has issues');
    assert.deepEqual([preflight.summary.projects,preflight.summary.samples,preflight.summary.runs,preflight.summary.files,preflight.summary.reads,preflight.summary.selectedAdditionalFiles],[5,12,12,40,31,9]);
    assert.equal(preflight.notes.length,0,'Destination is no longer empty');
    const baseline=await snapshot(),operations=[];
    for(const op of reviewPlan.operations) {
      const row=baseline[op.collection].find(r=>r.id===op.id);assert(row,'Prepared record missing');
      const before=unpack(row.bson),set={};
      for(const [key,change] of Object.entries(op.businessChanges)) {
        assert.equal(id(before[key]),String(change.before),'Reviewed before value differs');
        set[key]=key==='project'?new ObjectId(change.after):change.after;
      }
      const merged={...before,...set};
      const identity=Object.fromEntries(IDENTITY.filter(k=>merged[k]!==undefined).map(k=>[k,merged[k]]));
      assert.deepEqual(Object.keys(identity).sort(),Object.keys(op.proposedIdentity).sort());
      for(const [key,value] of Object.entries(identity)) assert.equal(id(value),String(op.proposedIdentity[key]),'Reviewed identity differs: '+key);
      assert.equal((before.reconciliationHistory||[]).length,op.existingHistoryEntries,'Audit history changed');
      assert.equal(!!before.reconciliation?.identity,!!op.existingIdentity,'Pin presence changed');
      if(op.existingIdentity) for(const [key,value] of Object.entries(op.existingIdentity)) assert.equal(id(before.reconciliation.identity[key]),String(value),'Existing pin changed');
      operations.push({collection:op.collection,id:op.id,beforeBson:row.bson,setBson:pack(set),identityBson:pack(identity),operationId:operationId+':'+op.collection+':'+op.id});
    }
    const second=await snapshot();assert.equal(snapshotDigest(second),snapshotDigest(baseline),'Database changed while preparing');
    const plan={kind:'gulnara-database-prepared-plan',version:1,preparedAt:new Date().toISOString(),operationId,actor,toolVersion,reviewedPlanSha256,
      copyReceiptSha256:expectedCopyReceiptSha256,database:db.databaseName,scopeSha256:hash(json(scope)),reviewTemplateSha256:hash(json(reviewPlan)),
      operations,beforeSnapshot:baseline,beforeSnapshotSha256:snapshotDigest(baseline)};
    const digest=writeOnce(planFile,plan);
    writeOnce(path.join(directory,'prepare-receipt.json'),{at:new Date().toISOString(),operationId,reviewedPlanSha256,preparedPlanSha256:digest,operations:64,beforeSnapshotSha256:plan.beforeSnapshotSha256});
    return {preparedPlanSha256:digest,planSha256:digest,reviewedPlanSha256,operations:64,planFile};
  }
  function materialize(plan,op,at,digest) {
    const before=unpack(op.beforeBson),after=clone(before),set=unpack(op.setBson);
    Object.assign(after,set);
    after.reconciliation={...(before.reconciliation||{}),version:1,operationId:op.operationId,batchId:'gulnara-2026-11-26',
      identity:unpack(op.identityBson),planSha256:digest,reviewedPlanSha256,copyReceiptSha256:expectedCopyReceiptSha256};
    delete after.reconciliation.state;
    after.updatedAt=at;
    const changes=Object.fromEntries(Object.entries(set).map(([key,value])=>[key,{before:before[key],after:value}]));
    after.reconciliationHistory=[...(before.reconciliationHistory||[]),{version:1,operationId:op.operationId,batchId:'gulnara-2026-11-26',
      at,actor,kind:'administrative-reassignment',reason:'Gulnara ENA: independently verified sample copy into existing Xanthoria Project; preserve original archives.',
      decisionAuthority:'George explicitly authorized execution in the archive chat on 26 November 2026',beforeBsonSha256:hash(Buffer.from(op.beforeBson,'base64')),
      changes,previousOperationId:before.reconciliation?.operationId||null,planSha256:digest,reviewedPlanSha256,copyReceiptSha256:expectedCopyReceiptSha256,toolVersion}];
    return after;
  }
  function reverseImage(op,after,at,digest) {
    const before=unpack(op.beforeBson),reversed=clone(after);
    for(const key of Object.keys(unpack(op.setBson)))reversed[key]=before[key];
    const identity=Object.fromEntries(IDENTITY.filter(k=>before[k]!==undefined).map(k=>[k,before[k]]));
    reversed.reconciliation={...(before.reconciliation||after.reconciliation),version:1,operationId:op.operationId+':rollback',state:'reversed',identity,
      planSha256:digest,reviewedPlanSha256,copyReceiptSha256:expectedCopyReceiptSha256};
    reversed.updatedAt=at;
    reversed.reconciliationHistory=[...after.reconciliationHistory,{version:1,operationId:op.operationId+':rollback',at,actor,kind:'administrative-reassignment-reversal',
      reason:'Conditional recovery of Gulnara reassignment; retain both byte copies and append-only audit.',reversesOperationId:op.operationId,planSha256:digest,toolVersion}];
    return reversed;
  }
  async function assess(context,{ignoreOwnLock=false}={}) {
    const {plan,execution,reversal}=context,actual=await snapshot();
    const opMap=new Map(plan.operations.map(o=>[o.collection+':'+o.id,o]));
    const afterMap=new Map((execution?.operations||[]).map(o=>[o.collection+':'+o.id,o]));
    const reversedMap=new Map((reversal?.operations||[]).map(o=>[o.collection+':'+o.id,o]));
    const states=[],differences=[];
    for(const [collection,baseline] of Object.entries(plan.beforeSnapshot)) {
      const current=new Map(actual[collection].map(row=>[row.id,row]));
      const expectedIds=new Set(baseline.map(row=>row.id));
      for(const row of actual[collection]) if(!expectedIds.has(row.id)) differences.push({collection,id:row.id,kind:'inserted-into-closure'});
      for(const row of baseline) {
        const live=current.get(row.id),key=collection+':'+row.id,op=opMap.get(key);
        if(!live) {differences.push({collection,id:row.id,kind:'missing-from-closure'});if(op)states.push({collection,id:row.id,state:'diverged'});continue;}
        const doc=unpack(live.bson);
        if(!op) {if(!equal(doc,unpack(row.bson))) differences.push({collection,id:row.id,kind:'control-document-changed'});continue;}
        let state='diverged';
        if(equal(doc,unpack(op.beforeBson)))state='before';
        else if(afterMap.has(key)&&equal(doc,unpack(afterMap.get(key).afterBson)))state='applied';
        else if(reversedMap.has(key)&&equal(doc,unpack(reversedMap.get(key).reversedBson)))state='reversed';
        if(state==='diverged')differences.push({collection,id:row.id,kind:'selected-document-changed'});
        states.push({collection,id:row.id,state});
      }
    }
    const counts={before:0,applied:0,reversed:0,diverged:0};for(const s of states)counts[s.state]++;
    let state='partial';
    if(differences.length||states.length!==64)state='diverged';
    else if(counts.before===64)state='before';
    else if(counts.applied===64)state='applied';
    else if(counts.applied===0&&counts.reversed>0&&counts.before+counts.reversed===64)state='reversed';
    const activeLock=fs.existsSync(lockDir)&&!ignoreOwnLock;
    return {at:new Date().toISOString(),operationId,preparedPlanSha256:context.digest,reviewedPlanSha256,state,counts,differences,states,activeLock,
      safeToReopen:!activeLock&&['before','applied','reversed'].includes(state),snapshotSha256:snapshotDigest(actual)};
  }
  async function recoverState({expectedPlanSha256}) {return assess(load(expectedPlanSha256));}
  async function cas(op,current,expected,after,event) {
    assert(equal(current,expected),'Concurrent record change: '+op.collection+':'+op.id);
    const set={};
    for(const key of Object.keys(unpack(op.setBson)))set[key]=after[key];
    Object.assign(set,{reconciliation:after.reconciliation,updatedAt:after.updatedAt});
    append({event:'write-intent',direction:event,collection:op.collection,id:op.id,beforeSha256:hash(bson.serialize(ordered(current))),afterSha256:hash(bson.serialize(ordered(after)))});
    const result=await db.collection(op.collection).updateOne({_id:current._id,$expr:{$eq:['$$ROOT',{$literal:current}]}},
      {$set:set,$push:{reconciliationHistory:after.reconciliationHistory.at(-1)}},{upsert:false,writeConcern:{w:'majority',j:true,wtimeout:15000}});
    assert.equal(result.matchedCount,1,'Whole-document comparison lost: '+op.collection+':'+op.id);
    if(afterWrite)await afterWrite({direction:event,op});
    assert(equal(await findOne(op.collection,op.id),after),'Post-write verification differs');
    append({event:'write-verified',direction:event,collection:op.collection,id:op.id});
  }
  async function apply({expectedPlanSha256}) {
    let context=load(expectedPlanSha256);await gate('apply',{preparedPlanSha256:context.digest,stage:'entry'});
    assert(!context.reversal,'Rollback has been requested; use inspected reversal, not apply');
    return locked(async()=>{
      let assessment=await assess(context,{ignoreOwnLock:true});assert.equal(assessment.differences.length,0,'Closure changed before apply');
      assert(assessment.counts.reversed===0&&assessment.counts.diverged===0);
      if(!context.execution) {
        assert.equal(assessment.state,'before');
        const preflight=await collectDatabase(db,scope,ObjectId);assert.equal(preflight.issues.length,0,'Frozen preflight failed');assert.equal(preflight.notes.length,0);
        const at=new Date();
        const execution={kind:'gulnara-database-execution',version:1,operationId,preparedPlanSha256:context.digest,reviewedPlanSha256,
          startedAt:at.toISOString(),operations:context.plan.operations.map(op=>({collection:op.collection,id:op.id,afterBson:pack(materialize(context.plan,op,at,context.digest))}))};
        writeOnce(executionFile,execution);context=load(expectedPlanSha256);
      }
      const afters=new Map(context.execution.operations.map(o=>[o.collection+':'+o.id,unpack(o.afterBson)]));
      let complete=0;
      for(const op of context.plan.operations) {
        await gate('apply',{preparedPlanSha256:context.digest,stage:'write',completed:complete,collection:op.collection,id:op.id});
        const current=await findOne(op.collection,op.id),after=afters.get(op.collection+':'+op.id);
        if(equal(current,after))append({event:'adopt-verified-after',collection:op.collection,id:op.id});
        else await cas(op,current,unpack(op.beforeBson),after,'apply');
        complete++;
        if(complete%16===0) {assessment=await assess(context,{ignoreOwnLock:true});assert.equal(assessment.differences.length,0,'Closure changed during apply');}
      }
      assessment=await assess(context,{ignoreOwnLock:true});assert.equal(assessment.state,'applied','Apply incomplete');
      const receipt={...assessment,activeLock:false,safeToReopen:true,completedAt:new Date().toISOString()};
      writeOnce(path.join(directory,'applied-'+crypto.randomUUID()+'.json'),receipt);return receipt;
    });
  }
  async function verify({expectedPlanSha256}) {
    const state=await recoverState({expectedPlanSha256});assert.equal(state.state,'applied');assert.equal(state.safeToReopen,true);return state;
  }
  async function rollback({expectedPlanSha256}) {
    let context=load(expectedPlanSha256);await gate('rollback',{preparedPlanSha256:context.digest,stage:'entry'});
    return locked(async()=>{
      let assessment=await assess(context,{ignoreOwnLock:true});assert.equal(assessment.differences.length,0,'Closure changed; rollback refused');
      if(assessment.state==='before')return {...assessment,activeLock:false,safeToReopen:true};
      assert(context.execution,'No execution after-images exist');
      if(!context.reversal) {
        const at=new Date(),afters=new Map(context.execution.operations.map(o=>[o.collection+':'+o.id,unpack(o.afterBson)]));
        const operations=context.plan.operations.map(op=>{
          const reversed=reverseImage(op,afters.get(op.collection+':'+op.id),at,context.digest);
          return {collection:op.collection,id:op.id,reversedBson:pack(reversed)};
        });
        writeOnce(reversalFile,{kind:'gulnara-database-rollback',version:1,operationId,preparedPlanSha256:context.digest,at:at.toISOString(),operations});
        context=load(expectedPlanSha256);
      }
      const afters=new Map(context.execution.operations.map(o=>[o.collection+':'+o.id,unpack(o.afterBson)]));
      const reversed=new Map(context.reversal.operations.map(o=>[o.collection+':'+o.id,unpack(o.reversedBson)]));
      let completed=0;
      for(const op of [...context.plan.operations].reverse()) {
        await gate('rollback',{preparedPlanSha256:context.digest,stage:'write',completed,collection:op.collection,id:op.id});
        const current=await findOne(op.collection,op.id),rev=reversed.get(op.collection+':'+op.id);
        if(equal(current,unpack(op.beforeBson))||equal(current,rev))append({event:'adopt-safe-reversal-state',collection:op.collection,id:op.id});
        else await cas(op,current,afters.get(op.collection+':'+op.id),rev,'rollback');
        completed++;
      }
      assessment=await assess(context,{ignoreOwnLock:true});assert(['before','reversed'].includes(assessment.state));
      const receipt={...assessment,activeLock:false,safeToReopen:true,completedAt:new Date().toISOString()};
      writeOnce(path.join(directory,'reversed-'+crypto.randomUUID()+'.json'),receipt);return receipt;
    });
  }
  return {prepare,apply,verify,recoverState,assess:recoverState,rollback,pack,unpack,equal};
}
module.exports={createExecutor,TYPED};
