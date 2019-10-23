const Middleware = require("./middleware");

const express = require('express');
const router = express.Router();
const Project = require('../models/Project');

router
    .route('/search/projects')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {

        if (req.query.name.length) {
            //TODO check permission
            Project.find({name: {$in: req.query.name}})
                .then(projects => {
                    res.status(200).send({results: projects})
                    // res.status(200).send({results:projects})
                })
                .catch(err => {
                    res.status(500).send({error: err})
                })
        } else {
            res.status(200).send({results: []})
        }

    });

module.exports =  router;
