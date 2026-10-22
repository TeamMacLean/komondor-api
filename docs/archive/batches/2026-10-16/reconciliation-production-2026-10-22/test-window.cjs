const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/window.cjs','utf8');
const oldHead='4cd738e6c2d9d508b2248ff4298061e576109c19',newHead='27b98035dccf1b33e2f449be972e2003b4114b24';
const digest='6ba8c00fddf137fe36f2288fd7c1d151ee589edc852903fc66e2e9e0a8b3e303';
async function scenario(kind){
 const files=new Map(),actions=[],services=['komondor-api','komondor-power','komondor-nudge','komondor-web'].map((name,i)=>({name,pm_id:i,pid:100+i,pm2_env:{status:'online',pm_cwd:'/storage/www/'+name,pm_exec_path:'/storage/www/'+name+(name==='komondor-api'?'/server.js':'/index.js')}}));
 let webHead='beb0b95e4df5ef630b4847f84c3e45f637b7888a',head=oldHead,registered=0,now=Date.now(),directory=false,stopFailed=false;
 const FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const proc={argv:['node','window','--execute','--external-writers-frozen'],env:{},kill(){},on(){},exitCode:0};
 const fakeFs={statSync:()=>({isSocket:()=>true}),existsSync:f=>files.has(f)||(directory&&f==='/storage/komondor-reconciliation-window-20261022'),mkdirSync:()=>{directory=true;},readFileSync:f=>{
  if(f.endsWith('/pm2.pid'))return '123';
  if(f.endsWith('reconciliation-release.json'))return JSON.stringify({head:kind==='wrong-build'?'bad-build':'e9e183cc6968da46a4b0eada76471b750745a771'});
  if(f.endsWith('execution-ready.json'))return JSON.stringify({planSha256:digest,releaseHead:newHead,independentBackupRestored:true,operations:26724,shadowReplayPassed:true,webBuildSucceeded:true,webReleaseHead:"e9e183cc6968da46a4b0eada76471b750745a771"});
  if(files.has(f))return files.get(f);throw Error('Unexpected read '+f);
 },writeFileSync:(f,bytes)=>{
  assert(!files.has(f),'Overwrite');files.set(f,bytes);
  if(f.endsWith('paused.json')){
   const p=JSON.parse(bytes);registered=26724;webHead='e9e183cc6968da46a4b0eada76471b750745a771';head=kind==='wrong-release'?oldHead:newHead;
   if(kind!=='deadline')files.set('/storage/komondor-reconciliation-20261022/window-complete.json',JSON.stringify({runId:p.runId,planSha256:digest,reason:'verified'}));
  }
 }};
 const cp={execFileSync:(command,args)=>{
  if(command==='id')return 'tsldata';
  if(command==='git')return args.includes('rev-parse')?(args.includes('/storage/www/komondor-web')?webHead:head):(kind==='dirty'?' M model.js':'');
  if(command==='python3')return JSON.stringify({entries:kind==='busy'?1:0,tracking:0});
  if(command.endsWith('/node')){
   if(args[1]==='jlist')return JSON.stringify(services);
   const action=args[1],service=services.find(s=>s.name===args[2]);actions.push([action,service.name]);
   if(action==='stop'){service.pm2_env.status='stopped';service.pid=0;if(kind==='stop-failure'&&service.name==='komondor-api'&&!stopFailed){stopFailed=true;throw Error('Injected stop error after stop');}}
   else {if(kind==='restart-failure'&&service.name==='komondor-api')throw Error('Injected restart failure');service.pm2_env.status='online';service.pid=321;}
   return '';
  }
  throw Error('Unexpected command '+command);
 }};
 const db={collection:name=>({countDocuments:async()=>name==='projects'?registered:0})};
 const mongoose={set(){},connect:async()=>{},disconnect:async()=>{},connection:{db}};
 const imports={'fs':fakeFs,'child_process':cp,'assert/strict':assert,'crypto':require('crypto')};
 const req=name=>imports[name]||(name.endsWith('/mongoose')?mongoose:name.endsWith('/dotenv')?{config(){}}:name.endsWith('/validateEnv')?{resolveMongoUri:()=> 'scratch'}:name.endsWith('/preflight')?{apiAppearsStopped:async()=>assert.equal(services[0].pm2_env.status,'stopped')}:assert.fail('Unexpected require '+name));
 await vm.runInNewContext(source,{require:req,process:proc,Date:FakeDate,setTimeout:(fn,ms)=>{now+=ms;queueMicrotask(fn);},AbortSignal:{timeout:()=>undefined},fetch:async()=>({status:services[0].pm2_env.status==='online'?200:503,json:async()=>({status:'ready'})}),console:{log(){},error(){}}});
 const names=[...files.keys()];
 if(['normal','deadline','stop-failure'].includes(kind)){assert(names.some(f=>f.endsWith('restored.json')),kind);assert(services.every(s=>s.pm2_env.status==='online'));}
 if(['busy','dirty'].includes(kind)){assert.equal(actions.length,0);assert.equal(proc.exitCode,1);}
 if(['wrong-release','restart-failure','wrong-build'].includes(kind)){assert(names.some(f=>f.endsWith('restore-failed.json')));assert(services.slice(1).every(s=>s.pm2_env.status==='stopped'));assert.equal(proc.exitCode,1);}
 if(kind==='normal')assert.deepEqual(actions,[['stop','komondor-nudge'],['stop','komondor-power'],['stop','komondor-web'],['stop','komondor-api'],['restart','komondor-api'],['restart','komondor-web'],['restart','komondor-power'],['restart','komondor-nudge']]);
 return kind;
}
(async()=>{for(const kind of ['normal','busy','dirty','stop-failure','wrong-release','restart-failure','wrong-build','deadline'])console.log('PASS '+await scenario(kind));})().catch(e=>{console.error(e);process.exitCode=1;});
