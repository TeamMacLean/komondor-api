const { isAuthenticated } = require("./middleware")

const express = require("express")
let router = express.Router();

const Project = require('../models/Project')
const Sample = require('../models/Sample');
const Run = require('../models/Run');
// const Read;

function searchProjects(user, query) {
    return new Promise((resolve, reject) => {
        Project.iCanSee(user)
            .populate('group')
            .then(projects => {
                const filteredProjects = projects.filter(p => {
                    return p.name.toLowerCase().includes(query);
                })
                resolve(filteredProjects);
            })
            .catch(reject)
    })
}

function searchSamples(user, query) {
    return new Promise((resolve, reject) => {
        Sample.iCanSee(user)
            .populate('group')
            .then(samples => {
                const filteredSamples = samples.filter(s => {
                    return s.name.toLowerCase().includes(query);
                })
                resolve(filteredSamples);
            })
            .catch(reject)
    })
}

function searchRuns(user, query) {
    return new Promise((resolve, reject) => {
        Run.iCanSee(user)
            .populate('group')
            .then(runs => {
                const filteredRuns = runs.filter(r => {
                    return r.name.toLowerCase().includes(query);
                })
                resolve(filteredRuns);
            })
            .catch(reject)
    })
}

router
    .route('/search')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.query) {
            Promise.all([
                searchProjects(req.user, req.query.query),
                searchSamples(req.user, req.query.query),
                searchRuns(req.user, req.query.query)
            ])
                .then(outputs => {

                    console.log('pi', Date.now(), outputs)

                    const results = {
                        projects: outputs[0],
                        samples: outputs[1],
                        runs: outputs[2],
                    }

                    res.status(200).send({ results })
                })
                .catch(err => {
                    console.error(err);
                    res.status(500).send({ error: err })
                })
        } else {
            res.status(200).send({ results: [] })
        }

    });


router.route('/search/project')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.query) {
            searchProjects(req.user, req.query.query)
                .then(results => {
                    res.status(200).send({ results })
                })
                .catch(err => {
                    res.status(200).send({ results: [] })
                })
        } else {
            res.status(200).send({ results: [] })
        }
    });
router.route('/search/sample')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.query) {
            searchSamples(req.user, req.query.query)
                .then(results => {
                    res.status(200).send({ results })
                })
                .catch(err => {
                    res.status(200).send({ results: [] })
                })
        } else {
            res.status(200).send({ results: [] })
        }
    });
router.route('/search/run')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.query) {
            searchRuns(req.user, req.query.query)
                .then(results => {
                    res.status(200).send({ results })
                })
                .catch(err => {
                    res.status(200).send({ results: [] })
                })
        } else {
            res.status(200).send({ results: [] })
        }
    });

module.exports = router;
