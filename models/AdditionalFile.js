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
    MD5LastChecked: {type: String},
    oldAdditionalFileId: {type: String}, // i.e. if migration boolean

    // Set by lib/file-utils.js, which moves the file itself before this row is
    // written so that a failed move cannot leave a row asserting the file
    // arrived. Without a real schema path the flag was silently dropped by
    // Mongoose and the hook below moved every additional file a second time,
    // from a source that was no longer there — failing, and then swallowing
    // the failure. Read.js carries the same flag for the same reason.
    skipPostSave: { type: Boolean, default: false },

    // added file unique true, and md5 field, and oldAddFileId
    // originallyAdded: {type: Number}, // see sample

}, { timestamps: true, toJSON: { virtuals: true } });


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next()
});

/**
 * Moves a brand-new additional file's bytes into the datastore.
 *
 * Split out of the hook so the two guards can be exercised without a live
 * connection: the test that used to cover this mocked the model away entirely
 * and asserted only that a flag had been passed to the constructor, which is
 * why a flag the schema did not have looked like it was working.
 *
 * @param {mongoose.Document} doc - The freshly saved AdditionalFile.
 * @returns {Promise<*>} Resolves once the file is in place, or immediately
 *   when this row's file was already moved by its caller.
 */
const movePostSave = async function (doc) {

    // The caller already moved the file — lib/file-utils.js does it before
    // writing the row, so a move that fails cannot leave a row behind claiming
    // the file arrived. Repeating it here would look for a source that is no
    // longer in staging. (Read.js guards the same hook the same way.)
    if (doc.skipPostSave) {
        return;
    }

    // Only a brand new record needs its file moved into place. By any later
    // save the file already sits in the datastore and doc.file.path is
    // relative, so a second move would look for a source that is not there.
    if (!doc.wasNew) {
        return;
    }

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
            return Promise.resolve()
        });
};

// Exposed as a static so the guards above are reachable from a test without a
// database connection; the hook itself is one line so the two cannot drift.
schema.statics.movePostSave = movePostSave;

schema.post('save', async function () {
    return movePostSave(this);
});

const AdditionalFile = model('AdditionalFile', schema);

module.exports = AdditionalFile;
