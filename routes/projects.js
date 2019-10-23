const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Middleware = require('./middleware');

router.route('/projects')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        Project.iCanSee(req.user)
            .populate('group')
            .then(projects => {
                res.status(200).send({projects})
            })
            .catch(err => {
                console.error('error!!!!!', err);
                res.status(500).send({error: err})
            });

    });

router.route('/project')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            //TODO check permission
            Project.findById(req.query.id)
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
    .all(Middleware.isAuthenticated)
    .post((req, res) => {
//TODO check permission
        new Project({
            name: req.body.name,
            group: req.body.group,
            shortDesc: req.body.shortDesc,
            longDesc: req.body.longDesc,
            owner: req.body.owner,
            // tags: req.body.tags || []
        })
            .save()
            .then(savedProject => {
                res.status(200).send({project: savedProject})
            })
            .catch(err => {
                console.error(err);
                res.status(500).send({error: err})
            })

    });

module.exports = router;
