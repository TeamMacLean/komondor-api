const express = require("express")
let router = express.Router();
const Run = require('../models/Run')
const Read = require('../models/Read');
const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const { isAuthenticated } = require('./middleware')
const _path = require('path')
const fs = require('fs');
const { sortAdditionalFiles, sortReadFiles } = require('../lib/sortAssociatedFiles');

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
                            const dirRoot = _path.join(process.env.DATASTORE_ROOT, run.path);
                            const rawDir = _path.join(dirRoot, 'raw');
                            const additionalDir = _path.join(dirRoot, 'additional');

                            var rawDirExists = false;
                            try {
                                rawDirExists = fs.statSync(rawDir).isDirectory();
                            } catch (e) {
                                rawDirExists = false
                            }
                            
                            var readFiles = [];
                            var readFilesResults = [];

                            if (rawDirExists){
                                readFilesResults = fs.readdirSync(rawDir)
                            }
                            if (readFilesResults.length){
                                readFiles = readFilesResults.filter(file => !file.includes('.DS_Store'))
                            }

                            var additionalDirExists = false;
                            try {
                                additionalDirExists = fs.statSync(additionalDir).isDirectory();
                            } catch (e) {
                                additionalDirExists = false
                            }

                            var additionalFiles = [];
                            var additionalFilesResults = [];

                            if (additionalDirExists){
                                additionalFilesResults = fs.readdirSync(additionalDir)
                            }
                            if (additionalFilesResults.length){
                                additionalFiles = additionalFilesResults
                            }

                            res.status(200).send({
                                run: run,
                                actualReads: readFiles,
                                actualAdditionalFiles: additionalFiles,
                            });

                        } catch (e) {
                            console.error(e, e.message)
                            res.status(501).send({error: 'readdir error'})
                        }

                    } else {
                        res.status(501).send({ error: 'runnot found' });
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
            .then(async savedRun => {
                returnedRun = savedRun;
                const additionalFiles = req.body.additionalFiles;
                const readFiles = req.body.rawFiles;

                try {

                    const promList = []
                    if (readFiles.length){
                        promList.push(sortReadFiles(readFiles, returnedRun._id, returnedRun.path))
                    }
                    if (additionalFiles.length){
                        promList.push(sortAdditionalFiles(additionalFiles, 'run', returnedRun._id, returnedRun.path))
                    }

                    return await Promise.all(promList);
                    //const output = await Promise.all(promList)  
                    // console.log('output', output);
                    // return Promise.resolve();

                } catch (e){
                    // if issue with files, remove run
                    await Run.deleteOne({ '_id': returnedRun._id });                        
                    return Promise.reject(e);
                }                
            })
            .then(() => {
                res.status(200).send({ run: returnedRun })
            })
            .catch(err => {
                console.error(err);
                res.status(500).send({ error: err })
            })
    });

module.exports = router;
