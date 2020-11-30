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
app.use(cors());

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

    // Website you wish to allow to connect
    // TODO try variants of this: http://sequences.tsl.ac.uk/ (this itself didnt work)
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Origin, Accept');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    // false cos of line 41
    res.setHeader('Access-Control-Allow-Credentials', false);

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
