// Compiled in memory on v1333. Reads only; all emitted evidence is stored on the Mac.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fields = names => Object.fromEntries(names.split(' ').map(n=>[n,1]));
const id = value => String(value);
const ids = rows => rows.map(r=>r._id);
const snapshot = s => Object.fromEntries(['dev','ino','size','mtimeMs','ctimeMs','mode','uid','gid','nlink'].map(k=>[k,s[k]]));
const same = (a,b) => ['dev','ino','size','mtimeMs','ctimeMs','mode','uid','gid','nlink'].every(k=>a[k]===b[k]);
async function emit(record) {
  if (!process.stdout.write(JSON.stringify(record)+'\n')) await new Promise(resolve=>process.stdout.once('drain',resolve));
}
async function hashCurrent(root, entry) {
  if (!entry.relPath || path.isAbsolute(entry.relPath) || entry.relPath.split('/').some(p=>!p||p==='.'||p==='..')) throw Error('Unsafe file path');
  const absolute=path.join(root,entry.relPath);
  if (await fs.promises.realpath(absolute)!==absolute) throw Error('Symlinked file path');
  const handle=await fs.promises.open(absolute,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const startedAt=new Date().toISOString();
  try {
    const before=await handle.stat();
    if (!before.isFile() || !same(entry,before)) throw Error('File changed since inventory');
    const md5=crypto.createHash('md5'),sha=crypto.createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:4*1024*1024})) {md5.update(chunk);sha.update(chunk);bytes+=chunk.length;}
    const after=await handle.stat(), namedAfter=await fs.promises.lstat(absolute);
    if(bytes!==before.size||!same(before,after)||!same(after,namedAfter)||await fs.promises.realpath(absolute)!==absolute) throw Error('File changed while hashing');
    return {canonicalPath:absolute,bytes,md5:md5.digest('hex'),sha256:sha.digest('hex'),startedAt,observedAt:new Date().toISOString(),stable:true,identity:snapshot(after),byteScope:'physical-file-as-stored',purpose:'current-baseline-only',historicalVerification:'not-established'};
  } finally {await handle.close();}
}
async function run(payload) {
  const repositoryRoot='/storage/www/komondor-api';
  if(payload.repositoryRoot!==repositoryRoot || !['inventory','hash'].includes(payload.mode)) throw Error('Unexpected read-only mode/root');
  require(repositoryRoot+'/node_modules/dotenv').config({path:repositoryRoot+'/.env'});
  if(process.env.DATASTORE_ROOT!=='/mnt/reads') throw Error('Unexpected datastore root');
  const {walkTree}=require(repositoryRoot+'/lib/s3-archive/inventory');
  const {validateProjectRoot}=require(repositoryRoot+'/lib/s3-archive/preflight');
  const git=(...args)=>execFileSync('git',args,{cwd:repositoryRoot,encoding:'utf8'}).trim();
  const gitBefore={commit:git('rev-parse','HEAD'),status:git('status','--porcelain')};
  const mount=JSON.parse(execFileSync('findmnt',['-J','-T','/mnt/reads','-o','TARGET,SOURCE,FSTYPE,OPTIONS'],{encoding:'utf8'}));
  const mountRow=mount.filesystems?.[0];
  if(!mountRow||!['nfs','nfs4'].includes(mountRow.fstype)||mountRow.target!=='/mnt/reads') throw Error('Expected /mnt/reads NFS mount is not present');
  await emit({type:'start',at:new Date().toISOString(),host:require('os').hostname(),operator:require('os').userInfo().username,mode:payload.mode,gitBefore,mount,collectorSha256:sha256(payload.source),moduleSha256:Object.fromEntries(['lib/s3-archive/inventory.js','lib/s3-archive/preflight.js'].map(f=>[f,sha256(fs.readFileSync(repositoryRoot+'/'+f))])),productionWrites:false});
  if(payload.mode==='hash') {
    let completed=0,errors=0,totalBytes=0;
    for(const target of payload.targets) {
      const root=await validateProjectRoot({datastoreRoot:'/mnt/reads'},{path:target.root.replace(/^\/mnt\/reads/,'')});
      for(const entry of target.files) {
        try {const result=await hashCurrent(root.sourceRoot,entry);await emit({type:'checksum',entryId:target.entryId,relPath:entry.relPath,...result});completed++;totalBytes+=result.bytes;}
        catch(error){errors++;await emit({type:'checksum-error',entryId:target.entryId,relPath:entry.relPath,error:error.message});}
      }
    }
    await emit({type:'complete',at:new Date().toISOString(),completed,errors,totalBytes,gitAfter:{commit:git('rev-parse','HEAD'),status:git('status','--porcelain')},productionWrites:false});
    return;
  }
  const mongoose=require(repositoryRoot+'/node_modules/mongoose');
  mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
  const {resolveMongoUri}=require(repositoryRoot+'/lib/utils/validateEnv');
  await mongoose.connect(resolveMongoUri(process.env),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
  const variants=values=>values.flatMap(v=>/^[a-f0-9]{24}$/i.test(String(v))?[v,String(v),new mongoose.Types.ObjectId(String(v))]:[v,String(v)]);
  const get=(name,filter,projection)=>mongoose.connection.db.collection(name).find(filter,{projection}).sort({_id:1}).toArray();
  const projectFields=fields('_id name safeName path owner secondaryOwner group storage nudgeable doNotSendToEna oldId oldSafeName');
  const sampleFields=fields('_id name safeName path project owner group scientificName oldId');
  const runFields=fields('_id name safeName path sample owner group status md5VerificationStatus oldId sequencingProvider sequencingTechnology librarySource libraryType librarySelection libraryStrategy');
  const fileFields=fields('_id name originalName path type description oldParentID oldReadId oldAdditionalFileId uploadMethod');
  const readFields=fields('_id run file MD5 destinationMd5 md5Mismatch MD5LastChecked paired sibling oldReadId oldRunID');
  const additionalFields=fields('_id project sample run file MD5 MD5LastChecked oldAdditionalFileId');
  const allProjects=await get('projects',{},projectFields);
  const groups=await get('groups',{},fields('_id name safeName isDeleted deleted'));
  await emit({type:'context',groups,projectIdentityIndex:allProjects.map(p=>({_id:p._id,path:p.path,name:p.name,safeName:p.safeName,oldId:p.oldId}))});
  const unixOwners=new Map();let completed=0,errors=0;
  try {
    for(const target of payload.targets) {
      const startedAt=new Date().toISOString();
      try {
        const project=target.projectId?allProjects.find(p=>id(p._id)===target.projectId):null;
        const rootPath=target.observedPhysicalRoot;
        if(typeof rootPath!=='string'||!rootPath.startsWith('/mnt/reads/'))throw Error('Missing expected physical root');
        const environment=await validateProjectRoot({datastoreRoot:'/mnt/reads'},{path:rootPath.slice('/mnt/reads'.length)},{requireExists:false});
        let rootStat=null,inventory=null;
        if(environment.exists){rootStat=snapshot(await fs.promises.lstat(environment.sourceRoot));inventory=await walkTree(environment.sourceRoot);}
        if(rootStat&&!unixOwners.has(rootStat.uid)) {
          try{const line=execFileSync('getent',['passwd',String(rootStat.uid)],{encoding:'utf8',timeout:10000}).trim();const parts=line.split(':');unixOwners.set(rootStat.uid,parts.length>=3?{uid:Number(parts[2]),username:parts[0]}:null);}catch{unixOwners.set(rootStat.uid,null);}
        }
        const samples=project?await get('samples',{project:{$in:variants([project._id])}},sampleFields):[];
        const runs=samples.length?await get('runs',{sample:{$in:variants(ids(samples))}},runFields):[];
        const reads=runs.length?await get('reads',{run:{$in:variants(ids(runs))}},readFields):[];
        const additional=project?await get('additionalfiles',{$or:[{project:{$in:variants([project._id])}},{sample:{$in:variants(ids(samples))}},{run:{$in:variants(ids(runs))}}]},additionalFields):[];
        const referenced=[...reads,...additional].map(r=>r.file).filter(Boolean);
        const prefixes=[project?.path,rootPath.slice('/mnt/reads'.length)].filter(Boolean).map(p=>p.replace(/^\/+|\/+$/g,''));
        const files=await get('files',{$or:[{_id:{$in:variants(referenced)}},...prefixes.map(p=>({path:{$regex:'^/?'+escapeRegex(p)+'/'}}))]},fileFields);
        const activeIngest=runs.length?await get('ingestjobs',{runId:{$in:variants(ids(runs))},status:{$in:['pending','claimed']}},fields('_id runId status')):[];
        const outsideReads=files.length?await get('reads',{file:{$in:variants(ids(files))},_id:{$nin:ids(reads)}},fields('_id run file')):[];
        const outsideAdditional=files.length?await get('additionalfiles',{file:{$in:variants(ids(files))},_id:{$nin:ids(additional)}},fields('_id project sample run file')):[];
        const dbBefore={project,samples,runs,reads,additional,files};
        const claims=allProjects.filter(p=>p.path&&prefixes.includes(p.path.replace(/^\/+|\/+$/g,''))).map(p=>({_id:p._id,path:p.path,owner:p.owner}));
        await emit({type:'project',entryId:target.entryId,startedAt,finishedAt:new Date().toISOString(),expectedProjectId:target.projectId,expectedRegisteredPath:target.registeredPath,physicalRoot:rootPath,rootExists:environment.exists,rootStat,unixOwner:rootStat?unixOwners.get(rootStat.uid):null,projectClaims:claims,database:dbBefore,databaseObservationSha256:sha256(JSON.stringify(dbBefore)),activeIngest,outsideReads,outsideAdditional,inventory,hashesCalculated:false,productionWrites:false,observationIsAtomic:false});
        completed++;
      }catch(error){errors++;await emit({type:'project-error',entryId:target.entryId,at:new Date().toISOString(),error:error.message});}
    }
  } finally {await mongoose.disconnect();}
  await emit({type:'complete',at:new Date().toISOString(),completed,errors,gitAfter:{commit:git('rev-parse','HEAD'),status:git('status','--porcelain')},productionWrites:false});
}
module.exports={run,hashCurrent};
