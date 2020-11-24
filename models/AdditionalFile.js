//import { Schema, model } from 'mongoose';
const mongoose = require('mongoose')
const { Schema, model } = mongoose;

const Sample = require('./Sample');
const Project = require('./Project');
const Run = require('./Run');

const _path = require('path');

const schema = new Schema({
    run: { type: Schema.Types.ObjectId, ref: 'Run', unique: false },
    sample: { type: Schema.Types.ObjectId, ref: 'Sample', unique: false },
    project: { type: Schema.Types.ObjectId, ref: 'Project', unique: false },
    file: { type: Schema.Types.ObjectId, ref: 'File', required: true, unique: true },
    MD5: {type: String, required: false},
    oldAdditionalFileId: {type: String}, // i.e. if migration boolean
    // added file unique true, and md5 field, and oldAddFileId
    // originallyAdded: {type: Number}, // see sample

}, { timestamps: true, toJSON: { virtuals: true } });


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next()
});

schema.post('save', function (next) {

    const doc = this;
    if (doc.oldAdditionalFileId){
        // skip moving folder
        next()
    }
    
    // move file

    let prom;
    if (doc.run) {
        prom = Run.findById(doc.run)
    } else if (doc.sample) {
        console.log('doc.sampe', doc.sample);
        prom = Sample.findById(doc.sample)
    } else if (doc.project) {
        prom = Project.findById(doc.project)
    } else {
        throw new Error('No run/sample/project found for additional file')
    }

    return Promise.all([prom, doc.populate('file').execPopulate()])
        .then(out => {
            const parent = out[0];
            const additionalFile = out[1];
            return parent.getRelativePath()
                .then(relPath => {
                    relPath = _path.join(relPath, 'additional')
                    const relPathWithFilename = _path.join(relPath, additionalFile.file.originalName)
                    // we are relying on /additional dir to have been previously created!
                    return additionalFile.file.moveToFolderAndSave(relPathWithFilename)
                })
        })
        .catch(e => {
            console.error(e);
            next();
        });
});

const AdditionalFile = model('AdditionalFile', schema);

module.exports = AdditionalFile;
