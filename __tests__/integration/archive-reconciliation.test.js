const fs=require("fs").promises,path=require("path"),os=require("os"),http=require("http");
const mongo=require("./support/mongo"),m=mongo.mongoose;
const migration=require("../../lib/archive-reconciliation"),reg=require("../../lib/archive-registration");
const {toolVersion}=require("../../scripts/reconcile-archive-database");
const Project=require("../../models/Project"),File=require("../../models/File"),Sample=require("../../models/Sample"),Run=require("../../models/Run");
require("../../models/Read");require("../../models/AdditionalFile");require("../../models/NewsItem");
let dir,root,work,backup,context,input,ids,stoppedUrl;
const db=()=>m.connection.db;
beforeAll(async()=>{
 await mongo.connect();dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"reconciliation-")));
 const server=http.createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));stoppedUrl=`http://127.0.0.1:${server.address().port}/ready`;await new Promise(r=>server.close(r));
});
afterAll(async()=>{await mongo.disconnect();await fs.rm(dir,{recursive:true,force:true});});
beforeEach(async()=>{
 await mongo.dropDatabase();await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir);
 root=path.join(dir,"data");work=path.join(dir,"evidence");backup=path.join(dir,"independent","plan.json");await fs.mkdir(path.dirname(backup));
 ids=Object.fromEntries(["group","project","empty","sample","run","file","read","emptySample","emptyRun","news"].map(k=>[k,new m.Types.ObjectId()]));
 await db().collection("groups").insertOne({_id:ids.group,safeName:"g"});
 await db().collection("projects").insertMany([
  {_id:ids.project,name:"P",safeName:"p",path:"/g/p",owner:"legacy",group:ids.group,shortDesc:"old",longDesc:"old",createdAt:new Date("2020-01-01"),nudgeable:false},
  {_id:ids.empty,name:"Empty",safeName:"empty",path:"/g/empty",owner:"legacy",group:ids.group,nudgeable:true}]);
 await db().collection("samples").insertMany([{_id:ids.sample,project:ids.project,path:"/g/p/s",name:"s",owner:"legacy"},{_id:ids.emptySample,project:ids.empty,path:"/g/empty/s",name:"e"}]);
 await db().collection("runs").insertMany([{_id:ids.run,sample:ids.sample,path:"/g/p/s/r",name:"r",status:"complete"},{_id:ids.emptyRun,sample:ids.emptySample,path:"/g/empty/s/r",name:"e"}]);
 await db().collection("files").insertOne({_id:ids.file,path:"/g/p/s/r/processed/a.fastq.txt",originalName:"a.fastq.txt",name:"original",type:"text/plain",uploadName:"a",createdAt:new Date("2020-02-02")});
 await db().collection("reads").insertOne({_id:ids.read,run:ids.run,file:ids.file,MD5:"old-md5",md5Mismatch:true});
 await db().collection("newsitems").insertOne({_id:ids.news,typeId:String(ids.empty),name:"original news"});
 await fs.mkdir(path.join(root,"g/p/s/r/processed"),{recursive:true});await fs.mkdir(path.join(root,"g/empty"),{recursive:true});
 await fs.writeFile(path.join(root,"g/p/s/r/processed/a.fastq"),"old-data");
 await fs.writeFile(path.join(root,"g/p/s/r/processed/notes.md5"),"hash text");
 await fs.writeFile(path.join(root,"g/p/unknown.fastq"),"unclassified");
 const stat=await fs.stat(path.join(root,"g/p/s/r/processed/a.fastq"));
 input={version:1,batchId:"2026-10-16",decisionAuthority:"scratch test",checksumEvidenceSha256:"f".repeat(64),
  targets:[{entryId:"p",projectId:String(ids.project),relativeRoot:"/g/p",expectedFiles:3,expectedBytes:29,disposition:"archive"},{entryId:"empty",projectId:String(ids.empty),relativeRoot:"/g/empty",expectedFiles:0,expectedBytes:0,disposition:"retire-records-retain-history"}],
  pathCorrections:[{entryId:"p",fileId:String(ids.file),readId:String(ids.read),runId:String(ids.run),beforePath:"/g/p/s/r/processed/a.fastq.txt",afterPath:"/g/p/s/r/processed/a.fastq"}],
  checksums:[{canonicalPath:path.join(root,"g/p/s/r/processed/a.fastq"),stable:true,bytes:8,identity:{...reg.statFields(stat),nlink:stat.nlink},md5:"current-md5",sha256:"a".repeat(64),observedAt:new Date().toISOString(),historicalVerification:"not-established"}]};
 context={db:db(),databaseIdentity:{name:db().databaseName,uuid:"scratch"},datastoreRoot:root,workDir:work,actor:"deeks",toolVersion:toolVersion()};
});
async function setup(){const result=await migration.prepare({...context,input});await fs.copyFile(path.join(work,"plan.json"),backup);
 const receipt={planSha256:result.planSha256,actor:"deeks",recordedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),allApiInstancesStopped:true,powerPaused:true,nudgePaused:true,externalWritersFrozen:true,backupIndependentlyRetained:true,apiReadyUrls:[stoppedUrl]};
 return {...context,receipt,backupPlan:backup,expectedSha256:result.planSha256,execute:true};}
