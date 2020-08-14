const { isAuthenticated } = require("./middleware")

const express = require("express")
let router = express.Router();

const LibrarySelection = require('../models/options/LibrarySelection')
const LibrarySource = require('../models/options/LibrarySource')
const LibraryStrategy = require('../models/options/LibraryStrategy')
const LibraryType = require('../models/options/LibraryType')
const SequencingTechnology = require('../models/options/SequencingTechnology')

router
    .route('/options/libraryselection')
    // .all(isAuthenticated)
    .get((req, res) => {
        LibrarySelection.find({})
            .sort({ value: 1 })
            .then(options => {
                res.send({ options });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .post((req, res) => {
        new LibrarySelection({
            value: req.body.value
        })
            .save()
            .then(savedDoc => {
                res.status(200).send({ doc: savedDoc });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .delete((req, res) => {
        LibrarySelection.deleteOne({ _id: req.body.id })
            .then(() => {
                res.status(200).send({})
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })

router
    .route('/options/librarysource')
    // .all(isAuthenticated)
    .get((req, res) => {
        LibrarySource.find({})
            .sort({ value: 1 })
            .then(options => {
                res.status(200).send({ options });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .post((req, res) => {
        new LibrarySource({
            value: req.body.value
        })
            .save()
            .then(savedDoc => {
                res.status(200).send({ doc: savedDoc });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .delete((req, res) => {
        LibrarySource.deleteOne({ _id: req.body.id })
            .then(() => {
                res.status(200).send({})
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })

router
    .route('/options/librarystrategy')
    // .all(isAuthenticated)
    .get((req, res) => {
        LibraryStrategy.find({})
            .sort({ value: 1 })
            .then(options => {
                res.send({ options });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .post((req, res) => {
        new LibraryStrategy({
            value: req.body.value
        })
            .save()
            .then(savedDoc => {
                res.status(200).send({ doc: savedDoc });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .delete((req, res) => {
        LibraryStrategy.deleteOne({ _id: req.body.id })
            .then(() => {
                res.status(200).send({})
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })

router
    .route('/options/librarytype')
    // .all(isAuthenticated)
    .get((req, res) => {
        LibraryType.find({})
            .sort({ value: 1 })
            .then(options => {
                res.status(200).send({ options });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .post((req, res) => {
        new LibraryType({
            value: req.body.value,
            paired: req.body.paired || false,
            extensions: req.body.extensions || [],
        })
            .save()
            .then(savedDoc => {
                res.status(200).send({ doc: savedDoc });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .delete((req, res) => {
        LibraryType.deleteOne({ _id: req.body.id })
            .then(() => {
                res.status(200).send({})
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })

router
    .route('/options/sequencingtechnology')
    // .all(isAuthenticated)
    .get((req, res) => {

        SequencingTechnology.find({})
            .sort({ value: 1 })
            .then(options => {
                res.status(200).send({ options });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .post((req, res) => {
        new SequencingTechnology({
            value: req.body.value
        })
            .save()
            .then(savedDoc => {
                res.status(200).send({ doc: savedDoc });
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })
    .delete((req, res) => {
        SequencingTechnology.deleteOne({ _id: req.body.id })
            .then(() => {
                es.status(200).send({})
            })
            .catch(err => {
                res.status(500).send({ error: err })
            })
    })

module.exports = router;


