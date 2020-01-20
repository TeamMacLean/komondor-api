const express =require( "express")
let router = express.Router();
// import {Server,DataStore,FileStore,EVENTS} from "tus-node-server";
// import { Server, FileStore } from 'tus-node-server';
const tus =require( 'tus-node-server')


const tusServer = new tus.Server();
tusServer.datastore = new tus.FileStore({
  directory: process.env.UPLOAD_PATH,
  path: "/uploads"
});
// tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, event => {
//   create(event);
// });

// const express = require('express');
const uploadApp = express();
uploadApp.all("*", tusServer.handle.bind(tusServer));
router.use("/uploads", uploadApp);

module.exports =  router;
