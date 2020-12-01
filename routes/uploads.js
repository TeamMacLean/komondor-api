const express = require("express")
let router = express.Router();
const tus = require('tus-node-server')
const fileUpload = require('../lib/fileUpload')
const { isAuthenticated } = require("./middleware")
const _path = require("path")
const UPLOAD_PATH = _path.join(process.cwd(), 'uploads');

const tusServer = new tus.Server();

tusServer.datastore = new tus.FileStore({
  //directory: UPLOAD_PATH,
  // this uploads the file temporarily locally
  // on form submission we will move this temp file to actual upload location
  path: "/files",
  relativeLocation: true,
});

// console.log('tusserver', tusServer.options, tusServer, Object.keys(tusServer));

// tusServer.on('*', event => {
//   console.log('EVENT!', event)
// })
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, event => {
  // Fired when a PATCH request finishes writing the file
  console.log('EVENT_UPLOAD_COMPLETE', event)
  //fileUpload.create(event)
});

tusServer.on(tus.EVENTS.EVENT_FILE_CREATED, event => {
  console.log('EVENT_FILE_CREATED', event)
});
tusServer.on(tus.EVENTS.EVENT_ENDPOINT_CREATED, event => {
  console.log('EVENT_ENDPOINT_CREATED', event)
});

// const express = require('express');
const uploadApp = express();
uploadApp.all("*", function (req, res, next) {

  // This doesnt work
  // req.setHeader('Access-Control-Allow-Origin', '*');

  // console.log('Got an UPLOADS req! useful info: ' + 
  //   '\nreq.method', (req && req.method) ? req.method : 'unknown',
  //   '\nreq.protocol', (req && req.protocol) ? req.protocol : 'unknown',
  //   '\nreq.xhr', (req && req.xhr) ? req.xhr : 'unknown',
  //   '\nreq.getHeader(Access-Control-Allow-Origin)', req.get('Access-Control-Allow-Origin'),
  //   '\nreq.getHeader(Access-Control-Allow-Methods)', req.get('Access-Control-Allow-Methods'),
  //   '\nreq.getHeader(Access-Control-Allow-Headers)', req.get('Access-Control-Allow-Headers'),
  //   '\nreq.getHeader(Access-Control-Allow-Credentials)', req.get('Access-Control-Allow-Credentials'),
  // );  
  
  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Request methods you wish to allow
  // res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS, PUT, PATCH, DELETE');
  // // Request headers you wish to allow
  // res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Origin, Accept');
  // // Set to true if you need the website to include cookies in the requests sent to the API (e.g. in case you use sessions)
  // res.setHeader('Access-Control-Allow-Credentials', false);

  //console.log('upload res headers', res.headers, res);
  
  tusServer.handle.bind(tusServer)(req, res, next);
})
// uploadApp.all("*", tusServer.handle.bind(tusServer));

// maybe one day, George
// uploadApp.use('uploads, uploadApp')
// uploadApp.listen(process.env.PORT, process.env.HOST)

router.use("/uploads", uploadApp);

router.route('/upload/cancel')
  .all(isAuthenticated)
  .post((req, res, next) => {

    res.status(200).send({})
  })

module.exports = router;
