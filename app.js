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
