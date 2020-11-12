//import { Schema, model } from 'mongoose';
const mongoose = require('mongoose')
const { Schema, model } = mongoose;

//import _path from 'path';
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
    const doc = this;
    const path = require('path');
    const fs = require('fs');

    let prom;
    if (doc.run) {
        const Run = require('./Run').default;
        prom = Run.findById(doc.run)
    } else if (doc.sample) {
        const Sample = require('./Sample').default;
        prom = Sample.findById(doc.sample)
    } else if (doc.project) {
        const Project = require('./Project');
        prom = Project.findById(doc.project)
    }

    // if (!this.originallyAdded){
    //     this.originallyAdded = Date.now();
    // }

    // skip this if migrating (i.e,. oldAdditionalFileId is truthy)
    if (prom && !doc.oldAdditionalFileId) {

        function makeFolder(dirpath) {
            return fs.promises.mkdir(dirpath, { recursive: true })
        }

        // George: why do we do this here?
        //console.log('DOC', doc)
        return Promise.all([prom, doc.populate('file').execPopulate()])
            .then(out => {
                const parent = out[0];
                const additionalFile = out[1];
                return parent.getRelativePath()
                    .then(relPath => {
                        relPath = _path.join(relPath, 'additional')
                        const absPath = _path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const relPathWithFilename = _path.join(relPath, additionalFile.file.originalName)
                                return additionalFile.file.moveToFolderAndSave(relPathWithFilename)
                            })

                    })
            })

            .catch(next)
    } else {
        next();
    }

});

const AdditionalFile = model('AdditionalFile', schema);

module.exports = AdditionalFile;
