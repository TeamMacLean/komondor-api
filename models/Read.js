//import { Schema, model } from 'mongoose';
const mongoose = require('mongoose')
const { Schema, model } = mongoose;
const Run = require('./Run');
const _path = require('path');

const schema = new Schema({
    run: { type: Schema.Types.ObjectId, ref: 'Run', required: true, unique: false },
    file: { type: Schema.Types.ObjectId, ref: 'File', required: true, unique: true },
    MD5: { type: String }, // TODO one day migrate to File object (along with File)
    MD5LastChecked: {type: String}, // for future productivity
    paired: { type: Boolean }, // removed required because of migration script
    sibling: { type: Schema.Types.ObjectId, ref: 'Read' },

    oldReadId: {type: String}, // George added, basically a flag for migration
    oldSiblingID: {type: String}, //https://stackoverflow.com/questions/7955040/mongodb-mongoose-unique-if-not-null
    oldRunID: {type: String}, 

    // check with Martin whether to keep these
    // oldLegacyPath: { type: String },
    // oldFileName: { type: String },
    // oldSafeName: { type: String },
    // oldProcessed: { type: Boolean },
    // oldFastQCLocation: { type: String },
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next()
});

schema.post('save', function (next) {

    const doc = this;
    if (doc.oldReadId && doc.oldReadId.length){
        if (next && typeof(next) === 'function'){
            next()
        } 
        return Promise.resolve(); 
    }

    return Promise.all([
        Run.findById(readDoc.run), 
        readDoc.populate('file').execPopulate()
    ])
        .then(out => {
            const run = out[0];
            const reeeeed = out[1];
            return run.getRelativePath()
                .then(relPath => {
                    // we are relying on /raw dir to have been previously created!
                    relPath = _path.join(relPath, 'raw')
                    const relPathWithFilename = _path.join(relPath, reeeeed.file.originalName)
                    return reeeeed.file.moveToFolderAndSave(relPathWithFilename)
                })
        })
        .catch(e => {
            console.error(e);
            next();
        });
})

const Read = model('Read', schema);

module.exports = Read;
