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
                                //console.log('Reading this dir:', rawDir, 'Getting these results:', readFilesResults);                                
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
            owner: req.body.owner,
            group: req.body.group,
        })

        /** 
            this.run.rawFilesUploadMethod = "hpc-mv" or 'local-filesystem'
            this.run.paired
            this.run.hpcRawFiles = {
                relativePath: this.targetDirectoryName,
                files: [{
                    name: '',
                    MD5: '',
                    sibling: '',
                }],
            }
        */

        // console.log('paired', req.body.paired);
        // console.log('rawFilesUploadMethod', req.body.rawFilesUploadMethod);
        // console.log('hpcRawFiles', req.body.hpcRawFiles);
        // console.log('jic', req.body);

        const rawFilesUploadInfo = req.body.rawFilesUploadInfo;

        // res.status(500).send({ error: 'no chances to escape' })
        
        /** 
            data: File
                lastModified: 1592992875792
                name: "additional-demo.bam"
                size: 2560
                type: ""
            extension: "bam"
            id: "uppy-additional/demo/bam-1d-1e-application/octet-stream-2560-1592992875792"
            md5: "a371492f16c0940507435909603efe88"
            meta: Object
                name: "additional-demo.bam"
                relativePath: null
                type: "application/octet-stream"
            name: "additional-demo.bam"
            paired: false
            response: Object
                uploadURL: "http://localhost:3030/uploads/files/f6578457a259abc8ecf69a5b2b4c4b59"
            rowID: "1c90e017-561b-4a54-8f6c-c1cf8a3400b3"
            size: 2560
            source: "DragDrop"
            tus: Object
                uploadUrl: "http://localhost:3030/uploads/files/f6578457a259abc8ecf69a5b2b4c4b59"
            type: "application/octet-stream"
            uploadName: "f6578457a259abc8ecf69a5b2b4c4b59"
            uploadURL: "http://localhost:3030/uploads/files/f6578457a259abc8ecf69a5b2b4c4b59"
        */

        let returnedRun;
        newRun.save()
            .then(async savedRun => {
                returnedRun = savedRun;
                
                const additionalFiles = req.body.additionalFiles;         

                let readFiles = req.body.rawFiles || null;
                
                try {
                    const promList = []
    
                    if (readFiles.length){
                        promList.push(sortReadFiles(readFiles, returnedRun._id, returnedRun.path, rawFilesUploadInfo))
                    }
                    if (additionalFiles.length){
                        promList.push(sortAdditionalFiles(additionalFiles, 'run', returnedRun._id, returnedRun.path))
                    }

                    return await Promise.all(promList);
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
