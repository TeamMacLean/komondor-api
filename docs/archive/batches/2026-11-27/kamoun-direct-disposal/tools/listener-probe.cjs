'use strict';
// Each check gets a fresh socket. HTTP pool shutdown errors never establish
// that a listener is stopped; only an explicit connection refusal can do so.
const assert = require('node:assert/strict');
const net = require('node:net');

function probeOnce({port = 3061, timeoutMs = 800, now = Date.now, connect = net.createConnection} = {}) {
  assert(Number.isInteger(port) && port > 0 && port <= 65535);
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000);
  const started = now();
  return new Promise(resolve => {
    let finished = false;
    const socket = connect({host:'127.0.0.1',port});
    const finish = (state,code) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({state,code,elapsedMs:Math.max(0,now()-started)});
    };
    socket.once('connect',()=>finish('listening','CONNECTED'));
    socket.once('error',error=>finish(error.code === 'ECONNREFUSED' ? 'refused' : 'inconclusive',error.code || 'UNKNOWN_ERROR'));
    socket.setTimeout(timeoutMs,()=>finish('inconclusive','TIMEOUT'));
  });
}

async function waitForStopped({port = 3061, totalTimeoutMs = 5000, attemptTimeoutMs = 800, intervalMs = 200,
  now = Date.now, wait = ms => new Promise(resolve=>setTimeout(resolve,ms)), probe = probeOnce} = {}) {
  assert(Number.isInteger(totalTimeoutMs) && totalTimeoutMs >= 400 && totalTimeoutMs <= 10000);
  assert(Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 1000);
  const started = now(), deadline = started + totalTimeoutMs, attempts = [];
  let refusals = 0;
  for (let index = 0; index < 32 && now() < deadline; index++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const result = await probe({port,timeoutMs:Math.min(attemptTimeoutMs,remaining),now});
    assert(['listening','refused','inconclusive'].includes(result.state));
    assert(typeof result.code === 'string');
    // Even an injected probe cannot mark an ambiguous network error as closed.
    assert(result.state !== 'refused' || result.code === 'ECONNREFUSED');
    attempts.push({attempt:index+1,at:new Date(now()).toISOString(),...result});
    refusals = result.state === 'refused' ? refusals + 1 : 0;
    if (refusals >= 2) return {stopped:true,reason:'two-consecutive-connection-refusals',host:'127.0.0.1',port,elapsedMs:now()-started,attempts};
    if (now() < deadline) await wait(Math.min(intervalMs,deadline-now()));
  }
  const listening = attempts.at(-1)?.state === 'listening';
  return {stopped:false,reason:listening?'listener-still-accepting-connections':'listener-state-inconclusive',host:'127.0.0.1',port,elapsedMs:now()-started,attempts};
}

module.exports = {probeOnce,waitForStopped};
