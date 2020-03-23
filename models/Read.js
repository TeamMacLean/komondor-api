const mongoose = require('mongoose')
const moveRawFilesToFolder = require('../lib/utils/moveRawFilesToFolder');

// const fs = require('fs')
// const path = require('path')

const schema = new mongoose.Schema({
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', required: true },
    paired: { type: Boolean, required: true },
    sibling: { type: mongoose.Schema.Types.ObjectId, ref: 'Read' },
    MD5: { type: String },
}, { timestamps: true, toJSON: { virtuals: true } });


// schema.methods.moveToFolderAndSave = function (relNewPath) {
//     const file = this;
//     const fullNewPath = path.join(process.env.DATASTORE_ROOT, relNewPath);

//     return fs.promises.rename(file.path, fullNewPath)
//         .then(() => {
//             file.path = relNewPath;
//             return file.save()
//         })
// }


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    const doc = this;

    moveRawFilesToFolder(doc)
        .then(() => {
            next();
        })
        .catch(err => {
            next(err);
        })

});

const Read = mongoose.model('Read', schema);

module.exports = Read;
