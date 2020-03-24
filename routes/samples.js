const express = require("express")
let router = express.Router();
const Sample = require('../models/Sample')
const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
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
                .populate({ path: 'additionalFiles', populate: { path: 'file' } })
                .then(sample => {
                    //TODO check they have permissions
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
        const newSample = new Sample({
            name: req.body.name,
            project: req.body.project,
            scientificName: req.body.scientificName,
            commonName: req.body.commonName,
            ncbi: req.body.ncbi,
            conditions: req.body.conditions,
            owner: req.body.owner,
            group: req.body.group,
        })

        let returnedSample;
        newSample.save()
            .then(savedSample => {
                returnedSample = savedSample;
                const additionalFiles = req.body.additionalFiles;

                console.log('body', req.body)

                const filePromises = additionalFiles.map(file => {
                    return File.findOne({
                        name: file.uploadName
                    })
                        .then(foundFile => {
                            if (foundFile) {
                                return new AdditionalFile({
                                    sample: savedSample._id,
                                    file: foundFile._id
                                })
                                    .save()
                            } else {
                                Promise.resolve()//TODO:bad
                            }
                        })
                })


                return Promise.all([filePromises])

            })
            .then(() => {
                res.status(200).send({ sample: returnedSample })
            })
            .catch(err => {
                console.error('ERROR', err);
                res.status(500).send({ error: err })
            })

        // })
        // .catch(err => {
        //     res.status(500).send({ error: err })
        // })
    });

module.exports = router;
