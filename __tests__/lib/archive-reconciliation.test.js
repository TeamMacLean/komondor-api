const fs=require("fs").promises,path=require("path"),os=require("os");
const {ObjectId}=require("bson");
const migration=require("../../lib/archive-reconciliation"),reg=require("../../lib/archive-registration");
let directory,root,work,data,ids,input,db,context;
const oid=()=>new ObjectId();
beforeEach(async()=>{
 directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"reconciliation-unit-")));root=path.join(directory,"data");work=path.join(directory,"evidence");
 ids=Object.fromEntries(["group","project","sample","run","file","read","empty"].map(k=>[k,oid()]));
 data={groups:[{_id:ids.group,safeName:"g"}],projects:[{_id:ids.project,name:"p",path:"/g/p",safeName:"p",group:ids.group,owner:"legacy"},{_id:ids.empty,path:"/g/empty",name:"Empty",group:ids.group,owner:"old"}],
 samples:[{_id:ids.sample,project:ids.project,path:"/g/p/s"}],runs:[{_id:ids.run,sample:ids.sample,path:"/g/p/s/r",status:"complete"}],
 reads:[{_id:ids.read,run:ids.run,file:ids.file,MD5:"historical",md5Mismatch:true}],files:[{_id:ids.file,path:"/g/p/s/r/raw/old.txt",originalName:"old.txt",createdAt:new Date("2020-01-01")}],additionalfiles:[],ingestjobs:[],newsitems:[]};
 db={listCollections:()=>({toArray:async()=>Object.keys(data).map(name=>({name}))}),collection:name=>({
 find:()=>({sort:()=>({toArray:async()=>[...(data[name]||[])].sort((a,b)=>String(a._id).localeCompare(String(b._id)))})}),indexes:async()=>[{name:"_id_",key:{_id:1}}]})};
 await fs.mkdir(path.join(root,"g/p/s/r/raw"),{recursive:true});await fs.mkdir(path.join(root,"g/empty"),{recursive:true});
 await fs.writeFile(path.join(root,"g/p/s/r/raw/actual.fq"),"ACGT");await fs.writeFile(path.join(root,"g/p/s/r/raw/notes.md5"),"abcd");await fs.writeFile(path.join(root,"g/p/s/unknown.bin"),"support");await fs.writeFile(path.join(root,"g/p/loose.fastq"),"unknown");
 const stat=await fs.lstat(path.join(root,"g/p/s/r/raw/actual.fq"));
 input={version:1,batchId:"2026-10-16",decisionAuthority:"explicit test approval",targets:[{entryId:"p",projectId:String(ids.project),relativeRoot:"/g/p",expectedFiles:4,expectedBytes:22,disposition:"archive"},{entryId:"empty",projectId:String(ids.empty),relativeRoot:"/g/empty",expectedFiles:0,expectedBytes:0,disposition:"retire-records-retain-history"}],
 pathCorrections:[{entryId:"p",fileId:String(ids.file),readId:String(ids.read),runId:String(ids.run),beforePath:"/g/p/s/r/raw/old.txt",afterPath:"/g/p/s/r/raw/actual.fq"}],
 checksums:[{canonicalPath:path.join(root,"g/p/s/r/raw/actual.fq"),identity:{...reg.statFields(stat),nlink:stat.nlink},stable:true,bytes:4,md5:"current",sha256:"a".repeat(64)}]};
 context={db,datastoreRoot:root,workDir:work,actor:"deeks",toolVersion:"test-version",databaseIdentity:{name:"scratch"}};
});
afterEach(async()=>{await fs.rm(directory,{recursive:true,force:true});});
const prepare=()=>migration.prepare({...context,input});
const plan=async()=>JSON.parse(await fs.readFile(path.join(work,"plan.json")));
test("plans evidenced parents, keeps unknown scientific role and current hashes separate from legacy claims",async()=>{
 const result=await prepare(),p=await plan();expect(result.newFiles).toBe(3);expect(data.reads[0].MD5).toBe("historical");
 const additions=p.operations.filter(o=>o.collection==="additionalfiles").map(o=>migration.unpack(o.insertBson));
 expect(additions.some(a=>String(a.run)===String(ids.run))).toBe(true);expect(additions.some(a=>String(a.sample)===String(ids.sample))).toBe(true);expect(additions.some(a=>String(a.project)===String(ids.project))).toBe(true);
 const op=p.operations.find(o=>o.collection==="files"&&o.beforeBson),after=migration.materialize(p,op,new Date("2026-10-22"),result.planSha256);
 expect(after.originalName).toBe("old.txt");expect(after.createdAt).toBeInstanceOf(Date);expect(after.path).toMatch(/actual.fq$/);
 expect(after.reconciliation.currentObservation.md5).toBe("current");expect(after.reconciliationHistory[0].changes.path.before).toMatch(/old.txt$/);expect(after.destinationMd5).toBeUndefined();
});
test("records technical associations and empty unregistered roots without inventing projects",async()=>{
 await fs.mkdir(path.join(root,"g/legacy"),{recursive:true});await fs.writeFile(path.join(root,"g/legacy/file"),"x");
 await fs.mkdir(path.join(root,"g/unused"));data.runs.push({_id:oid(),sample:ids.sample,path:"/g/legacy/r"});
 input.targets.push({entryId:"ntalbot-031",relativeRoot:"/g/legacy",expectedFiles:1,expectedBytes:1,disposition:"archive"},{entryId:"unused",relativeRoot:"/g/unused",expectedFiles:0,expectedBytes:0,disposition:"record-empty-directory"},{entryId:"keep",relativeRoot:"/not/inspected",disposition:"keep"});
 const result=await prepare();expect(result.holds).toHaveLength(1);expect(result.holds[0].associations[0].projectId).toBe(String(ids.project));expect(result.summaries.find(s=>s.entryId==="unused").status).toBe("empty-directory-recorded");
 expect((await plan()).operations.filter(o=>o.collection==="projects"&&!o.beforeBson)).toEqual([]);
});
test("preserves literal root spelling and corrects only physically evidenced descendant paths",async()=>{
 await fs.rename(path.join(root,"g/p"),path.join(root,"g/P"));input.targets[0].relativeRoot="/g/P";input.targets[0].correctRoot=true;input.targets[0].previousRoot="/g/p";
 input.pathCorrections[0].afterPath="/g/P/s/r/raw/actual.fq";input.checksums=[];
 const result=await prepare(),p=await plan();expect(result.holds).toEqual([]);
 expect(p.operations.filter(o=>["projects","samples","runs"].includes(o.collection)&&o.entryId==="p").map(o=>migration.unpack(o.setBson).path).sort()).toEqual(["/g/P","/g/P/s","/g/P/s/r"]);
});
test("retains symlink metadata without following/copying it or claiming another File",async()=>{
 await fs.symlink(__filename,path.join(root,"g/p/link"));await prepare();const p=await plan(),ledger=migration.unpack(p.operations.find(o=>o.collection==="archiveReconciliations"&&o.entryId==="p").insertBson);
 expect(ledger.nonRegularEntries).toEqual([expect.objectContaining({type:"symlink",status:"retained-link-not-followed-or-catalogued-as-file"})]);
 expect(p.operations.filter(o=>o.collection==="files"&&!o.beforeBson)).toHaveLength(3);
});
test("changed metadata never inherits an earlier checksum observation",async()=>{
 input.checksums[0].identity.ino++;await prepare();const p=await plan();expect(p.operations.find(o=>o.collection==="files"&&o.beforeBson).options.currentObservation).toBeUndefined();
});
test.each([
 ["file association changed",()=>{data.reads[0].run=oid();}],
 ["outside File reference",()=>{data.reads.push({_id:oid(),file:ids.file,run:oid()});}],
 ["orphan File claim",()=>{data.files.push({_id:oid(),path:"/g/p/loose.fastq"});}],
 ["duplicate File identity",()=>{data.files.push({...data.files[0],_id:oid(),path:"/g/p/s/r/raw/actual.fq"});}],
 ["wrong project group",()=>{data.projects[0].group=oid();}],
 ["non-HPC project",()=>{data.projects[0].storage={state:"migrating"};}],
 ["new project claim",()=>{data.projects.push({_id:oid(),path:"/g/P"});}],
 ["inventory drift",()=>{input.targets[0].expectedBytes++;}],
 ["duplicate input",()=>{input.targets.push(input.targets[0]);}],
 ["retirement has pending work",()=>{const sample=oid(),run=oid();data.samples.push({_id:sample,project:ids.empty});data.runs.push({_id:run,sample});data.ingestjobs.push({_id:oid(),runId:run,status:"pending"});}],
 ["wrong prior filename",()=>{input.pathCorrections[0].beforePath="/different";}],
 ["batch already executed",()=>{data.archiveReconciliations=[{_id:oid(),batchId:"2026-10-16"}];}],
])("refuses %s before producing an executable plan",async(_,mutate)=>{mutate();await expect(prepare()).rejects.toThrow();await expect(fs.stat(path.join(work,"plan.json"))).rejects.toMatchObject({code:"ENOENT"});});
