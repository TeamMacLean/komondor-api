const express = require("express")
let router = express.Router();
const Sample = require('../models/Sample')
const { isAuthenticated } = require('./middleware')

router.route('/samples')
    .all(isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        Sample.iCanSee(req.user)
            .populate('group')
            .sort('-createdAt')
            .then(samples => {
                res.status(200).send({ samples })
            })
            .catch(err => {
                res.status(500).send({ error: err })
            });

    });

router.route('/sample')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            Sample.findById(req.query.id)
                .populate('group')
                .populate('project')
                .populate({ path: 'runs', populate: { path: 'group' } })
                .populate({ path: 'additionalFiles' })
                .then(sample => {
                    //TODO check they have permissions

                    console.log('sample', sample);

                    if (sample) {
                        res.status(200).send({ sample });
                    } else {
                        res.status(501).send({ error: 'not found' });
                    }
                })
                .catch(err => {
                    res.status(500).send({ error: err });
                })

        } else {
            res.status(500).send({ error: new Error('param :id not provided') })
        }
    });

router.route('/samples/new')
    .all(isAuthenticated)
    .post((req, res) => {
        //TODO check permission

        // FileGroup.findOne({ uploadID: req.body.additionalUploadID })
        //     .then(foundFileGroup => {

                const newSample = new Sample({
                    name: req.body.name,
                    project: req.body.project,
                    scientificName: req.body.scientificName,
                    commonName: req.body.commonName,
                    ncbi: req.body.ncbi,
                    conditions: req.body.conditions,
                    owner: req.body.owner,
                    group: req.body.group,
                    additionalFilesUploadID: req.body.additionalUploadID
                    // tags: req.body.tags || []
                })


                // if (foundFileGroup) {
                //     newSample.additionalFiles = foundFileGroup._id;
                // }
                newSample.save()
                    .then(savedSample => {
                        res.status(200).send({ sample: savedSample })
                    })
                    .catch(err => {
                        console.error(err);
                        res.status(500).send({ error: err })
                    })

            // })
            // .catch(err => {
            //     res.status(500).send({ error: err })
            // })
    });

module.exports = router;
