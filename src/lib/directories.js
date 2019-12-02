import fs from 'fs'
import path from 'path'

import Project from '../models/Project';
import Group from '../models/Group';
import Sample from '../models/Sample';
import Run from '../models/Run';


const DATASTORE_ROOT = process.env.DATASTORE_ROOT;

const _create = (dirpath) => {
    try {
        //check parent folder exists
        return fs.promises.access(path.dirname(dirpath))
            .then(() => fs.promises.mkdir(dirpath))
    } catch (err) {
        throw err;
    }
};

const createGroup = (group) => {
    const absPath = path.join(DATASTORE_ROOT, group.safeName);
    return _create(absPath)
};

const createProject = (project) => {
    Project.get(project._id)
        .populate('group')
        .then(projectDocument => {
            const absPath = path.join(DATASTORE_ROOT, projectDocument.group.safeName, projectDocument.safeName);
            return _create(absPath)
        })
        .then(() => {

        })
        .catch(err => {

        });
};

const createSample = (sample) => {
    Sample.get(sample._id)
        .populate({
            path: 'project',
            populate: {
                path: 'group'
            }
        })
        .then(document => {
            const absPath = path.join(DATASTORE_ROOT, document.project.group.safeName, document.project.safeName, document.safeName);
            return _create(absPath)
        })
        .then(() => {

        })
        .catch(err => {

        });
};

const createRun = (run) => {
    Run.get(run._id)
        .populate({
            path: 'sample',
            populate: {
                path: 'project',
                populate: {
                    path: 'group'
                }
            }
        })
        .then(document => {
            const absPath = path.join(DATASTORE_ROOT, document.sample.project.group.safeName, document.sample.project.safeName, document.sample.safeName, document.safeName);
            return _create(absPath)
        })
        .then(() => {

        })
        .catch(err => {

        });
};