test("read-only prepare; apply retains typed originals, current observation and legacy gaps; catalogues without invented Reads",async()=>{
 const before=await migration.databaseSnapshot(db());const opts=await setup();
 expect(await migration.databaseSnapshot(db())).toEqual(before);
 const result=await migration.apply(opts);expect(result.created.files).toBe(2);expect(result.created.additionalfiles).toBe(2);
 const file=await db().collection("files").findOne({_id:ids.file});expect(file.originalName).toBe("a.fastq.txt");expect(file.path).toMatch(/a.fastq$/);expect(file.createdAt).toEqual(new Date("2020-02-02"));
 expect(file.reconciliation.currentObservation.md5).toBe("current-md5");expect(file.reconciliationHistory).toHaveLength(1);
 expect(file.reconciliationHistory[0].changes.path.before).toMatch(/\.txt$/);
 const read=await db().collection("reads").findOne({_id:ids.read});expect(read.MD5).toBe("old-md5");expect(read.md5Mismatch).toBe(true);expect(read.destinationMd5).toBeUndefined();
 expect(await db().collection("reads").countDocuments()).toBe(1);expect(await db().collection("samples").countDocuments()).toBe(2);
 expect(await fs.readFile(path.join(root,"g/p/unknown.fastq"),"utf8")).toBe("unclassified");
 expect(await Project.findById(ids.empty)).toBeNull();expect(await Sample.findById(ids.emptySample)).toBeNull();expect(await Run.findById(ids.emptyRun)).toBeNull();
 expect(await db().collection("projects").findOne({_id:ids.empty})).toMatchObject({owner:"legacy",reconciliation:{retiredAt:expect.any(Date)}});
 expect(await migration.apply(opts)).toMatchObject({completed:result.completed});expect((await db().collection("files").findOne({_id:ids.file})).reconciliationHistory).toHaveLength(1);
});
test("refuses changed filesystem, records and missing backup before any writes",async()=>{
 const opts=await setup(),before=await migration.databaseSnapshot(db());
 await expect(migration.apply({...opts,backupPlan:path.join(work,"plan.json")})).rejects.toThrow(/Independent/);
 await fs.writeFile(path.join(root,"g/p/unknown.fastq"),"changed-data");
 await expect(migration.apply(opts)).rejects.toThrow(/changed/i);expect(await migration.databaseSnapshot(db())).toEqual(before);
});
test("resumes a crash after atomic database write without duplicate rows/history",async()=>{
 const opts=await setup();let crashed=false;
 await expect(migration.apply({...opts,afterWrite:()=>{if(!crashed){crashed=true;throw Error("crash");}}})).rejects.toThrow("crash");
 await migration.apply(opts);expect(await db().collection("files").countDocuments()).toBe(3);
 expect((await db().collection("files").findOne({_id:ids.file})).reconciliationHistory).toHaveLength(1);
});
test("normal queries, saves and bulk writes cannot change provenance or reactivate retired records",async()=>{
 await migration.apply(await setup());
 await expect(File.updateOne({_id:ids.file},{$set:{"reconciliation.currentObservation.md5":"fake"}})).rejects.toThrow(/administrative/);
 expect((await File.updateOne({_id:ids.file},{$set:{path:"/g/p/wrong"}})).n).toBe(0);
 expect((await File.bulkWrite([{updateOne:{filter:{_id:ids.file},update:{$set:{path:"/g/p/wrong"}}}}])).modifiedCount).toBe(0);
 const file=await File.findById(ids.file);file.path="/g/p/wrong";await expect(file.save()).rejects.toThrow(/pinned/);
 expect((await Project.deleteOne({_id:ids.empty})).deletedCount).toBe(0);
 await expect(Project.updateOne({_id:ids.empty},{$unset:{reconciliation:1}})).rejects.toThrow(/administrative/);
 expect(await Project.aggregate([{$match:{_id:ids.empty}}])).toEqual([]);
});
test("conditional reversal preserves audit trail and refuses overwriting later edits",async()=>{
 const opts=await setup();await migration.apply(opts);const plan=JSON.parse(await fs.readFile(path.join(work,"plan.json"))),execution=JSON.parse(await fs.readFile(path.join(work,"execution.json")));
 const op=plan.operations.find(o=>o.collection==="files"&&o.id===String(ids.file));
 await db().collection("files").updateOne({_id:ids.file},{$set:{later:"must-survive"}});
 await expect(migration.reverseCorrection({db:db(),plan,op,executionAt:execution.at,planSha256:opts.expectedSha256,actor:"deeks",receipt:opts.receipt})).rejects.toThrow(/later edits/);
 await db().collection("files").updateOne({_id:ids.file},{$unset:{later:1}});
 await migration.reverseCorrection({db:db(),plan,op,executionAt:execution.at,planSha256:opts.expectedSha256,actor:"deeks",receipt:opts.receipt});
 const file=await db().collection("files").findOne({_id:ids.file});expect(file.path).toMatch(/\.txt$/);expect(file.reconciliationHistory).toHaveLength(2);
});
