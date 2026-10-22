// Explicit, reversible metadata reconciliation. No model save hooks, file moves,
// historical-checksum updates, S3 calls, notifications or document deletions.
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { BSON, ObjectId } = require("bson");
const bson = new BSON();
const { encode, sha256, readRegular, writeOnce, evidenceDirectory, quiescence, statFields } = require("./archive-registration");
const { walkTree } = require("./s3-archive/inventory");
const { validateProjectRoot } = require("./s3-archive/preflight");
const { normalized, relativeTo } = require("./physical-file-path");
const pack = doc => bson.serialize(doc).toString("base64");
const unpack = str => bson.deserialize(Buffer.from(str, "base64"));
const equal = (a,b) => encode(a).equals(encode(b));
const id = v => String(v?._id || v);
const fail = message => { throw Error(message); };
const collections = ["projects", "samples", "runs", "reads", "additionalfiles", "files", "ingestjobs", "newsitems"];

async function databaseSnapshot(db) {
  const result = {};
  for (const { name } of (await db.listCollections().toArray()).sort((a,b)=>a.name.localeCompare(b.name))) {
    const documents = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    const bytes = Buffer.concat(documents.map(d=>bson.serialize(d)));
    const indexes = (await db.collection(name).indexes()).sort((a,b)=>a.name.localeCompare(b.name));
    result[name] = { documents, sha256: sha256(bytes), indexes, indexesSha256: sha256(encode(indexes)) };
  }
  return result;
}

async function observe(datastoreRoot, target) {
  const root = normalized(target.relativeRoot);
  if (!root || root.split("/").length !== 2) fail("Invalid batch root");
  const { sourceRoot } = await validateProjectRoot({ datastoreRoot }, { path: root });
  const before = statFields(await fs.lstat(sourceRoot));
  const tree = await walkTree(sourceRoot);
  if (!equal(before, statFields(await fs.lstat(sourceRoot)))) fail(`Root changed: ${target.entryId}`);
  if (tree.entries.some(e=>!["file", "dir", "symlink"].includes(e.type))) fail(`Unsafe tree: ${target.entryId}`);
  const files = tree.entries.filter(e=>e.type === "file");
  if (files.length !== target.expectedFiles || files.reduce((n,f)=>n+f.size,0) !== target.expectedBytes) fail(`Inventory changed: ${target.entryId}`);
  return { sourceRoot, rootStat: before, entries: tree.entries, observedAt: new Date().toISOString() };
}

function descendants(data, projectId) {
  const samples = data.samples.filter(s=>id(s.project) === projectId);
  const sampleIds = new Set(samples.map(id));
  const runs = data.runs.filter(r=>sampleIds.has(id(r.sample)));
  const runIds = new Set(runs.map(id));
  const reads = data.reads.filter(r=>runIds.has(id(r.run)));
  const additionalfiles = data.additionalfiles.filter(a=>id(a.project)===projectId || sampleIds.has(id(a.sample)) || runIds.has(id(a.run)));
  const fileIds = new Set([...reads,...additionalfiles].map(r=>id(r.file)));
  return { samples, runs, reads, additionalfiles, files: data.files.filter(f=>fileIds.has(id(f))),
    ingestjobs: data.ingestjobs.filter(j=>runIds.has(id(j.runId))),
    newsitems: data.newsitems.filter(n=>[projectId,...sampleIds,...runIds].includes(id(n.typeId))) };
}

