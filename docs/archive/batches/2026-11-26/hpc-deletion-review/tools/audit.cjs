'use strict';
// Read-only native deletion review. Never executes the printed deletion commands.
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), cp = require('child_process');
const {connect, createAws, api, sha} = require('/storage/komondor-archive-batch-20261023/common-r10.cjs');
const cli = require(api + '/lib/s3-archive/cli');
const {resolveHpcPreservation} = require(api + '/lib/hpc-preservation');
const root = __dirname, read = p => JSON.parse(fs.readFileSync(p));
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
const register = read(root + '/register.json'), holds = read(root + '/holds.json');
assert.equal(sha(fs.readFileSync(root + '/register.json')), holds.sourceRegisterSha256);
assert.equal(register.projects.length,175);
const excluded = new Set(holds.excludedProjectIds);
assert.equal(excluded.size,5);
let context;
function mount(){const v=JSON.parse(cp.execFileSync('findmnt',['-J','-T','/mnt/reads','-o','TARGET,SOURCE,FSTYPE'],{encoding:'utf8'})).filesystems[0];assert.equal(v.target,'/mnt/reads');assert.equal(v.source,'nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads');assert(v.fstype.startsWith('nfs'));return v;}
function identity(r,p){
 assert(p);assert.equal(String(p._id),r.projectId);assert.equal(p.path,'/'+r.hpcPath.slice('/mnt/reads/'.length));
 assert.equal(p.storage.state,'aws_pending_hpc_deletion');assert.equal(p.archiveMigration.phase,'verified');
 assert.equal(String(p.archiveMigration.id),r.migrationId);assert.equal(p.archiveMigration.sourceRoot,r.hpcPath);
 assert.equal(p.storage.s3Uri,r.s3Uri);assert.equal(new Date(p.storage.s3VerifiedAt).toISOString(),r.s3VerifiedAt);
 for(const k of ['sourceSha256','verificationSha256','sourceS3Uri','verificationS3Uri'])assert.equal(p.archiveMigration.manifests[k],r[k],k);
 assert.equal(p.archiveMigration.manifests.fileCount,r.fileCount);assert.equal(p.archiveMigration.manifests.totalBytes,r.bytes);
 assert.equal(fs.realpathSync(r.hpcPath),r.hpcPath);assert(fs.lstatSync(r.hpcPath).isDirectory());
 return resolveHpcPreservation(p);
}
function client(id){
 const aws=createAws(context.config),run=aws.run.bind(aws),get=aws.getObjectBuffer.bind(aws),head=aws.headObject.bind(aws);
 const allowed=new Set(['sts get-caller-identity','s3api head-bucket','s3api get-bucket-versioning','s3api get-bucket-lifecycle-configuration','s3api head-object','s3api list-objects-v2','s3api list-multipart-uploads']);
 aws.run=(args,opts)=>{assert(allowed.has(args.slice(0,2).join(' '))||args[0]==='--version'||args.at(-1)==='help','Unexpected AWS operation');return run(args,opts);};
 aws.getObjectBuffer=async key=>{assert(key.startsWith('_control/projects/'+id+'/'));const b=await get(key);fs.writeFileSync(root+'/'+id+'/'+path.basename(key),b,{flag:'wx',mode:0o600});return b;};
 aws.headObject=async key=>{const h=await head(key);fs.appendFileSync(root+'/'+id+'/heads.jsonl',JSON.stringify({at:new Date().toISOString(),key,head:h})+'\n',{mode:0o600});return h;};
 return aws;
}
(async()=>{
 assert.deepEqual(process.argv.slice(2),['--audit']);
 context=await connect();const initialMount=mount();
 const all=await context.models.Project.collection.find({},{projection:{name:1,path:1,preserveOnHpcUntil:1,storage:1,archiveMigration:1}}).toArray();
 const invalid=all.filter(p=>resolveHpcPreservation(p).invalid).map(p=>({id:String(p._id),name:p.name}));assert.equal(invalid.length,0,'Malformed preservation dates');
 const scoped=register.projects.map(r=>{const p=all.find(p=>String(p._id)===r.projectId),hold=identity(r,p);assert(!hold.invalid);return {...r,name:p.name,preserveOnHpcUntil:hold.until,excluded:excluded.has(r.projectId)||hold.active};});
 for(const r of scoped.filter(r=>!r.excluded))for(const p of all){if(String(p._id)===r.projectId||!p.path)continue;const a=r.hpcPath.slice('/mnt/reads'.length),b=p.path.replace(/\/$/,'');assert(!(a===b||a.startsWith(b+'/')||b.startsWith(a+'/')),'Overlapping project roots '+r.projectId+' '+p._id);}
 const pilot=read('/storage/komondor-pilot-plant-capture-20261023/restore-verified.json');assert.equal(sha(fs.readFileSync('/storage/komondor-pilot-plant-capture-20261023/restore-verified.json')),'025298af6f0246992591c01a121ba3af9e4fa1f673abeb0d7ee8cbab7ab038e7');assert(pilot.verified);
 save('preflight.json',{at:new Date().toISOString(),apiHead:context.toolVersion,mount:initialMount,invalidPreservationDates:invalid,projects:scoped,pilot});
 const queue=scoped.filter(r=>!r.excluded).sort((a,b)=>b.fileCount-a.fileCount),results=[];let next=0;
 async function worker(){while(next<queue.length){const r=queue[next++],id=r.projectId;fs.mkdirSync(root+'/'+id,{mode:0o700});const startedAt=new Date().toISOString();let stdout='',stderr='',result;
  try{mount();const aws=client(id);const uploads=await aws.listMultipartUploads(r.hpcPath.slice('/mnt/reads/'.length));assert.equal(uploads.length,0,'Incomplete multipart upload');
   const exitCode=await cli.runCli(['deletion-command','--project-id',id],{...context,aws,stdout:s=>stdout+=s,stderr:s=>stderr+=s});
   result={projectId:id,startedAt,finishedAt:new Date().toISOString(),exitCode,stdout,stderr};
   if(exitCode===0){const sourceFile='source-manifest.v1.json';const m=read(root+'/'+id+'/'+sourceFile);assert.equal(sha(fs.readFileSync(root+'/'+id+'/'+sourceFile)),r.sourceSha256);const uncopied=m.entries.filter(e=>e.disposition!=='copy');result.uncopied=uncopied;result.reviewPassed=!stderr.trim()&&!uncopied.length;assert.equal(stdout.split('\n').filter(s=>s.startsWith('rm -rf -- ')).length,1);}
  }catch(e){result={projectId:id,startedAt,finishedAt:new Date().toISOString(),exitCode:1,stdout,stderr,error:e.stack,reviewPassed:false};}
  save(id+'/result.json',result);results.push(result);console.log(JSON.stringify({at:new Date().toISOString(),done:results.length,total:queue.length,id,exitCode:result.exitCode,reviewPassed:result.reviewPassed,error:result.error||result.stderr||null}));
 }}
 await Promise.all(Array.from({length:8},worker));
 const final=[];for(const r of scoped){const p=await context.models.Project.collection.findOne({_id:new context.mongoose.Types.ObjectId(r.projectId)});const hold=identity(r,p);final.push({projectId:r.projectId,name:p.name,preservation:hold});}
 save('summary.json',{at:new Date().toISOString(),mount:mount(),apiHead:context.toolVersion,total:queue.length,passed:results.filter(r=>r.reviewPassed).length,failed:results.filter(r=>!r.reviewPassed).map(r=>r.projectId),finalProjects:final});
})().catch(e=>{console.error(e.stack);save('fatal.json',{at:new Date().toISOString(),error:e.stack});process.exitCode=1;}).finally(async()=>{if(context)await context.mongoose.disconnect();});
