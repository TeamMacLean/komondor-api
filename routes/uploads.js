const express = require('express');
const router = express.Router();
const tus = require('tus-node-server');
const fileUpload = require('../fileUpload');
const path = require('path');


const tusServer = new tus.Server();
console.log('dir', __dirname);
tusServer.datastore = new tus.FileStore({
    directory:process.env.UPLOAD_PATH,
    path: '/uploads'
});
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, (event) => {
    fileUpload.create(event);
});

// const express = require('express');
const uploadApp = express();
uploadApp.all('*', tusServer.handle.bind(tusServer));
router.use('/uploads', uploadApp);

module.exports =  router;
