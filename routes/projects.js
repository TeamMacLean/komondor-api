const express = require("express")
let router = express.Router();
const Project = require('../models/Project')
const { isAuthenticated } = require('./middleware')
const _path = require('path')
const fs = require('fs');
const { sortAdditionalFiles } = require('../lib/sortAssociatedFiles');

router.route('/projects')
    .all(isAuthenticated)
    .get(async (req, res) => {
        //TODO must be in same group as user

        try {
            const limit = await Project.iCanSee(req.user)
            // consider refactoring to reduce load
            const orderByMostRecent = limit.sort((a, b) => {
                const aDate = new Date(a.createdAt).getTime()
                const bDate = new Date(b.createdAt).getTime()
                
                const res = (aDate > bDate) ? -1 : 1
                //console.log('aDate', aDate, 'bDate', bDate, 'res', res);
                return res
            })
            res.status(200).send({ projects: orderByMostRecent })
        } catch (err) {
            console.error('error!!!!!', err);
            res.status(500).send({ error: err })
        }
    });

router.route('/projects/names')
    //.all(isAuthenticated)
    .get(async (req, res) => {
        Project.find({}).select('name')
            .then((resPros => {
                const results = resPros.map(resPro => resPro.name)
                res.status(200).send({ projectsNames: results })
            }))
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
                        
                        // TODO great chance to report back to user what is saved and what is not!!!

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
