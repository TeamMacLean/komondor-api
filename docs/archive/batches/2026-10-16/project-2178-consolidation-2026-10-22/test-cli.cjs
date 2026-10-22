'use strict';
// Argument validation only: never connects to a database or writes to a tree.
const assert=require('assert/strict');
const {parseArgs}=require('./operation.cjs');
const common=['--database','komondor','--work-dir','/private/evidence'];
const apply=['apply',...common,'--backup-plan','/independent/plan.json','--plan-sha256','f'.repeat(64),'--quiescence-receipt','/private/quiescence.json','--execute'];
const tests=[
 ['accept the exact launcher options including the digit-bearing digest flag',()=>{
  const original=[...apply],parsed=parseArgs(apply);
  assert.equal(parsed.command,'apply');assert.equal(parsed.opts['--plan-sha256'],'f'.repeat(64));
  assert.equal(parsed.opts['--execute'],true);assert.deepEqual(apply,original);
 }],
 ['accept preparation and verification without execution authority',()=>{
  assert.equal(parseArgs(['prepare',...common,'--checksums','/private/observations.json']).command,'prepare');
  assert.equal(parseArgs(['verify',...common]).command,'verify');
 }],
 ['reject unknown options',()=>assert.throws(()=>parseArgs([...apply,'--unknown','value']),/Unknown or repeated/)],
 ['reject repeated options',()=>assert.throws(()=>parseArgs([...apply,'--execute']),/Unknown or repeated/)],
 ['reject missing option values',()=>{
  assert.throws(()=>parseArgs(['prepare','--database','--work-dir','/x']),/Missing value/);
  assert.throws(()=>parseArgs(['prepare',...common,'--checksums']),/Missing value/);
 }],
 ['reject an apply missing its digest or execute flag',()=>{
  assert.throws(()=>parseArgs(apply.filter((_,i)=>i!==7&&i!==8)),/Required option: --plan-sha256/);
  assert.throws(()=>parseArgs(apply.slice(0,-1)),/Required option: --execute/);
 }],
 ['reject mutation options on verification',()=>assert.throws(()=>parseArgs(['verify',...common,'--execute']),/Unknown or repeated/)],
 ['reject missing database or an unsupported command',()=>{
  assert.throws(()=>parseArgs(['prepare','--work-dir','/x']),/Required option: --database/);
  assert.throws(()=>parseArgs(['delete',...common]),/Expected prepare/);
 }]
];
for(const [name,run]of tests){run();console.log('PASS '+name);}
console.log(JSON.stringify({passed:tests.length,databaseConnections:0,filesystemWrites:0}));
