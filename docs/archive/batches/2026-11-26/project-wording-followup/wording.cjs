'use strict';
// Reviewed one-off administrative correction. Never use ordinary name saves:
// registered identity pins must agree with the wording in the same atomic write.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), assert=require('node:assert/strict');
const API=process.env.WORDING_API || '/storage/www/komondor-api';
const {MongoClient,ObjectId}=require(API+'/node_modules/mongodb');
const BSON=require(API+'/node_modules/bson'), bson=new BSON();
const {wholeDocumentFilter,TYPED}=require('./conditional-filter.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const enc=x=>bson.serialize(x), dec=x=>bson.deserialize(x,TYPED);
const clone=x=>dec(enc(x));
const equal=(a,b)=>assert.deepEqual(a,b);
const write=(p,x)=>fs.writeFileSync(p,x,{flag:'wx',mode:0o600});
const json=x=>JSON.stringify(x,null,2)+'\n';
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const APPROVED={"ntalbot-028": "Wheat blast assembly and gene analysis", "ntalbot-018": "Wheat blast isolate sequencing", "ntalbot-024": "Sequence assemblies and gene annotations", "ntalbot-037": "MG bulk read alignment", "ntalbot-040": "Buf mutant bulk segregant analysis", "ntalbot-044": "Guy11 paired-end read alignment", "ntalbot-050": "Mycelium RNA-seq expression tables"};
const selected=c=>APPROVED[c.entryId]===c.proposedTitle;
function build(before,c,digest,at){
 assert.equal(String(before._id),c.projectId); assert.equal(before.registrationProvenance?.entryId,c.entryId);
 for(const [field,key] of Object.entries({name:'recordedName',safeName:'recordedSafeName',path:'recordedPath',shortDesc:'recordedShortDesc',longDesc:'recordedLongDesc'}))assert.equal(before[field],c[key],field+' changed');
 assert(!before.reconciliation,'Unexpected additional reconciliation state; review required');
 assert.equal(before.storage?.state,'aws_pending_hpc_deletion');assert.equal(before.archiveMigration?.phase,'verified');
 require(API+'/lib/project-registration-history').assertRegistrationIdentity(bson.deserialize(enc(before)));
 assert(before.reconciliationHistory?.some(e=>e.kind==='administrative-registration'&&e.after?.name===before.registrationProvenance.identity.name),'Original registration name is not retained');
 assert(c.proposedTitle?.trim()===c.proposedTitle && c.proposedTitle.length>0);
 assert(c.proposedShortDesc?.trim().length>0);
 const set={name:c.proposedTitle,shortDesc:c.proposedShortDesc,updatedAt:at};
 if(c.proposedLongDesc)set.longDesc=c.proposedLongDesc;
 let after=clone(before);Object.assign(after,set);
 if(after.name!==before.name){after.registrationProvenance.identity.name=after.name;set['registrationProvenance.identity.name']=after.name;}
 const changes=Object.fromEntries(['name','shortDesc','longDesc'].filter(f=>after[f]!==before[f]).map(f=>[f,{before:before[f],after:after[f]}]));
 assert(Object.keys(changes).length);
 const event={version:1,kind:'administrative-project-wording',operationId:'project-wording-followup-20261126:'+c.projectId,at,actor:'deeks',decisionAuthority:'George, archive chat, 26 November 2026: explicitly approve all seven conservative follow-up names',reason:'Scientific display wording from retained source notes; preserve physical identity',planSha256:digest,beforeBsonSha256:sha(enc(before)),changes,registrationNamePin:{before:before.registrationProvenance.identity.name,after:after.registrationProvenance.identity.name},sourceEvidence:c.evidence};
 after.reconciliationHistory.push(event);after=clone(after);
 const unchanged=clone(after);for(const f of ['name','shortDesc','longDesc','updatedAt'])unchanged[f]=before[f];unchanged.registrationProvenance.identity.name=before.registrationProvenance.identity.name;unchanged.reconciliationHistory=before.reconciliationHistory;
 equal(unchanged,before);
 require(API+'/lib/project-registration-history').assertRegistrationIdentity(bson.deserialize(enc(after)));
 return {after,set,event};
}
async function validateModel(p){
 const Project=require(API+'/models/Project');
 const doc=Project.hydrate(bson.deserialize(enc(p)));await doc.validate();
 assert.equal(doc.name,p.name);assert.equal(doc.path,p.path);assert.equal(doc.safeName,p.safeName);
 const publicDoc=doc.toJSON(); assert.equal(publicDoc.name,p.name);assert.equal(publicDoc.shortDesc,p.shortDesc);assert.equal(publicDoc.longDesc,p.longDesc);
 assert(!publicDoc.registrationProvenance);return publicDoc;
}
async function inventory(db,projects){
 const out={},projectIds=projects.map(p=>p._id),known={};
 const roots=projects.map(p=>({path:{$regex:'^'+p.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)'}}));
 for(const name of ['samples','runs','files','reads','additionalfiles']){
  const clauses=[...roots,{project:{$in:projectIds}}];
  if(known.samples)clauses.push({sample:{$in:known.samples}});
  if(known.runs)clauses.push({run:{$in:known.runs}});
  if(known.files)clauses.push({file:{$in:known.files}});
  const docs=await db.collection(name).find({$or:clauses},{...TYPED}).sort({_id:1}).toArray();
  known[name]=docs.map(d=>d._id);out[name]={count:docs.length,sha256:sha(enc({docs}))};
 }
 return out;
}
async function links(db,projects){
 const {fileUri}=require(API+'/lib/physical-file-path');const all=[];
 for(const p of projects){
  const files=await db.collection('files').find({path:{$regex:'^'+p.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/'}},{projection:{path:1}}).sort({_id:1}).toArray();
  assert(files.length,'No files under '+p.path);
  for(const f of files){const uri=fileUri(p,f);assert(uri && uri.startsWith(p.storage.s3Uri+'/'),'Unexpected file URI');all.push({projectId:String(p._id),fileId:String(f._id),path:f.path,uri});}
  const st=fs.lstatSync('/mnt/reads'+p.path);assert(st.isDirectory()&&!st.isSymbolicLink());
 }
 return {count:all.length,sha256:sha(Buffer.from(json(all)))};
}
async function main(){
 const [mode,dir,expected]=process.argv.slice(2);assert(['prepare','apply','verify'].includes(mode));assert(path.isAbsolute(dir));
 assert.equal(require('os').hostname().split('.')[0],'v1333');assert.equal(require('os').userInfo().username,'deeks');
 const client=await MongoClient.connect('mongodb://127.0.0.1:28015/komondor?directConnection=true',{useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:15000});
 try{const db=client.db('komondor'),collection=db.collection('projects');
 if(mode==='prepare'){
  const inputBytes=fs.readFileSync(path.join(dir,'candidates.json'));const input=JSON.parse(inputBytes);const chosen=input.candidates.filter(selected);assert.equal(chosen.length,7);
  const all=await collection.find({},TYPED).sort({_id:1}).toArray(); const before=chosen.map(c=>{const p=all.find(p=>String(p._id)===c.projectId);assert(p);return p});
  const titles=new Set();for(const c of chosen){const n=norm(c.proposedTitle);assert(!titles.has(n));titles.add(n);assert(!all.some(p=>String(p._id)!==c.projectId&&!chosen.some(q=>q.projectId===String(p._id))&&norm(p.name)===n));}
  const plan={version:1,preparedAt:new Date().toISOString(),inputSha256:sha(inputBytes),runnerSha256:sha(fs.readFileSync(__filename)),helperSha256:sha(fs.readFileSync(path.join(__dirname,'conditional-filter.cjs'))),candidates:chosen,beforeBson:enc({docs:before}).toString('base64'),inventory:await inventory(db,before),links:await links(db,before),projectCount:all.length};
  for(let i=0;i<chosen.length;i++){const next=build(before[i],chosen[i],'preview',new Date(plan.preparedAt));await validateModel(next.after);}
  const bytes=Buffer.from(json(plan));write(path.join(dir,'plan.json'),bytes);write(path.join(dir,'before.bson'),enc({docs:before}));
  console.log(json({prepared:true,projects:chosen.length,renamed:chosen.filter(c=>c.recordedName!==c.proposedTitle).length,planSha256:sha(bytes),inventory:plan.inventory,links:plan.links}));return;
 }
 const bytes=fs.readFileSync(path.join(dir,'plan.json')),digest=sha(bytes);assert.equal(digest,expected,'Reviewed plan digest mismatch');const plan=JSON.parse(bytes);
 assert.equal(sha(fs.readFileSync(__filename)),plan.runnerSha256);assert.equal(sha(fs.readFileSync(path.join(__dirname,'conditional-filter.cjs'))),plan.helperSha256);
 const before=dec(Buffer.from(plan.beforeBson,'base64')).docs;assert.equal(plan.candidates.length,7);assert(plan.candidates.every(selected));assert.equal(new Set(plan.candidates.map(c=>c.entryId)).size,7);
 if(mode==='apply'){
  assert(!fs.existsSync(path.join(dir,'execution.json')),'Execution exists; inspect partial state before recovery');
  const all=await collection.find({},TYPED).toArray();assert.equal(all.length,plan.projectCount);
  for(let i=0;i<before.length;i++){equal(all.find(p=>String(p._id)===String(before[i]._id)),before[i]);assert(!all.some(p=>String(p._id)!==String(before[i]._id)&&norm(p.name)===norm(plan.candidates[i].proposedTitle)));}
  equal(await inventory(db,before),plan.inventory);equal(await links(db,before),plan.links);
  const at=new Date(),changes=before.map((p,i)=>build(p,plan.candidates[i],digest,at));for(const c of changes)await validateModel(c.after);
  write(path.join(dir,'execution.json'),json({at,planSha256:digest,expectedAfterBson:enc({docs:changes.map(c=>c.after)}).toString('base64')}));
  for(let i=0;i<before.length;i++){
   const c=changes[i],result=await collection.updateOne(wholeDocumentFilter(before[i],[]),{$set:c.set,$push:{reconciliationHistory:c.event}});
   assert.equal(result.matchedCount,1,'Concurrent change; stopped at '+String(before[i]._id));
   equal(await collection.findOne({_id:before[i]._id},TYPED),c.after);
   fs.appendFileSync(path.join(dir,'journal.jsonl'),json({at:new Date(),projectId:String(before[i]._id),status:'verified'}).replace(/\n\s*/g,'')+'\n',{mode:0o600});
  }
 }
 const execution=JSON.parse(fs.readFileSync(path.join(dir,'execution.json')));assert.equal(execution.planSha256,digest);
 const expectedAfter=dec(Buffer.from(execution.expectedAfterBson,'base64')).docs;const after=[];
 for(const p of expectedAfter){const current=await collection.findOne({_id:p._id},TYPED);equal(current,p);await validateModel(current);after.push(current);}
 equal(await inventory(db,after),plan.inventory);equal(await links(db,after),plan.links);
 const receipt={at:new Date().toISOString(),planSha256:digest,projects:after.length,renamed:after.filter((p,i)=>p.name!==before[i].name).length,modelValidationPassed:true,allOtherProjectFieldsUnchanged:true,priorAuditHistoryUnchanged:true,dependentRecords:plan.inventory,fileLocations:plan.links,retainedHpcRoots:after.length,productionCodeChanged:false,results:after.map((p,i)=>({projectId:String(p._id),oldName:before[i].name,name:p.name,path:p.path,s3Uri:p.storage.s3Uri,shortDesc:p.shortDesc}))};
 write(path.join(dir,mode==='apply'?'completed.json':'verified-'+Date.now()+'.json'),json(receipt));write(path.join(dir,mode==='apply'?'after.bson':'verified-'+Date.now()+'.bson'),enc({docs:after}));console.log(json(receipt));
 }finally{await client.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1});
module.exports={build,selected};
