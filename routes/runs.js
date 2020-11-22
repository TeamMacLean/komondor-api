const express = require("express")
let router = express.Router();
const Run = require('../models/Run')
const Read = require('../models/Read');
const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const { isAuthenticated } = require('./middleware')
const _path = require('path')
const fs = require('fs');

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

                        try {                            
                            const dir = _path.join(process.env.DATASTORE_ROOT, run.path)
                            // console.log('dir listing', dir);

                            fs.readdir(dir, (err, files) => {
                                if (err || !files.length) {
                                    // TEMP HACK TODO remove before making site live
                                    console.log(`TEMP HACK only returning ${run.rawFiles.length} raw read database entries`);

                                    // console.log('randy', run.rawFiles);
                                    
                                    res.status(200).send({
                                        run: run,
                                        reads: run.rawFiles.map(rf => rf.file.originalName),
                                    });
                                } else {
                                    
                                const filteredFiles = files.filter(file => { 

                                        if (file.includes('.DS_Store')){
                                            // console.log('ommitting: ', file);                                        
                                            return false
                                        }
                                        return true                                    
                                    })
                                
                                    // files object contains all files names
                                    res.status(200).send({ 
                                        run: run, 
                                        reads: filteredFiles,
                                    });
                                }
                            });

                        } catch (e) {
                            console.error(e, e.message)
                            res.status(501).send({error: 'custom GG error'})
                        }

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

        /* example data
        sample 5f2a8e39a8b19126e8b882de 
        name Hoggy 
        sequencingProvider EL 
        sequencingTechnology 454 GS 
        librarySource GENOMIC 
        libraryType BAM 
        librarySelection ChIP 
        libraryStrategy CLONE 
        insertSize 123
        */

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
