const mongoose = require('mongoose')


const schema = new mongoose.Schema({
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', required: true },
    paired: { type: Boolean, required: true },
    sibling: { type: mongoose.Schema.Types.ObjectId, ref: 'Read' },
    MD5: { type: String },
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('save', function (next) {
    const Run = require('./Run');
    const read = this;
    const path = require('path');
    const fs = require('fs');

    function makeFolder(dirpath) {
        return fs.promises.mkdir(dirpath, { recursive: true })
    }
    
    return Promise.all([Run.findById(this.run), read.populate('file').execPopulate()])
        .then(out => {
            const run = out[0];
            const reeeeed = out[1];
            return run.getRelativePath()
                .then(relPath => {
                    relPath = path.join(relPath, 'raw')
                    const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                    return makeFolder(absPath)
                        .then(() => {
                            const relPathWithFilename = path.join(relPath, reeeeed.file.originalName)
                            return reeeeed.file.moveToFolderAndSave(relPathWithFilename)
                        })
                })
        })
        .then((res) => {
            next()
        })
        .catch(next)

});

const Read = mongoose.model('Read', schema);

module.exports = Read;
