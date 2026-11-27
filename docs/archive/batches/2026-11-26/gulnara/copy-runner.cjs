'use strict';
// Detached copy stage only. Database reads, independent staged payload copies,
// and receipts; no DB mutation, service control, publication or S3 operation.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),os=require('os');
const pack=__dirname,api='/storage/www/komondor-api';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(pack,name)));
const save=(name,value)=>fs.writeFileSync(path.join(pack,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o640});
async function main(){
 assert.equal(os.hostname().split('.')[0],'v1333');assert.equal(os.userInfo().username,'deeks');
 assert.equal(pack,'/storage/komondor-gulnara-20261126');assert.deepEqual(process.argv.slice(2),['--execute-staged-copy']);
 process.umask(0o007);
 const config=read('config.json'),seal=read('copy-seal.json'),approval=read('copy-approval.json');
 const required=['config.json','scope.json','change-plan.json','copy-manifest.json','filesystem-baseline.json','copy-runner.cjs','db-preflight.cjs','fs-preflight.cjs','exec/copy.cjs','copy-approval.json'];
 for(const filename of required)assert(/^[a-f0-9]{64}$/.test(seal.files[filename]||''),'Missing sealed input: '+filename);
 for(const [name,digest]of Object.entries(seal.files)){
   assert(!name.includes('..')&&!path.isAbsolute(name));const p=path.join(pack,name),s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink());assert.equal(hash(fs.readFileSync(p)),digest,name);
 }
 assert.equal(hash(fs.readFileSync(path.join(pack,'change-plan.json'))),config.planSha256);
 assert.equal(hash(fs.readFileSync(api+'/lib/utils/crc64nvme.js')),config.crcImplementationSha256,'Checksum implementation changed');
 assert.equal(approval.operationId,config.operationId);assert.equal(approval.planSha256,config.planSha256);
 assert.equal(approval.externalWritersFrozen,true);assert.equal(approval.action,'independent-staged-copy');
 assert(!fs.existsSync(path.join(pack,'window-reopen.lock')));assert(!fs.existsSync(path.join(pack,'mutation.lock')));
 const lock=path.join(pack,'copy-worker.lock');fs.mkdirSync(lock,{mode:0o750});
 fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,operationId:config.operationId,startedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o640});
 const {MongoClient,ObjectId}=require(api+'/node_modules/mongodb');
 const {collectDatabase}=require('./db-preflight.cjs'),{inspectFilesystem}=require('./fs-preflight.cjs');
 const copy=require('./exec/copy.cjs'),scope=read('scope.json');
 const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});
 let succeeded=false;
 try{
   const db=await collectDatabase(client.db('komondor'),scope,ObjectId);save('copy-start-db.json',db);
   assert.equal(db.issues.length,0);assert.equal(db.notes.length,0);assert.equal(db.summary.proposedPathUpdates,64);
   const options={copyManifest:read('copy-manifest.json'),filesystemEvidence:read('filesystem-baseline.json'),scope,
     stageRoot:config.stageRoot,evidenceDir:path.join(pack,'copy-evidence'),operationId:config.operationId,planSha256:config.planSha256,
     crcFactory:copy.createNodeCrcFactory(require(api+'/lib/utils/crc64nvme').Crc64Nvme),
     inspectSource:()=>inspectFilesystem(scope),onProgress:x=>console.log(JSON.stringify({event:'copy-progress',...x}))};
   console.log(JSON.stringify({event:'copy-started',at:new Date().toISOString(),pid:process.pid,operationId:config.operationId,files:40,bytes:41432635417}));
   const receipt=await copy.stageCopy(options);assert.equal(receipt.files,40);assert.equal(receipt.bytes,41432635417);
   const after=await collectDatabase(client.db('komondor'),scope,ObjectId);save('copy-finish-db.json',after);
   assert.equal(after.issues.length,0);assert.equal(after.notes.length,0);
   assert.deepEqual(after.documents,db.documents,'Selected database records changed during copy');
   save('copy-stage-complete.json',{at:new Date().toISOString(),operationId:config.operationId,planSha256:config.planSha256,
     copyReceiptSha256:hash(fs.readFileSync(path.join(pack,'copy-evidence/copy-verified.json'))),allVerified:true,files:40,bytes:41432635417});
   succeeded=true;console.log(JSON.stringify({event:'copy-complete',at:new Date().toISOString(),files:40,bytes:41432635417}));
 }finally{
   await client.close();
   if(succeeded){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}
 }
}
main().catch(error=>{console.error(error.stack);try{save('copy-failed-'+Date.now()+'.json',{at:new Date().toISOString(),pid:process.pid,error:error.message});}catch(_){}process.exitCode=1;});
