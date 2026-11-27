'use strict';
// User-operated service control. This controller does not change MongoDB or payloads.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {waitForStopped}=require('./listener-probe.cjs');
const PACK='/storage/komondor-kamoun-disposal-20261127-01';
const NODE='/storage/.nvm/versions/node/v24.11.1/bin/node';
const PM2='/storage/.nvm/versions/node/v24.11.1/lib/node_modules/pm2/bin/pm2';
const API='/storage/www/komondor-api',WEB='/storage/www/komondor-web';
const NAMES=['komondor-api','komondor-power','komondor-nudge','komondor-web'];
const STOP=['komondor-nudge','komondor-power','komondor-web','komondor-api'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const relative=v=>typeof v==='string'&&v.length>0&&!path.isAbsolute(v)&&!v.includes('\\')&&v.split('/').every(p=>p&&p!=='.'&&p!=='..');
function readRegular(filename,root=PACK){
 const rel=path.relative(root,filename);assert(relative(rel),'Evidence path escapes pack');let current=root;
 assert(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink(),'Unsafe pack');
 for(const bit of rel.split('/')){current=path.join(current,bit);assert(!fs.lstatSync(current).isSymbolicLink(),'Symlink in evidence');}
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const a=fs.fstatSync(fd);assert(a.isFile());const raw=fs.readFileSync(fd),b=fs.fstatSync(fd);for(const k of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(a[k],b[k]);return raw;}finally{fs.closeSync(fd);}
}
function validateReady(r){
 assert.equal(r.kind,'kamoun-disposal-window-v1');assert.equal(r.version,1);assert.match(r.operationId,/^[a-zA-Z0-9_-]{8,100}$/);
 assert(digest(r.planSha256));assert(relative(r.planFile));assert(path.isAbsolute(r.backupPlanFile));
 for(const k of ['apiHead','webHead'])assert.match(r[k],/^[a-f0-9]{40}$/);
 assert(r.files&&typeof r.files==='object'&&!Array.isArray(r.files));
 for(const [name,h]of Object.entries(r.files))assert(relative(name)&&digest(h),'Unsafe seal entry');
 for(const name of ['window.cjs','listener-probe.cjs','state-probe.cjs','retirement.cjs',r.planFile])assert(digest(r.files[name]),'Required execution file missing');
 assert.equal(r.files[r.planFile],r.planSha256);
 assert(Number.isInteger(r.windowMinutes)&&r.windowMinutes>=5&&r.windowMinutes<=20);
 assert(Array.isArray(r.projectIds)&&r.projectIds.length===6&&new Set(r.projectIds).size===6);
 for(const id of r.projectIds)assert.match(id,/^[a-f0-9]{24}$/);
 return r;
}
function serviceSnapshot(all,status){
 assert(Array.isArray(all));assert.equal(all.filter(p=>p.pm2_env?.pm_exec_path===API+'/server.js').length,1,'Unexpected API instances');
 return NAMES.map(name=>{const hits=all.filter(p=>p.name===name);assert.equal(hits.length,1,'Missing/duplicate '+name);const p=hits[0];
  assert.equal(p.pm2_env?.pm_cwd,'/storage/www/'+name);assert.equal(p.pm2_env?.status,status,'Unexpected service status: '+name);
  assert(status==='stopped'?!p.pid:Number.isInteger(p.pid)&&p.pid>0,'Unexpected service PID');return{name,id:p.pm_id,pid:p.pid,status};});
}
function checkProbe(p,r,runId,expected){
 assert.equal(p.runId,runId);assert.equal(p.planSha256,r.planSha256);assert.equal(p.safeToReopen,true,'Graph does not permit restart');
 assert.equal(p.mutationInProgress,false,'Retirement still active');assert(['before','applied'].includes(p.state),'Incomplete or divergent graph');
 if(expected)assert.equal(p.state,expected);return p;
}
async function runWindow(r,d){
 validateReady(r);const runId=d.uuid(),touched=new Set();let created=false,paused=false,initialError=null,restoreError=null,finalProbe;
 const receipt=extra=>({at:new Date(d.now()).toISOString(),runId,controllerPid:d.controllerPid,operationId:r.operationId,planSha256:r.planSha256,...extra});
 try{
  await d.verifySeal();await d.checkAdmission();await d.checkRelease();await d.checkPm2();
  for(const f of ['window-complete.json','mutation.lock','window-reopen.lock','retirement-execution.json'])assert(!d.exists(f),'Previous or active execution: '+f);
  checkProbe(await d.probe(runId),r,runId,'before');
  const services=serviceSnapshot(await d.snapshot(),'online');assert(await d.apiReady(),'API is not ready');
  const apiWork=await d.noApiWork(),powerWork=await d.noPowerWork();
  await d.createEvidence();created=true;await d.write('before.json',receipt({apiWork,powerWork,services}));
  for(const name of STOP){if(name==='komondor-api'){await d.noApiWork();await d.noPowerWork();}touched.add(name);await d.stop(name);}
  const stopped=serviceSnapshot(await d.snapshot(),'stopped');assert(await d.apiStopped(),'API listener did not stop');await d.noApiWork();await d.noPowerWork();
  const deadline=d.now()+r.windowMinutes*60000;
  await d.write('paused.json',receipt({recordedAt:new Date(d.now()).toISOString(),actor:'deeks',windowOperator:'tsldata',windowDirectory:PACK,projectIds:r.projectIds,
   externalWritersFrozen:true,directApiCallersFrozen:true,allApiInstancesStopped:true,powerPaused:true,nudgePaused:true,webPaused:true,backupIndependentlyRetained:true,
   apiReadyUrls:['http://127.0.0.1:3061/ready'],expiresAt:new Date(deadline-60000).toISOString(),reviewAfterAt:new Date(deadline).toISOString(),services:stopped}));
  paused=true;d.say('PAUSED: all four Komondor services stopped. Tell Codex PAUSED and keep this terminal open. The window is bounded to 20 minutes; restart requires a complete, consistent metadata state.');
  let reason='deadline';
  while(d.now()<deadline){
   if(d.interrupted()){reason='signal';break;}
   if(d.exists('window-complete.json')){const done=await d.read('window-complete.json');assert.equal(done.runId,runId);assert.equal(done.planSha256,r.planSha256);assert.equal(done.operationId,r.operationId);reason='verified-completion-request';break;}
   await d.wait(1000);
  }
  await d.write('restart-reason.json',receipt({reason}));
 }catch(e){initialError=e;if(created)await d.write('failed.json',receipt({error:e.message}));d.say('STOPPED SAFELY: '+e.message);}
 finally{
  if(touched.size){let locked=false;
   try{
    await d.acquireReopenLock(receipt({purpose:'independent-reopen-check'}));locked=true;
    assert(!d.exists('mutation.lock'),'Retirement lock remains; services must stay stopped');
    await d.verifySeal();await d.checkRelease();finalProbe=checkProbe(await d.probe(runId),r,runId);
    assert(!d.exists('mutation.lock'),'Retirement began during reopen check');
    if(touched.has('komondor-api'))await d.restart('komondor-api');
    let healthy=false;for(let i=0;i<45;i++){if(await d.apiReady()){healthy=true;break;}await d.wait(1000);}assert(healthy,'API did not become ready; dependants remain stopped');
    for(const name of ['komondor-web','komondor-power','komondor-nudge'])if(touched.has(name))await d.restart(name);
    const services=serviceSnapshot(await d.snapshot(),'online');await d.write('restored.json',receipt({apiReady:true,graphState:finalProbe.state,services,consistency:finalProbe}));
    await d.releaseReopenLock(runId);locked=false;d.say('RESTORED: API ready; Web, Power and Nudge online.');
   }catch(e){restoreError=e;if(created)await d.write('restore-failed.json',receipt({error:e.message,reopenLockRetained:locked}));d.say('RESTORE NEEDS ATTENTION: '+e.message+'. Keep services stopped until the retained execution evidence has been reviewed.');}
  }
 }
 return{runId,paused,restored:touched.size>0&&!restoreError,initialError:initialError?.message||null,restoreError:restoreError?.message||null,state:finalProbe?.state||null};
}
function parseArgs(argv){assert.equal(argv.length,4);assert.deepEqual(argv.slice(0,3),['--execute','--external-writers-and-api-callers-frozen','--ready-sha256']);assert(digest(argv[3]));return argv[3];}
async function main(argv=process.argv.slice(2)){
 const expected=parseArgs(argv);assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'tsldata','Run service control in the tsldata terminal');
 const readyPath=path.join(PACK,'execution-ready.json'),readyRaw=readRegular(readyPath);assert.equal(sha(readyRaw),expected);const r=validateReady(JSON.parse(readyRaw)),dir=path.join(PACK,'window');
 const env={...process.env,PM2_HOME:'/storage/.pm2'},pm=args=>cp.execFileSync(NODE,[PM2,...args],{env,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
 const git=(root,args)=>cp.execFileSync('git',['--no-optional-locks','--no-pager','-c','safe.directory='+root,'-C',root,...args],{encoding:'utf8',timeout:10000}).trim();
 const write=(name,value)=>{assert(/^[a-z-]+\.json$/.test(name));const fd=fs.openSync(path.join(dir,name),'wx',0o644);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const {MongoClient}=require(API+'/node_modules/mongodb');const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000}),db=client.db('komondor');
 let interrupted=false,probeCount=0;const signal=()=>{interrupted=true;};for(const s of ['SIGINT','SIGTERM'])process.on(s,signal);
 try{
  const result=await runWindow(r,{
   now:Date.now,uuid:crypto.randomUUID,controllerPid:process.pid,interrupted:()=>interrupted,say:console.log,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
   exists:name=>fs.existsSync(path.join(PACK,name)),read:name=>JSON.parse(readRegular(path.join(PACK,name))),
   createEvidence:()=>fs.mkdirSync(dir,{mode:0o755}),write,
   verifySeal:()=>{assert.equal(sha(readRegular(readyPath)),expected);for(const [f,h]of Object.entries(r.files))assert.equal(sha(readRegular(path.join(PACK,f))),h,'Execution file differs: '+f);
    const backup=fs.realpathSync(r.backupPlanFile),source=path.join(PACK,r.planFile);assert(!backup.startsWith(PACK+'/')&&!backup.startsWith(API+'/')&&!backup.startsWith('/mnt/reads/'),'Backup is not independent');
    assert(!fs.lstatSync(r.backupPlanFile).isSymbolicLink());assert.equal(sha(fs.readFileSync(backup)),r.planSha256);const a=fs.statSync(source),b=fs.statSync(backup);assert(a.dev!==b.dev||a.ino!==b.ino,'Backup is a hardlink');},
   checkAdmission:()=>{const plan=JSON.parse(readRegular(path.join(PACK,r.planFile)));require('./retirement.cjs').validatePlan(plan);assert(Date.parse(plan.expiresAt)>Date.now()+r.windowMinutes*60000+60000,'Plan expires too soon for the complete window');assert.deepEqual(plan.targets.map(t=>t.projectId).sort(),r.projectIds.slice().sort(),'Window targets differ');},
   checkRelease:()=>{for(const [root,head]of [[API,r.apiHead],[WEB,r.webHead]]){assert.equal(git(root,['rev-parse','HEAD']),head,'Production code changed');assert.equal(git(root,['status','--porcelain']),'','Production worktree changed');}},
   checkPm2:()=>{assert(fs.statSync('/storage/.pm2/rpc.sock').isSocket());process.kill(Number(fs.readFileSync('/storage/.pm2/pm2.pid','utf8').trim()),0);},
   snapshot:()=>JSON.parse(pm(['jlist'])),stop:name=>pm(['stop',name]),restart:name=>pm(['restart',name]),
   apiReady:async()=>{try{const response=await fetch('http://127.0.0.1:3061/ready',{signal:AbortSignal.timeout(3000)});return response.status===200&&(await response.json()).status==='ready';}catch{return false;}},
   apiStopped:async()=>{const value=await waitForStopped();if(fs.existsSync(dir)){assert(probeCount<26);write('listener-probe-'+String.fromCharCode(97+probeCount++)+'.json',{at:new Date().toISOString(),...value});}return value.stopped;},
   noApiWork:async()=>{const counts={ingest:await db.collection('ingestjobs').countDocuments({status:{$nin:['done','failed']}}),runs:await db.collection('runs').countDocuments({$or:[{status:{$in:['pending','processing']}},{md5VerificationStatus:'in_progress'}]})};assert(Object.values(counts).every(n=>n===0),'Unfinished API work: '+JSON.stringify(counts));return counts;},
   noPowerWork:()=>{const program="import sqlite3,json\nc=sqlite3.connect('file:/storage/www/komondor-power/db/production.db?mode=ro',uri=True)\nprint(json.dumps({'entries':c.execute(\"SELECT count(*) FROM entries WHERE status IS NULL OR status NOT IN ('completed','error')\").fetchone()[0],'tracking':c.execute('SELECT count(*) FROM entry_tracking WHERE finished_at IS NULL').fetchone()[0]}))\nc.close()";const counts=JSON.parse(cp.execFileSync('python3',['-c',program],{encoding:'utf8',timeout:10000}));assert(Object.values(counts).every(n=>n===0),'Unfinished Power work: '+JSON.stringify(counts));return counts;},
   probe:runId=>JSON.parse(cp.execFileSync(NODE,[path.join(PACK,'state-probe.cjs'),'--plan',path.join(PACK,r.planFile),'--plan-sha256',r.planSha256,'--window-dir',PACK,'--run-id',runId],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024})),
   acquireReopenLock:value=>{const fd=fs.openSync(path.join(PACK,'window-reopen.lock'),'wx',0o644);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
   releaseReopenLock:runId=>{const p=path.join(PACK,'window-reopen.lock');assert.equal(JSON.parse(readRegular(p)).runId,runId);fs.unlinkSync(p);},
  });if(result.initialError||result.restoreError)process.exitCode=1;return result;
 }finally{for(const s of ['SIGINT','SIGTERM'])process.off(s,signal);await client.close();}
}
module.exports={validateReady,serviceSnapshot,checkProbe,runWindow,readRegular,parseArgs,main};
if(require.main===module)main().catch(e=>{console.error('STOPPED SAFELY: '+e.message);process.exitCode=1;});
