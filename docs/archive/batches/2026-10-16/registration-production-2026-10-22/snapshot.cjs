'use strict';
// Native-type before-images outside Git; compare all original documents after apply.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const api='/storage/www/komondor-api',pack='/storage/komondor-registration-20261022';
const reg=require(pack+'/release/lib/archive-registration');
const {BSON,ObjectId}=require(api+'/node_modules/bson');const bson=new BSON();
const m=require(api+'/node_modules/mongoose');m.set('autoIndex',false);m.set('autoCreate',false);
const digest='1aa44aeacc5ae4c921b6498fa56e82a0a35a68bd897bcd1bdd2b9a11dddff99d';
const plan=JSON.parse(fs.readFileSync(pack+'/work/plan.json'));
assert.equal(reg.sha256(fs.readFileSync(pack+'/work/plan.json')),digest);
const save=(name,value)=>fs.writeFileSync(pack+'/'+name,reg.encode(value),{flag:'wx',mode:0o600});
async function main(){
 const mode=process.argv[2];assert(['before','after'].includes(mode));
 const window=JSON.parse(fs.readFileSync('/storage/komondor-registration-window-20261022/paused.json'));
 assert.equal(window.planSha256,digest);assert(Date.parse(window.expiresAt)>Date.now()+60000,'Window expires too soon');
 await require(api+'/lib/s3-archive/preflight').apiAppearsStopped('http://127.0.0.1:3061/ready');
 require(api+'/node_modules/dotenv').config({path:api+'/.env'});
 await m.connect(require(api+'/lib/utils/validateEnv').resolveMongoUri(),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 try{
  const db=m.connection.db,collections=(await db.listCollections().toArray()).map(c=>c.name).sort(),result={at:new Date().toISOString(),runId:window.runId,planSha256:digest,collections:{}};
  if(mode==='before')fs.mkdirSync(pack+'/before-documents',{mode:0o700});
  for(const name of collections){
   assert(/^[A-Za-z0-9_-]+$/.test(name));
   const filter=mode==='after'&&name==='projects'?{_id:{$nin:plan.operations.map(o=>new ObjectId(o.projectId))}}:{};
   const docs=await db.collection(name).find(filter).sort({_id:1}).toArray();
   const bytes=Buffer.concat(docs.map(doc=>bson.serialize(doc)));
   const indexes=await db.collection(name).indexes();indexes.sort((a,b)=>a.name.localeCompare(b.name));
   result.collections[name]={count:docs.length,sha256:reg.sha256(bytes),bytes:bytes.length,indexesSha256:reg.sha256(reg.encode(indexes))};
   if(mode==='before')fs.writeFileSync(pack+'/before-documents/'+name+'.bson',bytes,{flag:'wx',mode:0o600});
  }
  if(mode==='after'){
   const before=JSON.parse(fs.readFileSync(pack+'/before-snapshot.json'));
   assert.equal(before.runId,window.runId);assert.deepEqual(result.collections,before.collections,'An original document, index, or collection changed');
   const created=await db.collection('projects').find({'registrationProvenance.planSha256':digest}).toArray();assert.equal(created.length,22);
   result.created=created.map(p=>({id:String(p._id),entryId:p.registrationProvenance.entryId,path:p.path,owner:p.owner,historyEvents:p.reconciliationHistory.length,nudgeable:p.nudgeable,doNotSendToEna:p.doNotSendToEna}));
   assert(result.created.every(p=>p.historyEvents===1&&p.nudgeable===false&&p.doNotSendToEna===true));
   const walk=require(api+'/lib/s3-archive/inventory').walkTree;
   for(const o of plan.operations){
    const stat=fs.lstatSync(o.observation.sourceRoot);
    for(const [key,value] of Object.entries(o.observation.rootStat))assert.equal(stat[key],value,'Root changed: '+o.target.entryId+' '+key);
    const current=await walk(o.observation.sourceRoot);assert(reg.encode(current.entries).equals(reg.encode(o.observation.entries)),'Tree changed: '+o.target.entryId);
   }
   result.originalDocumentsUnchanged=true;result.targetFilesystemMetadataUnchanged=true;
  }
  save(mode+'-snapshot.json',result);
  console.log(JSON.stringify({mode,collections:Object.keys(result.collections).length,originalDocuments:Object.values(result.collections).reduce((n,c)=>n+c.count,0),newProjects:result.created?.length||0,planSha256:digest}));
 }finally{await m.disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
