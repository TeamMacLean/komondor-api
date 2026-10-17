// Loaded in memory over SSH. No filesystem, MongoDB or S3 write operations.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const validMd5 = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ids = docs => docs.map(d => d._id);
const idText = value => String(value);

async function hashFile(root, entry) {
  if (entry.type !== 'file' || !entry.relPath || entry.relPath.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe candidate');
  const absolute = path.join(root, entry.relPath);
  if (await fs.promises.realpath(absolute) !== absolute) throw Error('Candidate path contains a symlink');
  const handle = await fs.promises.open(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const equal = (a,b) => ['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !equal(before,entry)) throw Error('Candidate changed before hashing');
    const md5=crypto.createHash('md5'), sha=crypto.createHash('sha256');
    let bytes=0;
    for await (const chunk of handle.createReadStream({ autoClose:false, highWaterMark:4*1024*1024 })) {
      md5.update(chunk); sha.update(chunk); bytes+=chunk.length;
    }
    if (bytes!==before.size || !equal(before,await handle.stat())) throw Error('Candidate changed while hashing');
    return { relPath:entry.relPath, bytes, md5:md5.digest('hex'), sha256:sha.digest('hex'), stable:true };
  } finally { await handle.close(); }
}

function classify(candidates, originalMd5, sameRunPaths) {
  if (!candidates.length) return { category:'b', resolution:'Absent from expected/stored locations and no same-basename regular file in the project inventory. Archive existing bytes with the missing record documented.', scope:'Named/stored-path search of this project; not a claim that no renamed copy exists elsewhere.' };
  const matches = candidates.filter(c=>!originalMd5 || c.md5===originalMd5);
  if (candidates.length===1 && matches.length===1 && sameRunPaths.has(candidates[0].relPath)) return { category:'a', resolution:'Leave the tree as it is; seal the location discrepancy and checksum evidence in the archive audit.', originalMd5Match:originalMd5 ? true : null };
  const identical = new Set(candidates.map(c=>c.sha256)).size===1;
  const resolved = matches.some(c=>sameRunPaths.has(c.relPath)) && (identical || (originalMd5 && matches.length===1));
  return { category:'c', resolved:!!resolved, allCandidateBytesEqual:identical,
    originalMd5MatchingPaths:originalMd5 ? matches.map(c=>c.relPath) : null,
    resolution: resolved ? 'Candidates compared. Preserve every copy in place; record matching/duplicate paths without moving bytes or changing Read/File history.' : 'HOLD: checksum mismatch, cross-run location, or distinct ambiguous candidates require a separate decision; no automatic file move or database repair.' };
}

async function collectRelations(db, project, bson) {
  const get = (name,filter) => db.collection(name).find(filter).sort({_id:1}).toArray();
  // Historical raw documents may store reference IDs as strings, not ObjectIds.
  const ObjectId = require('bson').ObjectID;
  const idVariants = values => values.flatMap(value => {
    const text = String(value);
    return /^[a-f0-9]{24}$/i.test(text) ? [value, text, new ObjectId(text)] : [value, text];
  });
  const samples=await get('samples',{project:{$in:idVariants([project._id])}});
  const runs=await get('runs',{sample:{$in:idVariants(ids(samples))}});
  const reads=await get('reads',{run:{$in:idVariants(ids(runs))}});
  const additionalfiles=await get('additionalfiles',{$or:[{project:{$in:idVariants([project._id])}},{sample:{$in:idVariants(ids(samples))}},{run:{$in:idVariants(ids(runs))}}]});
  const referencedFileIds=[...reads,...additionalfiles].map(d=>d.file).filter(Boolean);
  const prefix=String(project.path).replace(/^\/+|\/+$/g,'');
  const files=await get('files',{$or:[{_id:{$in:idVariants(referencedFileIds)}},{path:{$regex:`^/?${escapeRegex(prefix)}/`}}]});
  const ingestjobs=await get('ingestjobs',{runId:{$in:idVariants(ids(runs))}});
  const typeIds=[project._id,...ids(samples),...ids(runs)];
  const newsitems=await get('newsitems',{typeId:{$in:idVariants(typeIds)}});
  const foreignReads=await get('reads',{$or:[{file:{$in:idVariants(ids(files))},_id:{$nin:ids(reads)}},{sibling:{$in:idVariants(ids(reads))},_id:{$nin:ids(reads)}}]});
  const foreignAdditional=await get('additionalfiles',{file:{$in:idVariants(ids(files))},_id:{$nin:ids(additionalfiles)}});
  const allowed={project:new Set([String(project._id)]),sample:new Set(ids(samples).map(String)),run:new Set(ids(runs).map(String))};
  const crossParentAdditional=additionalfiles.filter(d=>Object.keys(allowed).some(k=>d[k] && !allowed[k].has(String(d[k]))));
  const documents={projects:[project],samples,runs,reads,additionalfiles,files,ingestjobs,newsitems};
  const snapshots={};
  for (const [collection,docs] of Object.entries(documents)) {
    const bytes=bson.serialize({documents:docs});
    snapshots[collection]={count:docs.length,ids:ids(docs).map(String),bsonBase64:bytes.toString('base64'),sha256:sha256(bytes)};
  }
  const missingFileReferences=referencedFileIds.filter(id=>!files.some(f=>String(f._id)===String(id))).map(String);
  const filePathsOutsideProject=files.filter(f=>!String(f.path||'').replace(/^\/+/, '').startsWith(prefix+'/')).map(f=>({id:String(f._id),path:f.path}));
  const encodedId = id => id && ['ObjectID','ObjectId'].includes(id._bsontype) ? {$oid:String(id)} : id;
  return {projectId:String(project._id),projectPath:project.path,snapshots,
    blockers:{foreignReads:ids(foreignReads).map(String),foreignAdditionalFiles:ids(foreignAdditional).map(String),crossParentAdditionalFiles:ids(crossParentAdditional).map(String),missingFileReferences,filePathsOutsideProject,
      activeIngestJobs:ingestjobs.filter(j=>['pending','claimed'].includes(j.status)).map(j=>String(j._id)),
      activeRuns:runs.filter(r=>['pending','processing'].includes(r.status)||r.md5VerificationStatus==='in_progress').map(r=>String(r._id))},
    deletionOrder:['ingestjobs','reads','additionalfiles','files','newsitems','runs','samples','projects'],
    deletionFilters:Object.fromEntries(Object.entries(documents).map(([c,docs])=>[c,{_id:{$in:docs.map(d=>encodedId(d._id))}}])),
    cleanupExecuted:false};
}

async function run(payload) {
  const root=payload.repositoryRoot;
  if (root!=='/storage/www/komondor-api') throw Error('Unexpected repository');
  require(root+'/node_modules/dotenv').config({path:root+'/.env'});
  const mongoose=require(root+'/node_modules/mongoose');
  mongoose.set('autoIndex',false); mongoose.set('autoCreate',false);
  const {resolveMongoUri}=require(root+'/lib/utils/validateEnv');
  const {walkTree,snapshotDifference}=require(root+'/lib/s3-archive/inventory');
  const {validateProjectRoot}=require(root+'/lib/s3-archive/preflight');
  const B=require(root+'/node_modules/bson'); const bson=new B();
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const gitBefore={commit:git('rev-parse','HEAD'),status:git('status','--porcelain')};
  const result={startedAt:new Date().toISOString(),operator:require('os').userInfo().username,host:require('os').hostname(),mode:payload.mode,gitBefore,projects:[],moduleSha256:Object.fromEntries(['lib/s3-archive/preflight.js','lib/s3-archive/inventory.js'].map(f=>[f,sha256(fs.readFileSync(path.join(root,f)))]))};
  if (!['paths','relations'].includes(payload.mode)) throw Error('Unsupported read-only mode');
  await mongoose.connect(resolveMongoUri(process.env),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
  try {
    const db=mongoose.connection.db;
    for (const target of payload.targets) {
      const project=await db.collection('projects').findOne({_id:new mongoose.Types.ObjectId(target.projectId)});
      if (!project || project.path!==target.projectPath || (project.storage?.state && project.storage.state!=='hpc')) throw Error('Project identity/state mismatch: '+target.entryId);
      process.stderr.write(`${target.entryId}: collecting ${payload.mode}\n`);
      if (payload.mode==='relations') {
        result.projects.push({entryId:target.entryId,...await collectRelations(db,project,bson)});
        continue;
      }
      const {sourceRoot}=await validateProjectRoot({datastoreRoot:process.env.DATASTORE_ROOT},project);
      const inventory=await walkTree(sourceRoot);
      const cache=new Map(), records=[];
      for (const missing of target.missing) {
        const read=await db.collection('reads').findOne({_id:new mongoose.Types.ObjectId(missing.id)});
        if (!read) throw Error('Read no longer exists: '+missing.id);
        const file=await db.collection('files').findOne({_id:read.file});
        const run=await db.collection('runs').findOne({_id:read.run});
        if (!file || !run) throw Error('Missing File/Run reference');
        const expected=String(run.path).replace(/^\//,'')+'/raw/'+file.originalName;
        const projectPrefix=String(project.path).replace(/^\//,'')+'/';
        if (!expected.startsWith(projectPrefix) || expected.slice(projectPrefix.length)!==missing.expectedRelPath) throw Error('Expected location changed since review');
        const stored=String(file.path||'').replace(/^\//,'');
        const storedRelative=stored.startsWith(projectPrefix) ? stored.slice(projectPrefix.length) : null;
        const possible=inventory.entries.filter(e=>e.type==='file' && (path.basename(e.relPath)===path.basename(missing.expectedRelPath)||e.relPath===storedRelative||e.relPath===missing.expectedRelPath));
        const candidates=[];
        for (const entry of possible) {
          if (!cache.has(entry.relPath)) {
            process.stderr.write(`${target.entryId}: hashing ${entry.relPath} (${entry.size} bytes)\n`);
            cache.set(entry.relPath,await hashFile(sourceRoot,entry));
          }
          candidates.push(cache.get(entry.relPath));
        }
        const original=validMd5(read.MD5);
        const runRelative=String(run.path).replace(/^\//,'').slice(projectPrefix.length);
        const sameRunPaths=new Set(candidates.filter(c=>c.relPath.startsWith(runRelative+'/')).map(c=>c.relPath));
        const resolution=classify(candidates,original,sameRunPaths);
        for (const [collection,old] of [['reads',read],['files',file],['runs',run]]) {
          const current=await db.collection(collection).findOne({_id:old._id});
          if (!current || sha256(bson.serialize(old))!==sha256(bson.serialize(current))) throw Error('Database record changed during hashing');
        }
        records.push({readId:String(read._id),fileId:String(file._id),runId:String(run._id),runPath:run.path,expectedRelPath:missing.expectedRelPath,storedFilePath:file.path,recordedOriginalMD5:read.MD5??null,validOriginalMD5:original,destinationMd5:read.destinationMd5??null,candidates,resolution,proposedFileMoves:[],proposedDatabaseWrites:[]});
        process.stderr.write(`${target.entryId}: read ${read._id}: category ${resolution.category}\n`);
      }
      const after=await walkTree(sourceRoot);
      if (snapshotDifference(inventory.entries,after.entries).length) throw Error('Project tree changed during audit');
      result.projects.push({entryId:target.entryId,projectId:target.projectId,projectPath:project.path,sourceRoot,inventoryRegularFiles:inventory.entries.filter(e=>e.type==='file').length,inventoryBytes:inventory.entries.filter(e=>e.type==='file').reduce((s,e)=>s+e.size,0),records,uniqueFilesHashed:cache.size,treeUnchangedDuringAudit:true});
    }
    result.finishedAt=new Date().toISOString();
    result.gitAfter={commit:git('rev-parse','HEAD'),status:git('status','--porcelain')};
    return result;
  } finally { await mongoose.disconnect(); }
}
module.exports={run,hashFile,classify,collectRelations,validMd5};
