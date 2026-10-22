'use strict';
// Calls the tested exported operation directly. The original sealed tool's CLI
// parser rejects digits in --plan-sha256; do not change its source identity during
// an active sealed window. This adapter changes no plan or mutation behaviour.
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const api='/storage/www/komondor-api',pack='/storage/komondor-project2178-20261022',work=pack+'/execution';
process.env.KOMONDOR_API_ROOT=api;
const m=require(api+'/node_modules/mongoose'),mig=require(api+'/lib/archive-reconciliation'),op=require('./operation.cjs'),{BSON}=require(api+'/node_modules/bson'),bson=new BSON();
m.set('autoIndex',false);m.set('autoCreate',false);require(api+'/node_modules/dotenv').config({path:api+'/.env'});
(async()=>{
 assert(process.argv.includes('--execute'));
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 const db=m.connection.db;assert.equal(db.databaseName,'komondor');const [info]=await db.listCollections({name:'projects'}).toArray();
 const databaseIdentity={name:db.databaseName,host:m.connection.host,port:m.connection.port,collectionUuid:info?.info?.uuid?.toString('hex')};
 const digest='f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b',receipt=JSON.parse(fs.readFileSync(pack+'/quiescence.json'));
 const applied=await op.apply({db,databaseIdentity,datastoreRoot:process.env.DATASTORE_ROOT,workDir:work,actor:'deeks',expectedSha256:digest,backupPlan:pack+'/approved-plan.json',receipt,execute:true});
 const plan=JSON.parse(fs.readFileSync(work+'/plan.json')),execution=JSON.parse(fs.readFileSync(work+'/execution.json')),docs=[];
 for(const item of plan.operations){const doc=await db.collection(item.collection).findOne({_id:new m.Types.ObjectId(item.id)});assert(mig.equal(doc,mig.materialize(plan,item,new Date(execution.at),digest)));docs.push(bson.serialize(doc));}
 const bytes=Buffer.concat(docs);fs.writeFileSync(pack+'/after-documents.bson',bytes,{flag:'wx',mode:0o600});
 const result={...applied,runId:receipt.windowRunId,afterDocumentsBytes:bytes.length,afterDocumentsSha256:crypto.createHash('sha256').update(bytes).digest('hex'),note:'Exported operation applied; independently verify the returned BSON before requesting service recovery.'};
 fs.writeFileSync(pack+'/applied-verified.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>m.disconnect());
