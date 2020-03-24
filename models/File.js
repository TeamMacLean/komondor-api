const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    uploadName: { type: String, required: true },
    originalName: { type: String, required: true },
    description: { type: String },
    path: { type: String, required: true },
}, { timestamps: true, toJSON: { virtuals: true } });


schema.methods.moveToFolderAndSave = function (relNewPath) {
    const file = this;
    const fullNewPath = path.join(process.env.DATASTORE_ROOT, relNewPath);

    return fs.promises.rename(file.path, fullNewPath)
        .then(() => {
            file.path = relNewPath;
            return file.save()
        })
        .catch(err => {
            console.error(err);
        })
}

const File = mongoose.model('File', schema);

module.exports = File;
