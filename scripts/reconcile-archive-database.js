#!/usr/bin/env node
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const mongoose=require("mongoose");
mongoose.set("autoIndex",false);mongoose.set("autoCreate",false);
const migration=require("../lib/archive-reconciliation");
const {readRegular,encode}=require("../lib/archive-registration");
const toolVersion=()=>crypto.createHash("sha256").update(Buffer.concat([
  "scripts/reconcile-archive-database.js","lib/archive-reconciliation.js","lib/archive-registration.js",
  "lib/reconciliation-state.js","lib/physical-file-path.js","lib/s3-archive/preflight.js","lib/s3-archive/inventory.js",
  "lib/md5-verification.js","routes/_utils.js","routes/projects.js","routes/samples.js","routes/runs.js",
  ...["Project","Sample","Run","Read","AdditionalFile","File","NewsItem","IngestJob"].map(n=>"models/"+n+".js"),
].map(f=>fs.readFileSync(path.resolve(__dirname,"..",f))))).digest("hex");
async function main(args=process.argv.slice(2)){
  const command=args.shift(),options={};
  if(!["prepare","apply"].includes(command))throw Error("Use prepare --input FILE or apply --backup-plan FILE --plan-sha256 HASH --quiescence-receipt FILE --execute; both require --work-dir DIR --database NAME --actor USER");
  const flags=["work-dir","database","actor",...(command==="prepare"?["input"]:["backup-plan","plan-sha256","quiescence-receipt","execute"])];
  while(args.length){const flag=args.shift().replace(/^--/,"");if(!flags.includes(flag)||options[flag])throw Error("Unknown/duplicate flag");options[flag]=flag==="execute"?true:args.shift();}
  if(flags.some(f=>!options[f]))throw Error("Missing required argument");
  require("dotenv").config({path:path.resolve(__dirname,"../.env")});
  if(!process.env.MONGODB_URI||!process.env.DATASTORE_ROOT)throw Error("Explicit MONGODB_URI and DATASTORE_ROOT required");
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
  try{
    const db=mongoose.connection.db;if(db.databaseName!==options.database)throw Error("Wrong database");
    const [info]=await db.listCollections({name:"projects"}).toArray();
    const databaseIdentity={name:db.databaseName,host:mongoose.connection.host,port:mongoose.connection.port,collectionUuid:info?.info?.uuid?.toString("hex")};
    if(!databaseIdentity.collectionUuid)throw Error("Cannot identify database");
    const common={db,databaseIdentity,datastoreRoot:process.env.DATASTORE_ROOT,workDir:options["work-dir"],actor:options.actor,toolVersion:toolVersion(),
      onProgress:r=>process.stderr.write(JSON.stringify(r)+"\n")};
    const result=command==="prepare"?await migration.prepare({...common,input:JSON.parse(await readRegular(options.input))}):await migration.apply({...common,
      backupPlan:options["backup-plan"],expectedSha256:options["plan-sha256"],receipt:JSON.parse(await readRegular(options["quiescence-receipt"])),execute:options.execute});
    process.stdout.write(encode(result));
  }finally{await mongoose.disconnect();}
}
if(require.main===module)main().catch(e=>{process.stderr.write(String(e.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g,"[redacted]")+"\n");process.exitCode=1});
module.exports={main,toolVersion};
