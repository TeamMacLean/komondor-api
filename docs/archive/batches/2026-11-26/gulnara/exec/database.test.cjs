'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const bsonModule=require(process.env.KOMONDOR_BSON_MODULE||'/Users/deeks/Local_Documents/Local_GitHub/komondor-api/node_modules/bson');
const {BSON,ObjectId,Int32,Long,Double,Decimal128}=bsonModule,bson=new BSON();
const {createExecutor,TYPED}=require('./database.cjs');
const base=path.resolve(__dirname,'..');
const scope=JSON.parse(fs.readFileSync(path.resolve(base,'../../../evidence/release-planning-20261030/gulnara-scope.json')));
const reviewPlan=JSON.parse(fs.readFileSync(path.join(base,'change-plan.json')));
const ena=JSON.parse(fs.readFileSync(path.join(base,'ena-fastq-preview.json')));
const oid=x=>new ObjectId(x),id=x=>String(x?._id||x),copy=(x,typed=true)=>bson.deserialize(bson.serialize(x),typed?TYPED:{});
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&Object.getPrototypeOf(x)===Object.prototype?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const equal=(a,b)=>a&&b&&bson.serialize(sorted(a)).equals(bson.serialize(sorted(b)));
function matches(row,filter) {
  if(filter.$or&&!filter.$or.some(x=>matches(row,x)))return false;
  if(filter.$expr&&!equal(row,filter.$expr.$eq[1].$literal))return false;
  return Object.entries(filter).every(([k,v])=>k.startsWith('$')?true:v instanceof RegExp?typeof row[k]==='string'&&v.test(row[k]):v?.$in?v.$in.some(x=>id(x)===id(row[k])):id(v)===id(row[k]));
}
function makeRows() {
  const convert=o=>{for(const k of ['_id','group','project','sample'])if(o[k])o[k]=oid(o[k]);return o;};
  const rows={projects:JSON.parse(JSON.stringify([...scope.sourceProjects,scope.targetProject])).map(convert),
    samples:scope.matches.map(m=>convert({...m.sample})),runs:scope.matches.flatMap(m=>m.runs.map(r=>convert({...r}))),files:[],reads:[],additionalfiles:[],ingestjobs:[],newsitems:[]};
  for(const name of ['samples','runs']) for(const row of rows[name]) {
    const op=reviewPlan.operations.find(o=>o.collection===name&&o.id===id(row._id));
    for(const [key,value] of Object.entries(op.proposedIdentity)) if(row[key]===undefined)row[key]=value;
  }
  const when=new Date('2026-10-30T14:41:13.635Z');
  for(const op of reviewPlan.operations.filter(o=>o.collection==='files')) {
    const file={_id:oid(op.id),...op.proposedIdentity,path:op.businessChanges.path.before,createdAt:when,updatedAt:when,
      numeric:{i:new Int32(7),l:Long.fromString('9007199254740993'),d:new Double(7),decimal:Decimal128.fromString('12.3400')}};
    if(op.existingIdentity) {file.reconciliation={version:1,operationId:'old-'+op.id,identity:op.existingIdentity,currentObservation:{canonicalPath:'/old/source/path',observedAt:when}};
      file.reconciliationHistory=Array.from({length:op.existingHistoryEntries},()=>({operationId:'old-'+op.id,at:when}));}
    rows.files.push(file);
  }
  for(const r of [...ena.sequenceFiles,...ena.excludedFromSubmissionOnly]) rows.reads.push({_id:oid(r.readId),file:oid(r.fileId),run:oid(r.runId),paired:r.paired,...(r.siblingReadId?{sibling:oid(r.siblingReadId)}:{})});
  const readIds=new Set(rows.reads.map(r=>id(r.file)));
  let counter=1;
  for(const file of rows.files.filter(f=>!readIds.has(id(f._id)))) {
    const run=rows.runs.find(r=>file.path.startsWith(r.path.replace(/^\//,'')+'/'));
    const sample=rows.samples.find(s=>file.path.startsWith(s.path.replace(/^\//,'')+'/'));
    rows.additionalfiles.push({_id:oid('7000000000000000000000'+(counter++).toString(16).padStart(2,'0')),file:file._id,...(run?{run:run._id}:{sample:sample._id})});
  }
  return rows;
}
function fixture(t,{afterWrite}={}) {
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'gulnara-db-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const rows=makeRows(),writes=[],state={paused:false,beforeUpdate:null};
  const db={databaseName:'fixture',admin(){return{command:async()=>({ismaster:true})};},collection(name){return{
    find(filter,options={}){return{sort(){return this;},maxTimeMS(){return this;},async toArray(){return rows[name].filter(r=>matches(r,filter)).sort((a,b)=>id(a._id).localeCompare(id(b._id))).map(r=>copy(r,options.promoteValues===false));}};},
    async findOne(filter,options={}){const row=rows[name].find(r=>matches(r,filter));return row?copy(row,options.promoteValues===false):null;},
    async updateOne(filter,update,options){
      assert(['samples','runs','files'].includes(name));assert.deepEqual(options,{upsert:false,writeConcern:{w:'majority',j:true,wtimeout:15000}});
      if(state.beforeUpdate)await state.beforeUpdate({name,filter,update});
      const row=rows[name].find(r=>matches(r,filter));if(!row)return{matchedCount:0};
      Object.assign(row,copy(update.$set));
      row.reconciliationHistory=[...(row.reconciliationHistory||[]),copy(update.$push.reconciliationHistory)];
      writes.push({name,id:id(row._id)});return{matchedCount:1};
    }
  };}};
  const options={db,ObjectId,bson,workDir:directory,scope,reviewPlan,actor:'fixture-operator',toolVersion:'fixture-v1',operationId:'gulnara-test-operation',
    reviewedPlanSha256:'a'.repeat(64),expectedCopyReceiptSha256:'b'.repeat(64),
    validateWindow:async({phase})=>{if(phase!=='prepare')assert(state.paused,'Window not paused');},afterWrite};
  return{rows,writes,state,directory,db,executor:createExecutor(options),fresh:extra=>createExecutor({...options,...extra})};
}

test('prepare is read-only; apply updates exactly64 with typed fields, original controls/history preserved',async t=>{
  const f=fixture(t),projects=f.rows.projects.map(r=>copy(r)),reads=f.rows.reads.map(r=>copy(r)),af=f.rows.additionalfiles.map(r=>copy(r));
  const p=await f.executor.prepare();assert.equal(f.writes.length,0);assert.equal(p.operations,64);
  assert.equal((await f.executor.recoverState({expectedPlanSha256:p.planSha256})).state,'before');
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/not paused/);
  f.state.paused=true;const receipt=await f.executor.apply({expectedPlanSha256:p.planSha256});assert.equal(receipt.state,'applied');assert.equal(f.writes.length,64);
  assert.equal((await f.executor.verify({expectedPlanSha256:p.planSha256})).safeToReopen,true);
  for(const [i,row] of f.rows.projects.entries())assert(equal(row,projects[i]));for(const [i,row] of f.rows.reads.entries())assert(equal(row,reads[i]));for(const [i,row] of f.rows.additionalfiles.entries())assert(equal(row,af[i]));
  for(const file of f.rows.files) {assert(file.numeric.i instanceof Int32);assert(file.numeric.l instanceof Long);assert(file.numeric.d instanceof Double);assert(file.numeric.decimal instanceof Decimal128);assert.equal(file.numeric.l.toString(),'9007199254740993');
    const plan=reviewPlan.operations.find(o=>o.id===id(file._id));assert.equal(file.reconciliationHistory.length,plan.existingHistoryEntries+1);assert.equal(file.path,plan.businessChanges.path.after);if(plan.existingIdentity)assert.equal(file.reconciliation.currentObservation.canonicalPath,'/old/source/path');}
  await f.executor.apply({expectedPlanSha256:p.planSha256});assert.equal(f.writes.length,64,'repeat only adopts exact after-images');
});
test('interruption after fifth write is unsafe, exact journalled continuation adopts and completes',async t=>{
  let n=0;const f=fixture(t,{afterWrite:async()=>{if(++n===5)throw Error('simulated interrupt');}}),p=await f.executor.prepare();f.state.paused=true;
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/simulated/);
  const state=await f.executor.recoverState({expectedPlanSha256:p.planSha256});assert.equal(state.state,'partial');assert.equal(state.safeToReopen,false);assert.equal(state.counts.applied,5);
  await f.fresh({afterWrite:null}).apply({expectedPlanSha256:p.planSha256});assert.equal(f.writes.length,64);
});
test('conditional rollback after partial apply restores original business graph and appends history',async t=>{
  let n=0;const f=fixture(t,{afterWrite:async()=>{if(++n===7)throw Error('simulated interrupt');}}),p=await f.executor.prepare();f.state.paused=true;
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}));
  const executor=f.fresh({afterWrite:null}),result=await executor.rollback({expectedPlanSha256:p.planSha256});assert.equal(result.state,'reversed');assert.equal(result.safeToReopen,true);
  const state=await executor.recoverState({expectedPlanSha256:p.planSha256});assert.equal(state.counts.reversed,7);assert.equal(state.counts.before,57);
  for(const file of f.rows.files){const plan=reviewPlan.operations.find(o=>o.id===id(file._id));assert.equal(file.path,plan.businessChanges.path.before);if(file.reconciliation?.state==='reversed')assert.equal(file.reconciliationHistory.length,plan.existingHistoryEntries+2);}
  const count=f.writes.length;await executor.rollback({expectedPlanSha256:p.planSha256});assert.equal(f.writes.length,count);await assert.rejects(executor.apply({expectedPlanSha256:p.planSha256}),/Rollback/);
});
test('concurrent edit loses whole-document CAS and is never overwritten or rolled back',async t=>{
  const f=fixture(t),p=await f.executor.prepare();f.state.paused=true;let first=true;
  f.state.beforeUpdate=async({name,filter})=>{if(first){first=false;f.rows[name].find(r=>id(r._id)===id(filter._id)).description='concurrent change';}};
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/comparison lost/);assert.equal(f.writes.length,0);
  const state=await f.executor.recoverState({expectedPlanSha256:p.planSha256});assert.equal(state.state,'diverged');assert.equal(state.safeToReopen,false);
  await assert.rejects(f.executor.rollback({expectedPlanSha256:p.planSha256}),/rollback refused/);assert.equal(f.writes.length,0);
});
test('new inbound reference after prepare blocks all writes and reopening',async t=>{
  const f=fixture(t),p=await f.executor.prepare();f.state.paused=true;
  f.rows.reads.push({_id:oid('710000000000000000000001'),run:oid('710000000000000000000002'),file:f.rows.files[0]._id});
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/Closure changed/);assert.equal(f.writes.length,0);assert.equal((await f.executor.recoverState({expectedPlanSha256:p.planSha256})).safeToReopen,false);
});
test('tampered prepared plan and execution after-image are refused',async t=>{
  const f=fixture(t),p=await f.executor.prepare();await assert.rejects(f.executor.recoverState({expectedPlanSha256:'f'.repeat(64)}),/digest differs/);
  f.state.paused=true;await f.executor.apply({expectedPlanSha256:p.planSha256});
  const filename=path.join(f.directory,'execution.json'),execution=JSON.parse(fs.readFileSync(filename));
  const row=f.executor.unpack(execution.operations[0].afterBson);row.storage={state:'aws'};execution.operations[0].afterBson=f.executor.pack(row);fs.writeFileSync(filename,JSON.stringify(execution));
  await assert.rejects(f.executor.recoverState({expectedPlanSha256:p.planSha256}),/after-image differs/);
});
test('control Project drift, even outside touched fields, prevents writes',async t=>{
  const f=fixture(t),p=await f.executor.prepare();f.state.paused=true;f.rows.projects[0].storage.s3Uri='s3://changed';
  await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/Closure changed/);assert.equal(f.writes.length,0);
});
test('active mutation lock refuses reopening and overlapping apply',async t=>{
  const f=fixture(t),p=await f.executor.prepare();f.state.paused=true;fs.mkdirSync(path.join(f.directory,'active.lock'));
  assert.equal((await f.executor.recoverState({expectedPlanSha256:p.planSha256})).safeToReopen,false);await assert.rejects(f.executor.apply({expectedPlanSha256:p.planSha256}),/EEXIST/);assert.equal(f.writes.length,0);
});