async function prepare({ db, databaseIdentity, datastoreRoot, input, workDir, actor, toolVersion, onProgress }) {
  if (!actor || input.version !== 1 || input.batchId !== "2026-10-16") fail("Explicit batch/actor required");
  const directory = await evidenceDirectory(workDir, datastoreRoot);
  const snapshot = await databaseSnapshot(db);
  if (snapshot.archiveReconciliations?.documents.some(d=>d.batchId===input.batchId)) fail("Batch already recorded; use the retained plan to resume, not a new plan");
  const data = Object.fromEntries(collections.map(c=>[c,snapshot[c]?.documents || []]));
  const operations = [], observations = [], holds = [], summaries = [], pending = new Map();
  const seenEntries = new Set(), seenRoots = new Set();
  const projectById = new Map(data.projects.map(p=>[id(p),p]));
  const groupById = new Map((snapshot.groups?.documents || []).map(g=>[id(g),g]));
  const fileByPath = new Map();
  const originalFileById = new Map(data.files.map(f=>[id(f),f]));
  const checksumByPath = new Map((input.checksums || []).map(c=>[c.canonicalPath,c]));
  const addPath = f => { const p = normalized(f.path); if (p) { const list=fileByPath.get(p)||[];list.push(f);fileByPath.set(p,list); } };
  data.files.forEach(addPath);
  function change(collection, before, set, reason, entryId, options={}) {
    const key=collection+":"+id(before);
    let op=pending.get(key);
    if (!op) {
      if (before.reconciliation) fail(`Already reconciled; inspect existing evidence: ${key}`);
      op={ collection, id:id(before), operationId:crypto.randomUUID(), beforeBson:pack(before), set:{}, reasons:[], entryId, options:{} };
      pending.set(key,op);
    }
    Object.assign(op.set,set);Object.assign(op.options,options);op.reasons.push(reason);
    return op;
  }
  // Exact reviewed filename corrections, preserving uploaded originalName and all Read fields.
  for (const correction of input.pathCorrections || []) {
    const before=originalFileById.get(correction.fileId);
    if (!before || before.path!==correction.beforePath || !normalized(correction.afterPath)) fail("File correction no longer matches");
    const references=data.reads.filter(r=>id(r.file)===correction.fileId);
    if (references.length!==1 || id(references[0])!==correction.readId || id(references[0].run)!==correction.runId) fail("File associations changed");
    change("files",before,{path:correction.afterPath},"Correct evidenced physical filename; preserve original upload name",correction.entryId);
    fileByPath.set(normalized(before.path),(fileByPath.get(normalized(before.path))||[]).filter(f=>id(f)!==id(before)));
    addPath({...before,path:correction.afterPath});
  }
  for (const target of input.targets) {
    if (seenEntries.has(target.entryId)||seenRoots.has(target.relativeRoot)) fail("Repeated target");
    seenEntries.add(target.entryId);seenRoots.add(target.relativeRoot);
    if (target.disposition === "keep") { summaries.push({entryId:target.entryId,status:"keep-unchanged"}); continue; }
    const observation=await observe(datastoreRoot,target);observations.push({entryId:target.entryId,target, ...observation});
    const root=normalized(target.relativeRoot), files=observation.entries.filter(e=>e.type==="file");
    const registered=data.projects.filter(p=>p.registrationProvenance?.entryId===target.entryId);
    let project=target.projectId ? projectById.get(target.projectId) : registered[0];
    if (registered.length>1 || (target.projectId&&!project)) fail(`Project identity changed: ${target.entryId}`);
    const ledger={_id:new ObjectId(),batchId:input.batchId,entryId:target.entryId,disposition:target.disposition,
      physicalRoot:"/"+root, observedAt:observation.observedAt,fileCount:files.length,bytes:target.expectedBytes,
      project:project?._id || null, decisionAuthority:input.decisionAuthority, executionStatus:"reconciled",
      inventory:files.map(f=>({path:f.relPath,bytes:f.size}))};
    ledger.nonRegularEntries=observation.entries.filter(e=>e.type==="symlink").map(e=>({path:e.relPath,type:e.type,linkTarget:e.linkTarget,
      status:"retained-link-not-followed-or-catalogued-as-file"}));
    if (!project) {
      if (files.length && target.entryId!=="ntalbot-031") fail(`Approved registration is missing: ${target.entryId}`);
      const claimedRuns=data.runs.filter(r=>relativeTo(root,r.path));
      if (files.length) {
        const associations=claimedRuns.map(r=>({runId:id(r),sampleId:id(r.sample),projectId:id(data.samples.find(s=>id(s)===id(r.sample))?.project)}));
        const hold={entryId:target.entryId,reason:"Existing Run associations outside a Project's canonical root; preserve both trees",associations};
        holds.push(hold);ledger.executionStatus="technical-hold";ledger.hold=hold;
      } else ledger.executionStatus="empty-directory-recorded";
      operations.push({collection:"archiveReconciliations",id:id(ledger),operationId:crypto.randomUUID(),beforeBson:null,insertBson:pack(ledger),entryId:target.entryId});
      summaries.push({entryId:target.entryId,status:ledger.executionStatus,newFiles:0});continue;
    }
    if (project.storage?.state && project.storage.state!=="hpc") fail(`Non-HPC project: ${target.entryId}`);
    if (groupById.get(id(project.group))?.safeName!==root.split("/")[0]) fail("Group differs from physical root");
    if (data.projects.some(p=>id(p)!==id(project) && normalized(p.path)?.toLowerCase()===root.toLowerCase())) fail("Another Project claims physical root");
    const children=descendants(data,id(project));
    const oldRoot=normalized(project.path);
    if (oldRoot!==root) {
      // Only the named case/punctuation mismatches in the reviewed input. No guessed renames.
      if (target.previousRoot!==project.path || !target.correctRoot) fail(`Unreviewed root difference: ${target.entryId}`);
      change("projects",project,{path:"/"+root},"Retain observed physical root spelling without moving bytes",target.entryId);
      for (const collection of ["samples","runs"]) for (const child of children[collection]) {
        if(child.group && id(child.group)!==id(project.group))fail("Descendant group conflicts with its Project");
        const relative=relativeTo(oldRoot,child.path);
        const matches=relative?observation.entries.filter(e=>e.type==="dir"&&e.relPath.toLowerCase()===relative.toLowerCase()):[];
        if(matches.length>1)fail("Case-ambiguous descendant directory; do not guess");
        const candidate=matches.length===1?root+"/"+matches[0].relPath:null;
        if (candidate) {
          change(collection,child,{path:"/"+candidate},"Correct parent-root spelling; existing directory verified",target.entryId);
        } else {
          ledger.unresolvedLegacyPaths ||= [];ledger.unresolvedLegacyPaths.push({collection,id:id(child),path:child.path,reason:"No supported physical directory; original scientific record retained"});
        }
      }
      project={...project,path:"/"+root};
    }
    if (target.disposition==="retire-records-retain-history") {
      if (files.length || children.files.length || children.reads.length || children.additionalfiles.length || children.ingestjobs.some(j=>!["done","failed"].includes(j.status))) fail("Retirement target is not empty/drained");
      change("projects",project,{nudgeable:false,doNotSendToEna:true,doNotSendToEnaReason:"Retired empty legacy project; history retained"},"Retire confirmed empty project, retaining all documents",target.entryId,{retire:true});
      for (const [collection,docs] of Object.entries(children)) for (const doc of docs) change(collection,doc,{},"Retire dependent of confirmed empty project; preserve original record",target.entryId,{retire:true});
      ledger.executionStatus="retired-empty";
    } else {
      let newFiles=0,observationsLinked=0;
      const projectReferences=new Set([...children.reads,...children.additionalfiles].map(r=>id(r.file)));
      for (const file of files) {
        const stored=root+"/"+file.relPath, matches=fileByPath.get(stored)||[];
        if (matches.length>1) fail(`Multiple File identities at ${stored}`);
        const checksum=checksumByPath.get(path.join(datastoreRoot,stored));
        let currentObservation=null;
        if (checksum) {
          const agrees=Object.keys(checksum.identity).every(k=>file[k]===checksum.identity[k]);
          // Old hashes remain dated evidence; changed metadata must never inherit them.
          if (agrees && checksum.stable && checksum.bytes===file.size) currentObservation={...checksum, sourceEvidenceSha256:input.checksumEvidenceSha256};
        }
        if (matches.length) {
          const original=originalFileById.get(id(matches[0]));
          if (!projectReferences.has(id(original))) fail(`File has an unrelated/orphan catalogue claim: ${stored}`);
          const outside=[...data.reads,...data.additionalfiles].some(r=>id(r.file)===id(original)&&![...children.reads,...children.additionalfiles].some(c=>id(c)===id(r)));
          if (outside) fail(`Shared File crosses project boundary: ${stored}`);
          if (currentObservation) {change("files",original,{},"Retain dated current-byte observation; historical upload fields untouched",target.entryId,{currentObservation});observationsLinked++;}
          continue;
        }
        const parentCandidates=[...children.runs.map(r=>({collection:"run",doc:r})),...children.samples.map(s=>({collection:"sample",doc:s}))]
          .map(p=>({...p,physicalPath:pending.get((p.collection==="run"?"runs":"samples")+":"+id(p.doc))?.set.path||p.doc.path}))
          .filter(p=>normalized(p.physicalPath)?.startsWith(root+"/")&&relativeTo(p.physicalPath,stored))
          .sort((a,b)=>b.physicalPath.length-a.physicalPath.length);
        if (parentCandidates.length > 1 && parentCandidates[1].physicalPath.length===parentCandidates[0].physicalPath.length) fail("Ambiguous catalogue parent");
        const parent=parentCandidates[0] || {collection:"project",doc:project};
        const name=path.posix.basename(file.relPath), fileId=new ObjectId(), additionalId=new ObjectId();
        const hint=/\.(md5|sha256|sha1)(sum)?$/i.test(name)?"checksum-file-candidate":/\.(fastq|fq)(\.gz)?$/i.test(name)?"sequence-file-candidate":"unclassified-preserve";
        const f={_id:fileId,name:"reconciled-"+String(fileId),type:"application/octet-stream",uploadName:name,originalName:name,
          path:"/"+stored,uploadMethod:"administrative-catalogue",createFileDocumentId:"reconcile-"+String(fileId),
          description:"Existing physical file preserved; scientific classification and historical upload verification are unconfirmed.",__v:0};
        const a={_id:additionalId,[parent.collection]:parent.doc._id,file:fileId,skipPostSave:true,__v:0};
        for (const [collection,document] of [["files",f],["additionalfiles",a]]) operations.push({collection,id:id(document),operationId:crypto.randomUUID(),beforeBson:null,insertBson:pack(document),entryId:target.entryId,
          reasons:["Catalogue existing bytes without creating a scientific Read or moving files"],options:{classification:hint,classificationBasis:"filename-and-directory-only; scientific role unconfirmed",...(collection==="files"&&currentObservation?{currentObservation}:{})}});
        newFiles++; if(currentObservation)observationsLinked++;
      }
      ledger.newFiles=newFiles;ledger.currentObservations=observationsLinked;
    }
    operations.push({collection:"archiveReconciliations",id:id(ledger),operationId:crypto.randomUUID(),beforeBson:null,insertBson:pack(ledger),entryId:target.entryId});
    summaries.push({entryId:target.entryId,status:ledger.executionStatus,newFiles:ledger.newFiles||0,currentObservations:ledger.currentObservations||0,unresolvedLegacyPaths:ledger.unresolvedLegacyPaths?.length||0});
    if(onProgress)onProgress({entryId:target.entryId,operations:operations.length+pending.size});
  }
  for(const op of pending.values())operations.unshift({...op,setBson:pack(op.set),set:undefined});
  // Every correction target must resolve to an observed physical file.
  for(const c of input.pathCorrections||[]) {
    const tree=observations.find(o=>o.entryId===c.entryId),rel=tree&&relativeTo(tree.target.relativeRoot,c.afterPath);
    if(!tree?.entries.some(f=>f.type==="file"&&f.relPath===rel))fail("Corrected File path was not observed");
  }
  const plan={version:1,kind:"archive-database-reconciliation",batchId:input.batchId,preparedAt:new Date().toISOString(),actor,toolVersion,databaseIdentity,
    datastoreRoot:path.resolve(datastoreRoot),decisionAuthority:input.decisionAuthority,inputSha256:sha256(encode(input)),operations,observations,holds,summaries,
    databaseBefore:Object.fromEntries(Object.entries(snapshot).map(([name,s])=>[name,{sha256:s.sha256,indexesSha256:s.indexesSha256,count:s.documents.length}]))};
  const bytes=encode(plan);await writeOnce(path.join(directory,"plan.json"),bytes);
  await writeOnce(path.join(directory,"input.json"),encode(input));
  return {planSha256:sha256(bytes),operations:operations.length,newFiles:operations.filter(o=>o.collection==="files"&&!o.beforeBson).length,
    corrections:pending.size,holds,summaries,productionWrites:false};
}

