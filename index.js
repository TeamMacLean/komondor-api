require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const projectsRoutes = require('./routes/projects');
const samplesRoutes = require('./routes/samples');
const searchRoutes = require('./routes/search');
const groupRoutes = require('./routes/groups');
const userRoutes = require('./routes/users');
const newsRoutes = require('./routes/news');
const uploadRoutes = require('./routes/uploads');
const Utils = require("./utils");

const PORT = process.env.PORT;

try {
    mongoose.connect('mongodb://localhost:27017/komondor', {useNewUrlParser: true});
} catch (err) {
    console.error(err);
}

const app = express();
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});

/**
 * get user if auth token in request
 */
app.use((req, res, next) => {
    Utils.getUserFromRequest(req)
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
app.use(searchRoutes);
app.use(groupRoutes);
app.use(userRoutes);
app.use(newsRoutes);
app.use(uploadRoutes);


app.listen(PORT, () => console.log(`API running on port ${PORT}!`));