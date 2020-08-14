const express = require("express")
let router = express.Router();
const Project = require('../models/Project')
const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const { isAuthenticated } = require('./middleware')
// const FileGroup = require('../models/FileGroup')
const path = require('path')
const fs = require('fs')

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
                        res.status(200).send({ project });
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
        });

        let returnedProject;

        newProject.save()
            .then(savedProject => {
                returnedProject = savedProject;
                const additionalFiles = req.body.additionalFiles;
                const filePromises = additionalFiles.map(file => {
                    return File.findOne({
                        name: file.uploadName
                    })
                        .then(foundFile => {
                            if (foundFile) {
                                // TODO returnedProject.group only gives us ID of group name, we need the string name itself

                                return new AdditionalFile({
                                    project: savedProject._id,
                                    file: foundFile._id
                                })            
                                .save()
                            } else {
                                console.log('Error finding file record in db')
                                Promise.resolve()//TODO:bad
                            }
                        })
                })


                return Promise.all([filePromises])

            })
            .then(() => {
                res.status(200).send({ project: returnedProject })
            })
            .catch(err => {
                console.error('ERROR', err);
                res.status(500).send({ error: err })
                // tidy up bad file uploads? either as a routine db maintenance job 
                // or as sophisticated error handling somewhere here
            })

    });

module.exports = router;
