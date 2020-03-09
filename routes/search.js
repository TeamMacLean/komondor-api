const { isAuthenticated } = require("./middleware")

const express = require("express")
let router = express.Router();

const Project = require('../models/Project')
const Sample = require('../models/Sample');
const Run = require('../models/Run');

router
    .route('/search')
    .all(isAuthenticated)
    .get((req, res) => {
        console.log(req.query.name, req.user)
        if (req.query.name) {
            //TODO check permission
            Promise.all([
                Project.iCanSee(req.user),
                Sample.iCanSee(req.user),
                Run.iCanSee(req.user)
            ])


                .then(outputs => {

                    const results = {
                        projects: outputs[0].filter(o => {
                            return o.name.toLowerCase().includes(req.query.name)
                        }),
                        samples: outputs[1].filter(o => {
                            return o.name.toLowerCase().includes(req.query.name)
                        }),
                        runs: outputs[2].filter(o => {
                            return o.name.toLowerCase().includes(req.query.name)
                        }),
                    }

                    res.status(200).send({ results: results })
                })
                .catch(err => {
                    console.error(err);
                    res.status(500).send({ error: err })
                })
        } else {
            res.status(200).send({ results: [] })
        }

    });

module.exports = router;
