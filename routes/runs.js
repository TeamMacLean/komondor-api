const express = require("express")
let router = express.Router();
const Run = require('../models/Run')
const Read = require('../models/Read');
const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
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
                .populate({ path: 'additionalFiles', populate: { path: 'file' } })
                .populate({ path: 'rawFiles', populate: { path: 'file' } })
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

            // additionalFilesUploadID: req.body.additionalUploadID,
            // rawFilesUploadID: req.body.rawUploadID,

            owner: req.body.owner,
            group: req.body.group,
        })
        let returnedRun;
        newRun.save()
            .then(savedRun => {
                returnedRun = savedRun;
                const additionalFiles = req.body.additionalFiles;
                const rawFiles = req.body.rawFiles;

                const filePromises = additionalFiles.map(file => {
                    return File.findOne({
                        name: file.uploadName
                    })
                        .then(foundFile => {
                            if (foundFile) {
                                return new AdditionalFile({
                                    run: savedRun._id,
                                    file: foundFile._id
                                })
                                    .save()
                            } else {
                                Promise.resolve()//TODO:bad
                            }
                        })
                })

                const rawFilePromises = rawFiles.map(file => {
                    return File.findOne({
                        name: file.uploadName
                    })
                        .then(found => {
                            if (found) {
                                return new Read({
                                    run: savedRun._id,
                                    paired: file.paired,
                                    // sibling: 'TODO', 
                                    MD5: file.md5,
                                    file: found._id
                                })
                                    .save()
                            } else {
                                return Promise.resolve()//TODO:bad
                            }
                        })
                        
                    })

                return Promise.all(rawFilePromises.concat(filePromises))

            })
            .then(() => {
                res.status(200).send({ run: returnedRun })
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
