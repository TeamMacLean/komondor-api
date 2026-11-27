'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {probeOnce,waitForStopped}=require('./listener-probe.cjs');
function fake(sequence){let time=0,index=0;return {now:()=>time,wait:async ms=>{time+=ms;},totalTimeoutMs:800,
  probe:async()=>{const result=sequence[Math.min(index++,sequence.length-1)];return {...result,elapsedMs:0};}};}
const refused={state:'refused',code:'ECONNREFUSED'},listening={state:'listening',code:'CONNECTED'};
test('fresh TCP connection detects listening and then refused on a real loopback server',async()=>{
  const server=net.createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try{assert.equal((await probeOnce({port})).state,'listening');}finally{await new Promise(resolve=>server.close(resolve));}
  const result=await waitForStopped({port});assert.equal(result.stopped,true);assert.equal(result.attempts.length,2);assert(result.attempts.every(x=>x.code==='ECONNREFUSED'));
});
test('two consecutive refusals are required, separated by a fresh attempt',async()=>{
  const result=await waitForStopped(fake([refused,listening,refused,refused]));assert.equal(result.stopped,true);assert.equal(result.attempts.length,4);
});
test('continued listening is distinct from an inconclusive timeout',async()=>{
  const active=await waitForStopped(fake([listening]));assert.equal(active.stopped,false);assert.equal(active.reason,'listener-still-accepting-connections');
  const unknown=await waitForStopped(fake([{state:'inconclusive',code:'TIMEOUT'}]));assert.equal(unknown.stopped,false);assert.equal(unknown.reason,'listener-state-inconclusive');
});
test('reset, pool closure, permission and unknown errors never establish a stopped listener',async()=>{
  for(const code of ['ECONNRESET','UND_ERR_SOCKET','EACCES','UNKNOWN_ERROR']){
    const r=await waitForStopped(fake([{state:'inconclusive',code}]));assert.equal(r.stopped,false);assert(r.attempts.length<=4);
  }
  await assert.rejects(waitForStopped(fake([{state:'refused',code:'ECONNRESET'}])));
});
test('a single refusal at the deadline is insufficient',async()=>{
  const r=await waitForStopped(fake([listening,listening,listening,refused]));assert.equal(r.stopped,false);
});
test('socket errors are classified explicitly and every socket is destroyed',async()=>{
  for(const code of ['ECONNREFUSED','ECONNRESET','EACCES',undefined]){
    const socket=new EventEmitter();let destroyed=false;socket.destroy=()=>{destroyed=true;};socket.setTimeout=()=>{};
    const p=probeOnce({connect:options=>{assert.equal(options.host,'127.0.0.1');queueMicrotask(()=>socket.emit('error',{code}));return socket;}});
    const r=await p;assert.equal(r.state,code==='ECONNREFUSED'?'refused':'inconclusive');assert(destroyed);
  }
});
