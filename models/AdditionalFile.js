const mongoose = require('mongoose')

const schema = new mongoose.Schema({
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'Run' },
    sample: { type: mongoose.Schema.Types.ObjectId, ref: 'Sample' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
}, { timestamps: true, toJSON: { virtuals: true } });


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    const doc = this;
    const path = require('path');
    const fs = require('fs');

    let prom;
    if (doc.run) {
        const Run = require('./Run');
        prom = Run.findById(doc.run)
    } else if (doc.sample) {
        const Sample = require('./Sample');
        prom = Sample.findById(doc.sample)
    } else if (doc.project) {
        const Project = require('./Project');
        prom = Project.findById(doc.project)
    }

    if (prom) {

        function makeFolder(dirpath) {
            return fs.promises.mkdir(dirpath, { recursive: true })
        }

        //console.log('DOC', doc)
        return Promise.all([prom, doc.populate('file').execPopulate()])
            .then(out => {
                const parent = out[0];
                const additionalFile = out[1];
                return parent.getRelativePath()
                    .then(relPath => {
                        relPath = path.join(relPath, 'additional')
                        const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const relPathWithFilename = path.join(relPath, additionalFile.file.originalName)
                                return additionalFile.file.moveToFolderAndSave(relPathWithFilename)
                            })

                    })
            })

            .catch(next)
    } else {
        next();
    }

});

const AdditionalFile = mongoose.model('AdditionalFile', schema);

module.exports = AdditionalFile;
