'use strict';
// Read-only scoped ENA review export after r3 reassignment. No submission.
const fs=require('fs'),fsp=require('fs/promises'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),cp=require('child_process');
const root=__dirname,api='/storage/www/komondor-api',node='/storage/.nvm/versions/node/v24.11.1/bin/node';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=n=>fs.readFileSync(path.join(root,n)),json=n=>JSON.parse(read(n));
async function linkedSequenceVerifier(options,{enaPreview,copyEvidenceDir,vmRoot}){
 const proof=await require('./exec/link-publication.cjs').verifyPublished(options);assert.equal(proof.publishedFiles,40);assert.equal(proof.retainedStageFiles,40);
 const checks=[];
 for(const row of enaPreview.sequenceFiles){
  const filename=path.join(vmRoot,row.proposedFilePath.replace(/^\//,''));assert.equal(filename,row.proposedV1333Path);
  const original=JSON.parse(await fsp.readFile(path.join(copyEvidenceDir,'file-'+row.fileId+'.json'),'utf8'));
  assert.equal(original.fileId,row.fileId);assert.equal(original.destination,filename);for(const k of ['bytes','sha256','crc64nvme']){assert.equal(original.sourceDigest[k],row[k]);assert.equal(original.destinationDigest[k],row[k]);}
  const receiptPath=path.join(options.publicationEvidenceDir,'file-linked-'+sha(JSON.stringify(row.fileId))+'.json'),bytes=await fsp.readFile(receiptPath),receipt=JSON.parse(bytes),{sha256,...body}=receipt;
  assert.equal(sha(JSON.stringify(body)),sha256);assert.equal(receipt.operationId,options.operationId);assert.equal(receipt.planSha256,options.planSha256);assert.equal(receipt.fileId,row.fileId);assert.equal(receipt.destination,filename);
  const st=await fsp.lstat(filename);assert(st.isFile()&&!st.isSymbolicLink());for(const k of ['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'])assert(k.endsWith('Ms')?Math.abs(st[k]-receipt.metadata[k])<=1:st[k]===receipt.metadata[k],'Linked FASTQ metadata changed: '+row.fileId+'/'+k);
  assert.equal(st.nlink,2);checks.push({fileId:row.fileId,path:filename,bytes:st.size,dev:st.dev,ino:st.ino,retainedStageLink:true,linkReceiptSha256:sha(bytes),payloadRehashed:false});
 }
 return checks;
}
async function main(){
 assert.equal(root,'/storage/komondor-gulnara-20261126-r3');assert.equal(require('os').userInfo().username,'deeks');assert.equal(process.argv.length,3);const outputName=process.argv[2];assert(/^ena-export-[a-zA-Z0-9_-]+$/.test(outputName));
 const ready=json('execution-ready.json');for(const[n,h]of Object.entries(ready.files))assert.equal(sha(read(n)),h,n);
 const verified=JSON.parse(cp.execFileSync(node,[root+'/runner-r3.cjs','verify'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024}));assert.equal(verified.files.allVerified,true);
 const config=json('config.json'),scope=json('scope.json'),copy=require('./exec/copy.cjs'),options={copyManifest:json('copy-manifest.json'),filesystemEvidence:json('filesystem-baseline.json'),scope,stageRoot:config.stageRoot,evidenceDir:root+'/copy-evidence',publicationEvidenceDir:root+'/publication-evidence',operationId:config.operationId,planSha256:config.planSha256,crcFactory:copy.createNodeCrcFactory(require(api+'/lib/utils/crc64nvme').Crc64Nvme)};
 const {MongoClient,ObjectId}=require(api+'/node_modules/mongodb'),BSON=require(api+'/node_modules/bson'),bson=new BSON(),prepared=json('db-evidence/prepared-plan.json');
 const beforeDocuments=Object.fromEntries(Object.entries(prepared.beforeSnapshot).map(([name,rows])=>[name,rows.map(r=>bson.deserialize(Buffer.from(r.bson,'base64')))]));
 const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});
 try{const result=await require('./exec/ena.cjs').runExport({db:client.db('komondor'),ObjectId,apiRoot:api,scope,changePlan:json('change-plan.json'),enaPreview:json('ena-fastq-preview.json'),beforeDocuments,copyEvidenceDir:root+'/copy-evidence',outputDir:root+'/'+outputName,physicalVerifier:args=>linkedSequenceVerifier(options,args)});console.log(JSON.stringify(result,null,2));}finally{await client.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={linkedSequenceVerifier};
