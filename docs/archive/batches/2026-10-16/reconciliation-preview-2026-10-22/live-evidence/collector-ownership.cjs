// Read-only, executed from stdin on v1333. No models/hooks, writes or email fields.
const root='/storage/www/komondor-api';
require(root+'/node_modules/dotenv').config({path:root+'/.env'});
const mongoose=require(root+'/node_modules/mongoose');
const {resolveMongoUri}=require(root+'/lib/utils/validateEnv');
const fields=names=>Object.fromEntries(names.split(' ').map(n=>[n,1]));
mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
(async()=>{
  const at=new Date().toISOString();
  await mongoose.connect(resolveMongoUri(process.env),{autoIndex:false,autoCreate:false,useNewUrlParser:true,useUnifiedTopology:true,serverSelectionTimeoutMS:10000});
  try {
    const db=mongoose.connection.db;
    const collections=(await db.listCollections({},{nameOnly:true}).toArray()).map(c=>c.name).sort();
    const projects=await db.collection('projects').find({$or:[{path:/^\/(ntalbot|skamoun)\//},{name:/saund|project_?(2370|2035|945|2012|809|930|2323|2178|2009|1622|1566|592|2171|539|2561|230|758)/i},{oldSafeName:/^project_/i}]},{projection:fields('_id name safeName path oldId oldSafeName owner secondaryOwner group')}).sort({_id:1}).toArray();
    const users=await db.collection('users').find({$or:[{username:{$in:['tsldata','root','shrestha','winj','saunderd','kamouns','talbotn']}},{name:/saunders|shrestha|talbot|clare.*lewis/i}]},{projection:fields('_id username name groups')}).sort({username:1}).toArray();
    console.log(JSON.stringify({at,finishedAt:new Date().toISOString(),host:require('os').hostname(),operator:require('os').userInfo().username,collections,projects,users,productionWrites:false}));
  } finally {await mongoose.disconnect();}
})().catch(e=>{console.error(e.name+': '+e.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g,'[redacted]'));process.exitCode=1;});
