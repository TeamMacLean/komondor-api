import { isAuthenticated } from "./middleware";

import express from "express";
let router = express.Router();
import Project from '../models/Project';

router
    .route('/search/projects')
    .all(isAuthenticated)
    .get((req, res) => {

        if (req.query.name.length) {
            //TODO check permission
            Project.find({name: {$in: req.query.name}})
                .then(projects => {
                    res.status(200).send({results: projects})
                    // res.status(200).send({results:projects})
                })
                .catch(err => {
                    res.status(500).send({error: err})
                })
        } else {
            res.status(200).send({results: []})
        }

    });

export default  router;
