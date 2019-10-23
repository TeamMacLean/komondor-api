const express = require('express');
const router = express.Router();
const Sample = require('../models/Sample');
const Middleware = require('./middleware');

router.route('/samples')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        Sample.iCanSee(req.user)
            .then(samples => {
                res.status(200).send({samples})
            })
            .catch(err => {
                res.status(500).send({error: err})
            });

    });

router.route('/sample')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            Sample.findById(req.query.id)
                .populate('group')
                .then(sample => {
                    //TODO check they have permissions

                    console.log('sample', sample);

                    if (sample) {
                        res.status(200).send({sample});
                    } else {
                        res.status(501).send({error: 'not found'});
                    }
                })
                .catch(err => {
                    res.status(500).send({error: err});
                })

        } else {
            res.status(500).send({error: new Error('param :id not provided')})
        }
    });

router.route('/samples/new')
    .all(Middleware.isAuthenticated)
    .post((req, res) => {
//TODO check permission
        new Sample({
            project: req.body.project,
            scientificName: req.body.scientificName,
            commonName: req.body.commonName,
            ncbi: req.body.ncbi,
            conditions: req.body.conditions,
            owner: req.body.owner,
            group: req.body.group,
            // tags: req.body.tags || []
        })
            .save()
            .then(savedSample => {
                res.status(200).send({sample: savedSample})
            })
            .catch(err => {
                console.error(err);
                res.status(500).send({error: err})
            })

    });

module.exports =  router;
