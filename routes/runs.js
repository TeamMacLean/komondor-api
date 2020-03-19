const express = require("express")
let router = express.Router();
const Run = require('../models/Run')
const { isAuthenticated } = require('./middleware')

router.route('/runs')
    .all(isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        iCanSee(req.user)
            .populate('group')
            .sort('-createdAt')
            .then(runs => {
                res.status(200).send({ runs })
            })
            .catch(err => {
                res.status(500).send({ error: err })
            });

    });

router.route('/run')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {
            Run.findById(req.query.id)
                .populate('group')
                .populate('sample')
                .populate({ path: 'additionalFiles' })
                .populate({ path: 'rawFiles' })
                .then(run => {
                    //TODO check they have permissions

                     

                    if (run) {
                        res.status(200).send({ run });
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

router.route('/runs/new')
    .all(isAuthenticated)
    .post((req, res) => {
        //TODO check permission

        let additionalFileGroup;
        let rawFileGroup;

        const MD5s = req.body.MD5s;

        //TODO: update files with MD5s

        console.log('body', req.body)
        const newRun = new Run({
            sample: req.body.sample,
            name: req.body.name,
            sequencingProvider: req.body.sequencingProvider,
            sequencingTechnology: req.body.sequencingTechnology,
            librarySource: req.body.librarySource,
            libraryType: req.body.libraryType,
            librarySelection: req.body.librarySelection,
            libraryStrategy: req.body.libraryStrategy,
            insertSize: req.body.insertSize,

            additionalFilesUploadID: req.body.additionalUploadID,
            rawFilesUploadID: req.body.rawUploadID,

            owner: req.body.owner,
            group: req.body.group,
        })

        newRun.save()
            .then(savedRun => {
                res.status(200).send({ run: savedRun })
            })
            .catch(err => {
                console.error(err);
                res.status(500).send({ error: err })
            })
        // })






        // sample: res.data.sample._id,
        //               libraryType: null,
        //               sequencingProvider: null,
        //               sequencingTechnology: null,
        //               librarySource: null,
        //               librarySelection: null,
        //               libraryStrategy: null,
        //               insertSize: null,
        //               additionalUploadID: uuidv4(),
        //               rawUploadID: uuidv4()


    });

module.exports = router;
