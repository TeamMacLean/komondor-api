const express = require("express")
let router = express.Router();
const tus = require('tus-node-server')
const fileUpload = require('../lib/fileUpload')
const path = require("path")
const UPLOAD_PATH = path.join(process.cwd(), 'uploads');

const tusServer = new tus.Server();
tusServer.datastore = new tus.FileStore({
  directory: UPLOAD_PATH,
  path: "/uploads"
});
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, event => {
  fileUpload.create(event)
});

// const express = require('express');
const uploadApp = express();
// uploadApp.all('*', function(req, res, next){
//   console.log('event!!', req.originalUrl);
// })
uploadApp.all("*", tusServer.handle.bind(tusServer));
router.use("/uploads", uploadApp);

module.exports = router;
