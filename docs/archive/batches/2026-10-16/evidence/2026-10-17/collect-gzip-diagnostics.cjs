// Read-only diagnostic: does a recorded original MD5 describe decompressed bytes?
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const {Transform}=require('stream');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

async function hashGzip(absolute) {
 if(await fs.promises.realpath(absolute)!==absolute)throw Error('Symlink path');
 const handle=await fs.promises.open(absolute,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let input,meter,gunzip;
 try {
  const before=await handle.stat();if(!before.isFile())throw Error('Not a regular file');
  const physicalMd5=crypto.createHash('md5'),physicalSha=crypto.createHash('sha256'),decodedMd5=crypto.createHash('md5'),decodedSha=crypto.createHash('sha256');let physicalBytes=0,decodedBytes=0;
  input=handle.createReadStream({autoClose:false,highWaterMark:4*1024*1024});
  meter=new Transform({transform(chunk,encoding,next){physicalBytes+=chunk.length;physicalMd5.update(chunk);physicalSha.update(chunk);next(null,chunk);}});
  gunzip=zlib.createGunzip();input.on('error',e=>gunzip.destroy(e));meter.on('error',e=>gunzip.destroy(e));input.pipe(meter).pipe(gunzip);
  for await(const chunk of gunzip){decodedBytes+=chunk.length;if(decodedBytes>Math.max(10*1024**3,before.size*200))throw Error('Decoded-size diagnostic limit exceeded');decodedMd5.update(chunk);decodedSha.update(chunk);}
  // Inspect the same open descriptor before cleanup; destroy() closes it even
  // with autoClose:false on FileHandle streams in the production Node release.
  const after=await handle.stat();
  if(physicalBytes!==before.size||!['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]))throw Error('File changed during diagnostic');
  return {physical:{bytes:physicalBytes,md5:physicalMd5.digest('hex'),sha256:physicalSha.digest('hex')},decoded:{bytes:decodedBytes,md5:decodedMd5.digest('hex'),sha256:decodedSha.digest('hex')},gzipTrailerValidated:true,stable:true};
 } finally {
  if(input)input.destroy();if(meter)meter.destroy();if(gunzip)gunzip.destroy();
  await handle.close();
 }
}

async function run(targets){
 const root='/storage/www/komondor-api';require(root+'/node_modules/dotenv').config({path:root+'/.env'});
 const m=require(root+'/node_modules/mongoose');m.set('autoIndex',false);m.set('autoCreate',false);
 const B=require(root+'/node_modules/bson'),bson=new B();
 const {resolveMongoUri}=require(root+'/lib/utils/validateEnv');const {validateProjectRoot}=require(root+'/lib/s3-archive/preflight');
 await m.connect(resolveMongoUri(process.env),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
 const out={startedAt:new Date().toISOString(),productionWrites:false,diagnosticOnly:true,records:[]};
 try{const db=m.connection.db;
 for(const t of targets){
  const read=await db.collection('reads').findOne({_id:new m.Types.ObjectId(t.readId)}),file=await db.collection('files').findOne({_id:read.file}),run=await db.collection('runs').findOne({_id:read.run});
  const sample=await db.collection('samples').findOne({_id:run.sample}),project=await db.collection('projects').findOne({_id:sample.project});
  if(String(project._id)!==t.projectId||file.path!==t.storedFilePath||read.MD5!==t.originalMD5)throw Error('Identity changed');
  const {sourceRoot}=await validateProjectRoot({datastoreRoot:process.env.DATASTORE_ROOT},project);
  const prefix=project.path.replace(/^\/+/, '')+'/';const stored=file.path.replace(/^\/+/, '');
  if(!stored.startsWith(prefix))throw Error('File outside target project');
  const relPath=stored.slice(prefix.length);if(relPath.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe relative path');
  const absolute=path.join(sourceRoot,relPath);if(await fs.promises.realpath(absolute)!==absolute)throw Error('Symlink path');
  process.stderr.write(`${t.readId}: read-only gzip diagnostic ${relPath}\n`);
  const hashes=await hashGzip(absolute);
  for(const [collection,prior] of [['reads',read],['files',file],['runs',run]]){const now=await db.collection(collection).findOne({_id:prior._id});if(!now||sha(bson.serialize(now))!==sha(bson.serialize(prior)))throw Error('Record changed during diagnostic');}
  out.records.push({readId:t.readId,projectId:t.projectId,relPath,originalMD5:read.MD5,...hashes,decodedMatchesOriginal:hashes.decoded.md5===String(read.MD5).trim().toLowerCase()});
 }
 out.finishedAt=new Date().toISOString();return out;
 }finally{await m.disconnect();}
}
module.exports={run,hashGzip};
