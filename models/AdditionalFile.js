const mongoose = require('mongoose')
const moveAdditionalFilesToFolder = require('../lib/utils/moveAdditionalFilesToFolder');

const schema = new mongoose.Schema({
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'Run' },
    sample: { type: mongoose.Schema.Types.ObjectId, ref: 'Sample' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
}, { timestamps: true, toJSON: { virtuals: true } });


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    const doc = this;

    moveAdditionalFilesToFolder(doc)
        .then(() => {
            next();
        })
        .catch(err => {
            next(err);
        })

});

const AdditionalFile = mongoose.model('AdditionalFile', schema);

module.exports = AdditionalFile;