function materialize(plan,op,at,digest) {
  const before=op.beforeBson?unpack(op.beforeBson):null,base=before||unpack(op.insertBson),set=op.setBson?unpack(op.setBson):{};
  const after={...base,...set};
  const keys=["path","name","safeName","owner","group","project","sample","run","file","originalName"];
  const identity=Object.fromEntries(keys.filter(k=>after[k]!==undefined).map(k=>[k,after[k]]));
  after.reconciliation={version:1,operationId:op.operationId,batchId:plan.batchId,entryId:op.entryId,identity,
    ...op.options,...(op.options?.retire?{retiredAt:at}:{}),planSha256:digest};
  delete after.reconciliation.retire;
  const changes=Object.fromEntries(Object.keys(set).map(k=>[k,{beforeExists:Object.hasOwn(base,k),...(Object.hasOwn(base,k)?{before:base[k]}:{}),after:set[k]}]));
  after.reconciliationHistory=[...(base.reconciliationHistory||[]),{version:1,operationId:op.operationId,batchId:plan.batchId,at,actor:plan.actor,
    kind:op.beforeBson?"administrative-correction":"administrative-catalogue",reason:(op.reasons||["Record batch disposition and live evidence"]).join("; "),
    decisionAuthority:plan.decisionAuthority,beforeExists:!!before,beforeBsonSha256:before?sha256(Buffer.from(op.beforeBson,"base64")):null,
    changes,planSha256:digest,toolVersion:plan.toolVersion}];
  if(!before)after.createdAt=at;
  after.updatedAt=at;
  return after;
}

