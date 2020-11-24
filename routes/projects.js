const express = require("express")
let router = express.Router();
const Project = require('../models/Project')
const { isAuthenticated } = require('./middleware')
const _path = require('path')
const fs = require('fs');
const { sortAdditionalFiles } = require('../lib/sortAssociatedFiles');

router.route('/projects')
    .all(isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        Project.iCanSee(req.user)
            .populate('group')
            .sort('-createdAt')
            .then(projects => {
                res.status(200).send({ projects })
            })
            .catch(err => {
                console.error('error!!!!!', err);
                res.status(500).send({ error: err })
            });

    });

router.route('/project')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            //TODO check permission
            Project.findById(req.query.id)
                .populate('group')
                .populate({ path: 'samples', populate: { path: 'group' } })
                .populate({ path: 'additionalFiles', populate: { path: 'file' } })
                .then(project => {
                    //TODO check they have permissions
                    if (project) {
                        try {                            
                            const dirRoot = _path.join(process.env.DATASTORE_ROOT, project.path);
                            const additionalDir = _path.join(dirRoot, 'additional');

                            fs.stat(additionalDir, function(err, stats) {
                                if (err || !stats.isDirectory()){                                    
                                    res.status(200).send({
                                        project: project,
                                        actualAdditionalFiles: [],
                                    });
                                } else {
                                    fs.readdir(additionalDir, (additionalFilesErr, additionalFiles) => {
                                        if (additionalFilesErr){
                                            throw new Error(additionalFilesErr)
                                        }
                                        res.status(200).send({
                                            project: project,
                                            actualAdditionalFiles: additionalFiles,
                                        });
                                    })  
                                }                                
                            });
                        } catch (e) {
                            console.error(e, e.message)
                            res.status(501).send({error: 'unexpected readdir error'})
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

router.route('/projects/new')
    .all(isAuthenticated)
    .post((req, res) => {
        //TODO check permission

        const newProject = new Project({
            name: req.body.name,
            group: req.body.group,
            shortDesc: req.body.shortDesc,
            longDesc: req.body.longDesc,
            owner: req.body.owner,
            additionalFilesUploadID: req.body.additionalUploadID,
            doNotSendToEna: req.body.doNotSendToEna,
            doNotSendToEnaReason: req.body.doNotSendToEnaReason,
            oldId: Math.random().toString(16).substr(2, 6), // TODO remove
        });

        let setAsSavedProject;
        newProject.save()
            .then(async savedProject => {
                setAsSavedProject = savedProject;
                const additionalFiles = req.body.additionalFiles;

                if (additionalFiles.length){
                    try {
                        return await sortAdditionalFiles(additionalFiles, 'project', setAsSavedProject._id, setAsSavedProject.path)
                    } catch (e){
                        // if issue with files, remove newProject
                        await Project.deleteOne({ '_id': setAsSavedProject._id });                        
                        return Promise.reject(e);
                    }
                } else {
                    return Promise.resolve()
                }
            })
            .then(() => {                
                res.status(200).send({ project: setAsSavedProject })
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    });

module.exports = router;
