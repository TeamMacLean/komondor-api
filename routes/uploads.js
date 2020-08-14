const express = require("express")
let router = express.Router();
const tus = require('tus-node-server')
const fileUpload = require('../lib/fileUpload')
const { isAuthenticated } = require("./middleware")
//const path = require("path")
//const UPLOAD_PATH = path.join(process.cwd(), 'uploads');

const tusServer = new tus.Server();
tusServer.datastore = new tus.FileStore({
  //directory: UPLOAD_PATH, I don't think we need this
  // this uploads the file temporarily locally
  // on form submission we will move this temp file to actual upload location
  path: "/uploads"
});

tusServer.on('*', event=>{
  // console.log('EVENT!, event')
})
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, event => {
  // console.log(tus.EVENTS.EVENT_UPLOAD_COMPLETE)
  fileUpload.create(event)
});

tusServer.on(tus.EVENTS.EVENT_FILE_CREATED, event => {
  // console.log(tus.EVENTS.EVENT_FILE_CREATED)
});
tusServer.on(tus.EVENTS.EVENT_ENDPOINT_CREATED, event => {
  // console.log(tus.EVENTS.EVENT_ENDPOINT_CREATED)
});

// const express = require('express');
const uploadApp = express();
// uploadApp.all('*', function(req, res, next){
//    
// })
// uploadApp.all("*", function (req, res, next) {
//   console.log('ALERTED HERE TOO!!', req);
//   tusServer.handle.bind(tusServer)(req, res, next);
// })
uploadApp.all("*", tusServer.handle.bind(tusServer));

router.use("/uploads", uploadApp);

router.route('/upload/cancel')
  .all(isAuthenticated)
  .post((req, res, next) => {

    res.status(200).send({})
  })

module.exports = router;