async function apply({db,databaseIdentity,datastoreRoot,workDir,backupPlan,expectedSha256,actor,toolVersion,receipt,execute,afterWrite,onProgress}) {
  if(!execute)fail("Apply requires --execute");
  const directory=await evidenceDirectory(workDir,datastoreRoot),filename=path.join(directory,"plan.json"),bytes=await readRegular(filename),digest=sha256(bytes);
  if(digest!==expectedSha256||!/^[a-f0-9]{64}$/.test(digest))fail("Reviewed digest differs");
  const backup=path.resolve(backupPlan),a=await fs.stat(filename),b=await fs.stat(backup);
  if(backup.startsWith(directory+path.sep)||backup.startsWith(path.resolve(__dirname,"..")+path.sep)||backup.startsWith(path.resolve(datastoreRoot)+path.sep)||a.dev===b.dev&&a.ino===b.ino||!(await readRegular(backup)).equals(bytes))fail("Independent plan copy is missing/different");
  const plan=JSON.parse(bytes);
  if(plan.kind!=="archive-database-reconciliation"||plan.version!==1||plan.actor!==actor||plan.toolVersion!==toolVersion||plan.datastoreRoot!==path.resolve(datastoreRoot)||!equal(plan.databaseIdentity,databaseIdentity))fail("Plan context differs");
  await quiescence(db,receipt,digest,actor);
  if(receipt.nudgePaused!==true)fail("Nudge must be paused");
  for(const observation of plan.observations){
    const fresh=await observe(datastoreRoot,observation.target);
    if(!equal(fresh.rootStat,observation.rootStat)||!equal(fresh.entries,observation.entries))fail(`Filesystem changed since plan: ${observation.entryId}`);
  }
  const executionFile=path.join(directory,"execution.json");let execution;
  try{execution=JSON.parse(await readRegular(executionFile));}
  catch(e){if(e.code!=="ENOENT")throw e;execution={at:new Date().toISOString(),planSha256:digest};await writeOnce(executionFile,encode(execution));}
  if(execution.planSha256!==digest)fail("Execution belongs to another plan");
  const at=new Date(execution.at);if(!Number.isFinite(+at))fail("Invalid execution date");
  const expected=new Map();
  // Validate the entire operation set before the first write; retries must match
  // exact atomic results, not merely the presence of an operation marker.
  for(const op of plan.operations){
    if(![...collections,"archiveReconciliations"].includes(op.collection))fail("Invalid collection");
    const key=op.collection+":"+op.id;if(expected.has(key))fail("Duplicate operation");
    const after=materialize(plan,op,at,digest),current=await db.collection(op.collection).findOne({_id:new ObjectId(op.id)});
    const before=op.beforeBson?unpack(op.beforeBson):null;
    if(!equal(current,before)&&!equal(current,after))fail(`Record changed: ${key}`);
    expected.set(key,after);
  }
  await verifyUnchangedDatabase(db,plan);
  let completed=0;
  for(const op of plan.operations){
    if(completed%100===0)await quiescence(db,receipt,digest,actor);
    const collection=db.collection(op.collection),after=expected.get(op.collection+":"+op.id);
    const current=await collection.findOne({_id:new ObjectId(op.id)});
    if(!equal(current,after)) {
      if(!op.beforeBson){if(current)fail("Unexpected insert collision");await collection.insertOne(after);}
      else {
        const before=unpack(op.beforeBson);if(!equal(current,before))fail("Concurrent record change");
        const set=op.setBson?unpack(op.setBson):{};
        const filter={_id:before._id,$and:[{reconciliation:{$exists:false}},...Object.keys(set).map(k=>Object.hasOwn(before,k)?{[k]:{$eq:before[k]}}:{[k]:{$exists:false}}),
          Object.hasOwn(before,"reconciliationHistory")?{reconciliationHistory:{$eq:before.reconciliationHistory}}:{reconciliationHistory:{$exists:false}}]};
        const result=await collection.updateOne(filter,{$set:{...set,reconciliation:after.reconciliation,updatedAt:at},$push:{reconciliationHistory:after.reconciliationHistory.at(-1)}});
        if(result.matchedCount!==1)fail("Conditional correction did not match");
      }
      if(afterWrite)await afterWrite(op,completed);
    }
    if(!equal(await collection.findOne({_id:after._id}),after))fail("Result differs from reviewed operation");
    completed++;if(onProgress&&completed%500===0)onProgress({completed,total:plan.operations.length});
  }
  const result={at:new Date().toISOString(),planSha256:digest,completed,holds:plan.holds,
    created:Object.fromEntries([...collections,"archiveReconciliations"].map(c=>[c,plan.operations.filter(o=>o.collection===c&&!o.beforeBson).length])),
    corrected:Object.fromEntries(collections.map(c=>[c,plan.operations.filter(o=>o.collection===c&&o.beforeBson).length]))};
  await writeOnce(path.join(directory,"completed-"+crypto.randomUUID()+".json"),encode(result));
  return result;
}

