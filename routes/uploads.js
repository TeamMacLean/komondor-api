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
  path: "/uploads" //'/uploads'
});

tusServer.on('*', event => {
  console.log('EVENT!', event)
})
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, event => {
  console.log(tus.EVENTS.EVENT_UPLOAD_COMPLETE)
  //fileUpload.create(event)
});

tusServer.on(tus.EVENTS.EVENT_FILE_CREATED, event => {
  console.log(tus.EVENTS.EVENT_FILE_CREATED)
});
tusServer.on(tus.EVENTS.EVENT_ENDPOINT_CREATED, event => {
  console.log(tus.EVENTS.EVENT_ENDPOINT_CREATED)
});

// const express = require('express');
const uploadApp = express();
uploadApp.all("*", function (req, res, next) {

  // George freestyling
  // req.setHeader('Access-Control-Allow-Origin', '*');
  // req.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  // req.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Origin, Accept');
  // req.setHeader('Access-Control-Allow-Credentials', false);

  console.log('useful request info: ' + 
    '\nreq.method', (req && req.method) ? req.method : 'unknown',
    '\nreq.protocol', (req && req.protocol) ? req.protocol : 'unknown',
    '\nreq.xhr', (req && req.xhr) ? req.xhr : 'unknown',
    '\nreq.getHeader(Access-Control-Allow-Origin)', req.get('Access-Control-Allow-Origin'),
    '\nreq.getHeader(Access-Control-Allow-Methods)', req.get('Access-Control-Allow-Methods'),
    '\nreq.getHeader(Access-Control-Allow-Headers)', req.get('Access-Control-Allow-Headers'),
    '\nreq.getHeader(Access-Control-Allow-Credentials)', req.get('Access-Control-Allow-Credentials'),

  );
  
  
  
  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Origin, Accept');
  // Set to true if you need the website to include cookies in the requests sent to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', false);

  console.log('upload res headers', res.headers, res);
  
  tusServer.handle.bind(tusServer)(req, res, next);
})
// uploadApp.all("*", tusServer.handle.bind(tusServer));

router.use("/uploads", uploadApp);

router.route('/upload/cancel')
  .all(isAuthenticated)
  .post((req, res, next) => {

    res.status(200).send({})
  })

module.exports = router;
