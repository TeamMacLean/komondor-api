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

const updateProject = async (accessions, releaseDate, typeId) => {
    return await new Promise(async (res, rej) => {
        try {
            let updateInfo = {
                accessions,
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
const updateSample = async (accessions, typeId) => {
    return await new Promise(async (res, rej) => {
        try {
            const updatedSample = await (await Sample.findByIdAndUpdate(typeId, {accessions: accessions})).save();
            res(updatedSample)            
        } catch (error) {
            rej(error)
        }
    });
}

const updateRun = async (accessions, typeId) => {
    return await new Promise(async (res, rej) => {
        try {
            const updatedRun = await (await Run.findByIdAndUpdate(typeId, {accessions: accessions})).save();
            res(updatedRun)            
        } catch (error) {
            rej(error)
        }
    });
}

router.route('/accessions/new')
    .all(isAuthenticated)
    .post(async (req, res) => {
        const {
            accessions,
            releaseDate,
            type,
            typeId,
        } = req.body;

        if (!type){
            res.status(500).send({error: 'Could not find type'})
        }

        try {
            type === 'project' && await updateProject(accessions, releaseDate, typeId);
            type === 'sample' && await updateSample(accessions, typeId);
            type === 'run' && await updateRun(accessions, typeId);
            res.status(200).send()
        } catch (error) {
            res.status(500).send({ error })
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
                const project_accessionsString = targetProjectObj.accessions.join(';');
                const sample_nameString = runPlus.sample.safeName;
                const sample_idString = runPlus.sample._id.toString();
                const sample_accessionsString = runPlus.sample.accessions.join(';');
                const run_nameString = runPlus.safeName;
                const run_idString = runPlus._id.toString();
                const run_accessionsString = runPlus.accessions.join(';');
                const run_creation_dateString = runPlus.createdAt;
                const list_of_read_filesString = relatedReadsPathsString;

                return [
                    groupString,
                    ownerString,
                    ena_submission_dateString,
                    project_nameString,
                    project_idString,
                    project_accessionsString,
                    sample_nameString,
                    sample_idString,
                    sample_accessionsString,
                    run_nameString,
                    run_idString,
                    run_accessionsString,
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
    'ena_project_submission_date', 'project_name', 'project_id', 'project_accession', 
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
