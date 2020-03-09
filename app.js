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
const getUserFromRequest = require("./lib/utils/getUserFromRequest")

const app = express();
const corsOptions = {
    "origin": "http://api.datahogbeta.tsl.ac.uk",
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "preflightContinue": true,
    "optionsSuccessStatus": 200
}
app.use(cors(corsOptions));
app.options('*', cors(corsOptions))

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(function (req, res, next) {
    console.log('DEBUG:', req.method, req.originalUrl);
    next();
})

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// app.use((req, res, next) => {
//     console.log(req.method, req.url);
//     next();
// });

/**
 * get user if auth token in request
 */
app.use((req, res, next) => {
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

module.exports = app;
