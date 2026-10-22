const fs=require("fs").promises,path=require("path"),os=require("os");
const {relativeTo,resolvePhysicalFile,fileUri,attachFileLocations}=require("../../lib/physical-file-path");
const {compareFilesToDirectory}=require("../../routes/_utils");
let root,oldRoot;
beforeEach(async()=>{root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"physical-path-")));oldRoot=process.env.DATASTORE_ROOT;process.env.DATASTORE_ROOT=root;
 await fs.mkdir(path.join(root,"g/P/r/raw"),{recursive:true});await fs.mkdir(path.join(root,"g/P/r/processed"));
 await fs.writeFile(path.join(root,"g/P/r/processed/actual.fq"),"data");await fs.writeFile(path.join(root,"g/P/r/raw/notes.md5"),"checksum");});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});if(oldRoot===undefined)delete process.env.DATASTORE_ROOT;else process.env.DATASTORE_ROOT=oldRoot;});
test.each(["/g/P/../outside","/g/P//file","/g/P/./file","/other/project/file","/g/P/file\u0000x","/g/P/file\\x",null])("refuses untrusted path %s",v=>expect(relativeTo("/g/P",v)).toBeNull());
test("real file resolution uses exact spelling and rejects a directory",async()=>{
 expect(await resolvePhysicalFile(root,"/g/P","g/P/r/processed/actual.fq")).toBe(path.join(root,"g/P/r/processed/actual.fq"));
 await expect(resolvePhysicalFile(root,"/g/P","g/P/r/processed")).rejects.toThrow(/regular/);
});
test("copy locations use the stored path for HPC and the matching project-relative S3 key",()=>{
 const file={path:"g/P/r/processed/actual.fq",originalName:"old.txt"};
 expect(fileUri({path:"/g/P"},file)).toBe((process.env.READS_ROOT_PATH||"/tsl/data/reads")+"/g/P/r/processed/actual.fq");
 const p={path:"/g/P",storage:{state:"aws_pending_hpc_deletion",s3Uri:"s3://bucket/g/P",s3VerifiedAt:new Date()}};
 expect(fileUri(p,file)).toBe("s3://bucket/g/P/r/processed/actual.fq");expect(fileUri(p,{path:"/g/elsewhere/file"})).toBeNull();
 const records=[{file:{...file}}];attachFileLocations(records,p);expect(records[0].file.locationUri).toMatch(/^s3:/);
});
test("a processed read and its checksum beside raw files are not falsely missing or untracked",async()=>{
 const reads=[{_id:"read",file:{originalName:"old.txt",path:"/g/P/r/processed/actual.fq"}}];
 const support=[{file:{path:"g/P/r/raw/notes.md5"}}];
 const result=await compareFilesToDirectory(reads,path.join(root,"g/P/r/raw"),{path:"/g/P"},support);
 expect(result.status).toMatchObject({status:"OK",missing:[],extra:[],unresolved:[],elsewhere:["/g/P/r/processed/actual.fq"]});
 reads[0].file.path="g/P/missing";expect((await compareFilesToDirectory(reads,path.join(root,"g/P/r/raw"),{path:"/g/P"})).status.missing).toEqual(["g/P/missing"]);
 reads[0].file.path="g/other/file";expect((await compareFilesToDirectory(reads,path.join(root,"g/P/r/raw"),{path:"/g/P"})).status.unresolved).toEqual(["g/other/file"]);
});
