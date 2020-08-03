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
                    // const jon = File.findOne({name: file.uploadName})
                    // console.log('keysy', Object.keys(file))
                    // console.log('trying to find a file called', file.uploadName, 'so returning result of looking as: ', jon)
                    return File.findOne({
                        name: file.uploadName
                    })
                        .then(foundFile => {
                            if (foundFile) {
                                console.log('success! found a(nother) file to save as additional file to this project')
                                
                                // move it

                                // TODO returnedProject.group only gives us ID of group name, we need the string name itself

                                // const targetDirPath = path
                                //     .join('/', 'Users', 'deeks', 'Downloads', 'komondor-uploads', 
                                //         'jjones', 'additional')
                                // console.log('attempting to make: ', targetDirPath)

                                // fs.promises.mkdir(targetDirPath, { recursive: true }).then(result => {

                                //     console.log('success making that targetPath')

                                //     const targetPath = path.join(targetDirPath, file.uploadName)
                                //     const currentPath = path.join(process.cwd(), 'uploads', file.uploadName);

                                //     console.log('attempting to move', currentPath, 'into', targetPath)



                                //     fs.promises.rename(currentPath, targetPath, err => {
                                //         if (err) {
                                //             console.log('big problem')
                                //             throw err;
                                //         }
                                //         console.log('fs rename a success!')

                                //         console.log('moving onto adidtional file db creation...')

                                //         // associate it

                                        
                                //     }).then(res => {
    
                                        return new AdditionalFile({
                                            project: savedProject._id,
                                            file: foundFile._id
                                        })
                                            .save()

                                //     })

                                // })


                            } else {
                                console.log('BIG ERROR: did not find it')
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
