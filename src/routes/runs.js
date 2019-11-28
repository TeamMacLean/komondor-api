import express from "express";
let router = express.Router();
import Run, { iCanSee, findById } from '../models/Run';
import { isAuthenticated } from './middleware';

router.route('/runs')
    .all(isAuthenticated)
    .get((req, res) => {
        //TODO must be in same group as user
        iCanSee(req.user)
            .sort('-createdAt')
            .then(runs => {
                res.status(200).send({runs})
            })
            .catch(err => {
                res.status(500).send({error: err})
            });

    });

router.route('/run')
    .all(isAuthenticated)
    .get((req, res) => {
        if (req.query.id) {

            findById(req.query.id)
                .populate('group')
                .then(run => {
                    //TODO check they have permissions

                    console.log('run', run);

                    if (run) {
                        res.status(200).send({run});
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

router.route('/runs/new')
    .all(isAuthenticated)
    .post((req, res) => {
//TODO check permission
        new Run({
            sample: req.body.sample,
            sequencingProvider: req.body.sequencingProvider,
            sequencingTechnology: req.body.sequencingTechnology,
            librarySource: req.body.librarySource,
            libraryType: req.body.libraryType,
            librarySelection: req.body.librarySelection,
            insertSize: req.body.insertSize,
            submitToGalaxy: req.body.submitToGalaxy,

            owner: req.body.owner,
            group: req.body.group,
        })
            .save()
            .then(savedRun => {
                res.status(200).send({run: savedRun})
            })
            .catch(err => {
                console.error(err);
                res.status(500).send({error: err})
            })

    });

export default router;