async function verifyUnchangedDatabase(db,plan) {
  const snapshot=await databaseSnapshot(db),changes=new Map(plan.operations.map(o=>[o.collection+":"+o.id,o]));
  for(const name of new Set([...Object.keys(snapshot),...Object.keys(plan.databaseBefore)])) {
    if(!plan.databaseBefore[name]) {
      if(![...collections,"archiveReconciliations"].includes(name)||snapshot[name].documents.some(d=>!changes.has(name+":"+id(d)))||snapshot[name].indexes.some(i=>i.name!=="_id_"))fail("Unplanned new collection/record");
      continue;
    }
    const state=snapshot[name];if(!state)fail("Original collection missing");
    const originals=state.documents.flatMap(d=>{const op=changes.get(name+":"+id(d));return op?(op.beforeBson?[unpack(op.beforeBson)]:[]):[d];});
    const summary={sha256:sha256(Buffer.concat(originals.map(d=>bson.serialize(d)))),indexesSha256:state.indexesSha256,count:originals.length};
    if(!equal(summary,plan.databaseBefore[name]))fail(`Unplanned original document/index change: ${name}`);
  }
  return {originalDocumentsAndIndexesUnchangedExceptPlanned:true};
}
// Recovery primitive for an individually reviewed existing-record correction.
// It never deletes newly catalogued records and refuses later edits. The caller
// must provide the same quiescence/backup procedure as apply before using it.
async function reverseCorrection({db,plan,op,executionAt,planSha256,actor,receipt}) {
  if(!op.beforeBson)fail("New catalogue records require retention, not deletion");
  await quiescence(db,receipt,planSha256,actor);
  if(receipt.nudgePaused!==true)fail("Nudge must be paused");
  const after=materialize(plan,op,new Date(executionAt),planSha256),before=unpack(op.beforeBson),collection=db.collection(op.collection);
  if(!equal(await collection.findOne({_id:after._id}),after))fail("Cannot reverse over later edits");
  const set={},unset={};
  for(const key of Object.keys(op.setBson?unpack(op.setBson):{})) {
    if(Object.hasOwn(before,key))set[key]=before[key];else unset[key]="";
  }
  const at=new Date();
  set.reconciliation={...after.reconciliation,state:"reversed",identity:Object.fromEntries(Object.keys(after.reconciliation.identity).filter(k=>before[k]!==undefined).map(k=>[k,before[k]]))};
  delete set.reconciliation.retiredAt;
  set.updatedAt=at;
  const event={version:1,kind:"reversal",operationId:crypto.randomUUID(),reverses:op.operationId,at,actor,planSha256};
  // Exact complete-document comparison is in the atomic predicate as well as the
  // earlier diagnostic check, so even an unknown newly added field blocks reversal.
  const filter={_id:after._id,$expr:{$setEquals:[{$objectToArray:"$$ROOT"},{$literal:Object.entries(after).map(([k,v])=>({k,v}))}]}};
  const result=await collection.updateOne(filter,{$set:set,...(Object.keys(unset).length?{$unset:unset}:{}),$push:{reconciliationHistory:event}});
  if(result.matchedCount!==1)fail("Reversal lost its expected-value comparison");
  return {id:op.id,reversed:op.operationId};
}
module.exports={prepare,apply,observe,databaseSnapshot,materialize,descendants,pack,unpack,equal,reverseCorrection,verifyUnchangedDatabase};
