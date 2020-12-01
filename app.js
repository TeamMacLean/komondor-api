const express = require("express")
const cors = require("cors")
const dotenv = require('dotenv')
dotenv.config();

const authRoutes = require("./routes/auth")
const projectsRoutes = require("./routes/projects")
const samplesRoutes = require("./routes/samples")
const runRoutes = require('./routes/runs');
const searchRoutes = require("./routes/search")
const groupRoutes = require("./routes/groups")
const userRoutes = require("./routes/users")
const newsRoutes = require("./routes/news")
const uploadRoutes = require("./routes/uploads")
const optionRoutes = require('./routes/options')
const testRoutes = require("./routes/test")
const getUserFromRequest = require("./lib/utils/getUserFromRequest")

const app = express();

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

app.use(cors(corsOptions));

// if desperate, try
//app.options('*', cors(corsOptions));



app.use(function (req, res, next) {
    next();
})

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// app.use((req, res, next) => {
//      
//     next();
// });

/**
 * get user if auth token in request
 */
app.use((req, res, next) => {

    // removed res.setHeaders to uploads route only

    // REQUESTING MIGHT REMOVE THE REQ HEADERS
//     console.log('Got a APP_LEVEL req! useful info: ' + 
//     '\nreq.method', (req && req.method) ? req.method : 'unknown',
//     '\nreq.protocol', (req && req.protocol) ? req.protocol : 'unknown',
//     '\nreq.xhr', (req && req.xhr) ? req.xhr : 'unknown',
//     '\nreq.getHeader(Access-Control-Allow-Origin)', req.get('Access-Control-Allow-Origin'),
//     '\nreq.getHeader(Access-Control-Allow-Methods)', req.get('Access-Control-Allow-Methods'),
//     '\nreq.getHeader(Access-Control-Allow-Headers)', req.get('Access-Control-Allow-Headers'),
//     '\nreq.getHeader(Access-Control-Allow-Credentials)', req.get('Access-Control-Allow-Credentials'),
//   );  

    getUserFromRequest(req)
        .then(user => {
            if (user) {
                req.user = user;
            }
            next();
        })
        .catch(err => {
            next(err);
        });
});

app.use(authRoutes);
app.use(projectsRoutes);
app.use(samplesRoutes);
app.use(runRoutes);
app.use(searchRoutes);
app.use(groupRoutes);
app.use(userRoutes);
app.use(newsRoutes);
app.use(optionRoutes);
app.use(uploadRoutes);
app.use(testRoutes);

module.exports = app;
