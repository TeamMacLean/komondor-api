'use strict';
// Records George's reported manual deletion using the native confirmation workflow.
// Never removes filesystem data or changes S3 objects.
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
const {connect,createAws,api,sha}=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli=require(api+'/lib/s3-archive/cli');
const {projectStorageLocations}=require(api+'/lib/project-storage-locations');
const {collectProjectDatabase}=require(api+'/lib/s3-archive/preflight');
const id='5fc012bda3efcb29338b7d4b',vm='/mnt/reads/jjones/plant_capture_enhancer';
let c,pack;
const save=(name,value)=>fs.writeFileSync(pack+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function mountAndAbsence(){const mount=JSON.parse(cp.execFileSync('findmnt',['-J','-T','/mnt/reads','-o','TARGET,SOURCE,FSTYPE'])).filesystems[0];assert.equal(mount.target,'/mnt/reads');assert.equal(mount.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(mount.fstype.startsWith('nfs'));assert(fs.statSync('/mnt/reads/jjones').isDirectory());assert.throws(()=>fs.lstatSync(vm),{code:'ENOENT'});return mount;}
(async()=>{
 assert.deepEqual(process.argv.slice(2),['--execute-reported-deletion']);
 const at=new Date().toISOString();pack='/storage/komondor-plant-capture-confirm-'+at.replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');fs.mkdirSync(pack,{mode:0o700});
 c=await connect();const before=await c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId(id)});
 const review=JSON.parse(fs.readFileSync('/storage/komondor-deletion-review-20261126-02/register.json')).projects.find(p=>p.projectId===id);
 assert.equal(before.path,'/jjones/plant_capture_enhancer');assert.equal(before.storage.state,'aws_pending_hpc_deletion');assert.equal(before.archiveMigration.phase,'verified');assert.equal(before.archiveMigration.sourceRoot,vm);assert.equal(String(before.archiveMigration.id),review.migrationId);
 for(const key of ['sourceSha256','verificationSha256'])assert.equal(before.archiveMigration.manifests[key],review[key]);
 const user=await c.models.User.findOne({username:'deeks'}).lean();assert(user);assert.equal(user.name,'George Deeks');
 const mount=mountAndAbsence();const dbBefore=await collectProjectDatabase(c.models,id);save('before.json',{at,mount,project:before,database:dbBefore,operator:{username:user.username,name:user.name},reportedManualDeletion:true});
 const aws=createAws(c.config),commands=[];
 for(const execute of [false,true]){
  mountAndAbsence();let stdout='',stderr='';const args=['confirm-absent','--project-id',id,'--confirmed-by','deeks',...(execute?['--execute']:[])];
  const exitCode=await cli.runCli(args,{...c,aws,stdout:s=>stdout+=s,stderr:s=>stderr+=s});const receipt={at:new Date().toISOString(),args,exitCode,stdout,stderr};save(execute?'confirmation.json':'dry-run.json',receipt);commands.push(receipt);assert.equal(exitCode,0,stderr);assert.equal(stderr,'');
 }
 let stdout='',stderr='';const exitCode=await cli.runCli(['status','--project-id',id,'--json'],{...c,aws,stdout:s=>stdout+=s,stderr:s=>stderr+=s});save('status.json',{exitCode,stdout,stderr});assert.equal(exitCode,0,stderr);assert.equal(stderr,'');const status=JSON.parse(stdout);assert.equal(status.state,'aws');assert.equal(status.phase,'completed');assert.equal(status.hpcExists,false);
 const after=await c.models.Project.collection.findOne({_id:before._id});assert.equal(after.storage.s3VerifiedAt.toISOString(),before.storage.s3VerifiedAt.toISOString());assert.equal(after.storage.s3Uri,before.storage.s3Uri);assert.equal(after.archiveMigration.confirmedAbsentBy,'deeks');
 const dbAfter=await collectProjectDatabase(c.models,id);assert.equal(sha(Buffer.from(JSON.stringify(dbBefore))),sha(Buffer.from(JSON.stringify(dbAfter))),'Associated database records changed');
 const locations=await projectStorageLocations(after,{datastoreRoot:'/mnt/reads',readsRoot:'/tsl/data/reads'});assert.equal(locations.hpc.status,'absent');assert.equal(locations.aws.status,'verified');
 const result={at:new Date().toISOString(),projectId:id,name:after.name,operator:'deeks',mount:mountAndAbsence(),storage:after.storage,phase:after.archiveMigration.phase,locations,counts:Object.fromEntries(Object.entries(dbAfter).map(([k,v])=>[k,v.length])),associatedRecordsUnchanged:true,serverEvidence:pack,commands};save('completed.json',result);console.log(JSON.stringify(result,null,2));
})().catch(e=>{if(pack)save('failure.json',{at:new Date().toISOString(),error:e.stack});console.error(e.stack);process.exitCode=1}).finally(async()=>{if(c)await c.mongoose.disconnect()});
