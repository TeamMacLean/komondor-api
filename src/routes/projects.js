import express from "express";
let router = express.Router();
import Project from '../models/Project';
import { isAuthenticated } from './middleware';
import FileGroup from '../models/FileGroup';

router.route('/projects')
    .all(isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        Project.iCanSee(req.user)
            .populate('group')
            .sort('-createdAt')
            .then(projects => {
                res.status(200).send({projects})
            })
            .catch(err => {
                console.error('error!!!!!', err);
                res.status(500).send({error: err})
            });

    });

router.route('/project')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            //TODO check permission
            Project.findById(req.query.id)
                .populate({path: 'additionalFiles', populate: {path: 'files'}})
                .populate('group')
                .populate('samples')
                .then(project => {
                    //TODO check they have permissions

                    if (project) {
                        res.status(200).send({project});
                    } else {
                        res.status(501).send({error: 'not found'});
                    }

                })
                .catch(err => {
                    res.status(500).send({error: err});
                })

        } else {
            res.status(500).send({error: new Error('param :id not provided')})
        }
    });

router.route('/projects/new')
    .all(isAuthenticated)
    .post((req, res) => {
//TODO check permission

FileGroup.findOne({uploadID: req.body.uploadID})
            .then(foundFileGroup => {

                const newProject = new Project({
                    name: req.body.name,
                    group: req.body.group,
                    shortDesc: req.body.shortDesc,
                    longDesc: req.body.longDesc,
                    owner: req.body.owner,
                });

                if (foundFileGroup) {
                    newProject.additionalFiles = foundFileGroup._id;
                }

                newProject.save()
                    .then(savedProject => {
                        res.status(200).send({project: savedProject})
                    })
                    .catch(err => {
                        console.error(err);
                        res.status(500).send({error: err})
                    })
            })
            .catch(err => {

            })

    });

export default router;