const express = require("express")
let router = express.Router();
const Project = require('../models/Project')
const Sample = require('../models/Sample')
const Run = require('../models/Run')
const Read = require('../models/Read')
const { isAuthenticated } = require('./middleware')
const _path = require('path')
const fs = require('fs');
const { sortAdditionalFiles } = require('../lib/sortAssociatedFiles');
const sendOverseerEmail = require('../lib/utils/sendOverseerEmail')

const updateProject = async (accession, releaseDate, typeId) => {
    return await new Promise(async (res, rej) => {

        try {
            let updateInfo = {
                accession,
            };
            if (releaseDate){
                updateInfo.releaseDate = releaseDate;
            }

            const updatedProject = await (await Project.findByIdAndUpdate(typeId, updateInfo)).save();

            res(updatedProject)
            
        } catch (error) {
            rej(error)
        }
    });
}
const updateSample = async (accession, typeId) => {
    return await new Promise(async (res, rej) => {
        try {
            const updatedSample = await (await Sample.findByIdAndUpdate(typeId, {accession: accession})).save();
            res(updatedSample)            
        } catch (error) {
            rej(error)
        }
    });
}

const updateRun = async (accession, typeId) => {
    return await new Promise(async (res, rej) => {
        try {
            const updatedSample = await (await Run.findByIdAndUpdate(typeId, {accession: accession})).save();
            res(updatedSample)            
        } catch (error) {
            rej(error)
        }
    });
}

router.route('/accessions/new')
    .all(isAuthenticated)
    .post(async (req, res) => {
        const {
            accession,
            releaseDate,
            type,
            typeId,
        } = req.body;

        // TODO
        // type === 'project' && 

        if (type === 'project'){
            try {
                await updateProject(accession, releaseDate, typeId)
                res.status(200).send()
            } catch (error) {
                res.status(500).send({ error: err })
            }
        } else if (type === 'sample'){
            try {
                await updateSample(accession, typeId)
                res.status(200).send()
            } catch (error) {
                res.status(500).send({ error: err })
            }
        } else if (type === 'run'){
            try {
                await updateRun(accession, typeId)
                res.status(200).send()
            } catch (error) {
                res.status(500).send({ error: err })
            }
        } else {
            res.status(500).send({error: 'Could not find type'})
        }
});

const getMatrixOfData = async () => {
    return await new Promise(async (resolve, reject) => {
        try {
            // TODO HACK
            const runsWithSamplesAndGroups = await Run.find({})
                .populate('sample')
                .populate('group')

            const projects = await Project.find({});
            const reads = await Read.find({})
                .populate('file')
            ;         
            
            const result = runsWithSamplesAndGroups.map(runPlus => {

                const runsProjIdStr = runPlus.sample.project.toString();
                const targetProjectObj = projects.filter(p => p._id.toString() === runsProjIdStr)[0]
                
                const relatedReads = reads.filter(read => {
                    const res = read.run.toString() === runPlus._id.toString()
                    return res;
                })
                
                // TODO TEMP HACK use .env
                // this works on production but misses a slash on local dev
                const relatedReadsPaths = relatedReads.map(read => ('/tsl/data/reads' + read.file.path));
                const relatedReadsPathsString = relatedReadsPaths.join(';');

                const groupString = runPlus.group.safeName;
                const ownerString = runPlus.owner;
                const ena_submission_dateString = targetProjectObj.releaseDate;
                const project_nameString = targetProjectObj.safeName;
                const project_idString = runsProjIdStr;
                const project_accessionString = targetProjectObj.accession;
                const sample_nameString = runPlus.sample.safeName;
                const sample_idString = runPlus.sample._id.toString();
                const sample_accessionString = runPlus.sample.accession;
                const run_nameString = runPlus.safeName;
                const run_idString = runPlus._id.toString();
                const run_accessionString = runPlus.accession;
                const run_creation_dateString = runPlus.createdAt;
                const list_of_read_filesString = relatedReadsPathsString;

                return [
                    groupString,
                    ownerString,
                    ena_submission_dateString,
                    project_nameString,
                    project_idString,
                    project_accessionString,
                    sample_nameString,
                    sample_idString,
                    sample_accessionString,
                    run_nameString,
                    run_idString,
                    run_accessionString,
                    run_creation_dateString,
                    list_of_read_filesString,
                ];
            })

            resolve(result)            
        } catch (error) {
            reject(error)
        }
    });
}

const HEADINGS = [
    'group', 'owner', 
    'ena_submission_date', 'project_name', 'project_id', 'project_accession', 
    'sample_name', 'sample_id', 'sample_accession', 
    'run_name', 'run_id', 'run_accession', 'run_creation_date', 'list_of_read_files'
];

router.route('/accessions/csv')
    .all(isAuthenticated)
    .get(async (req, res) => {        
        
        try {
            
            var csv = "";
            HEADINGS.forEach(function (row) {
                csv += row;
                csv += ',';
            })
            csv += "\n";

            const matrixOfData = await getMatrixOfData();
            
            //merge the data with CSV
            matrixOfData.forEach(function (row) {
                csv += row.join(",");
                csv += "\n";
            });
            
            res.status(200).send({csv})
        } catch (error) {
            
            res.status(500).send({ error })
        }
});

module.exports = router;
