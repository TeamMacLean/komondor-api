const express = require("express")
let router = express.Router();
const cors = require("cors")

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
  //relativeLocation: true,
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

const HEADERS = [
  'Authorization',
  'Content-Type',
  'Location',
  'Tus-Extension',
  'Tus-Max-Size',
  'Tus-Resumable',
  'Tus-Version',
  'Upload-Defer-Length',
  'Upload-Length',
  'Upload-Metadata',
  'Upload-Offset',
  'X-HTTP-Method-Override',
  'X-Requested-With',
];
const EXPOSED_HEADERS = HEADERS.join(', ');
var corsOptions = {
  origin: '*',
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  exposedHeaders: EXPOSED_HEADERS,
}


// const express = require('express');
const uploadApp = express();
uploadApp.use(cors(corsOptions));
uploadApp.all("*", function (req, res, next) {
  //res.setHeader('Access-Control-Allow-Origin', '*');
  // if (req.method === 'POST'){
  //   console.log('post method');
  // } else if (req.method === 'PATCH'){
  //   console.log('post method');
  // } else if (!req.method){
  //   console.log('no req method found for this req');
  // } else {
  //   console.log('req method used:', req.method);
  // }
    
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
