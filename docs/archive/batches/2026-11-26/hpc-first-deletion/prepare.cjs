'use strict';
// Refresh one reviewed target. Prints evidence only; never executes rm or finalizes.
const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
const {connect,createAws,api}=require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli=require(api+'/lib/s3-archive/cli');
const {resolveHpcPreservation}=require(api+'/lib/hpc-preservation');
const id='5fc012bda3efcb29338b7d30',vm='/mnt/reads/skamoun/halioticida_haliocrustida',hpc='/tsl/data/reads/skamoun/halioticida_haliocrustida';
let c;
(async()=>{
 const review='/storage/komondor-deletion-review-20261126-02';
 const reg=JSON.parse(fs.readFileSync(review+'/register.json')).projects.find(p=>p.projectId===id);
 const holds=JSON.parse(fs.readFileSync(review+'/holds.json'));assert(!holds.excludedProjectIds.includes(id));
 const ready=JSON.parse(fs.readFileSync(review+'/'+id+'/final-check-r2.json'));assert(ready.passed&&ready.hpcPath===hpc);
 c=await connect();const mount=JSON.parse(cp.execFileSync('findmnt',['-J','-T','/mnt/reads','-o','TARGET,SOURCE,FSTYPE'],{encoding:'utf8'})).filesystems[0];
 assert.equal(mount.target,'/mnt/reads');assert.equal(mount.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(mount.fstype.startsWith('nfs'));
 const raw=await c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId(id)});assert(raw);assert.equal(raw.path,'/skamoun/halioticida_haliocrustida');assert.equal(raw.archiveMigration.sourceRoot,vm);assert.equal(String(raw.archiveMigration.id),reg.migrationId);
 assert.equal(raw.archiveMigration.manifests.sourceSha256,reg.sourceSha256);assert.equal(raw.archiveMigration.manifests.verificationSha256,reg.verificationSha256);
 const hold=resolveHpcPreservation(raw);assert(!hold.active&&!hold.invalid);assert.equal(fs.realpathSync(vm),vm);
 const malformed=await c.models.Project.collection.find({$expr:{$not:[{$in:[{$type:'$preserveOnHpcUntil'},['date','null','missing']]}]}},{projection:{_id:1}}).toArray();assert.equal(malformed.length,0);
 const gargy=await c.models.Project.collection.findOne({_id:new c.mongoose.Types.ObjectId('5fc012bda3efcb29338b7d58')});const gargyHold=resolveHpcPreservation(gargy);assert(gargyHold.active&&!gargyHold.invalid);
 const aws=createAws(c.config),commands=[];
 for(const command of ['status','deletion-command']){
  let stdout='',stderr='';const args=[command,'--project-id',id,...(command==='status'?['--json']:[])];
  const exitCode=await cli.runCli(args,{...c,aws,stdout:s=>stdout+=s,stderr:s=>stderr+=s});commands.push({args,exitCode,stdout,stderr});assert.equal(exitCode,0,stderr);assert.equal(stderr,'');
  if(command==='status'){const status=JSON.parse(stdout);assert.equal(status.state,'aws_pending_hpc_deletion');assert.equal(status.phase,'verified');assert(!status.hpcPreservationActive&&!status.hpcPreservationInvalid);}
  else assert.equal(stdout.split('\n').filter(s=>s.startsWith('rm -rf -- '))[0],"rm -rf -- '"+vm+"'");
 }
 const at=new Date().toISOString(),receipt={at,projectId:id,name:raw.name,createdAt:raw.createdAt||null,files:reg.fileCount,bytes:reg.bytes,vmPath:vm,hpcPath:hpc,migrationId:reg.migrationId,s3Uri:reg.s3Uri,s3VerifiedAt:reg.s3VerifiedAt,preservation:hold,gargyPreservation:gargyHold,manualExclusions:holds.excludedProjectIds,mount,apiHead:c.toolVersion,commands,deletionPerformed:false,finalizationPerformed:false};
 const pack='/storage/komondor-hpc-first-deletion-'+at.replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');fs.mkdirSync(pack,{mode:0o700});receipt.serverEvidence=pack;fs.writeFileSync(pack+'/prepared.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(c)await c.mongoose.disconnect();});
