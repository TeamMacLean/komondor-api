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
    tempUploadPath: { type: String, required: true },
}, { timestamps: true, toJSON: { virtuals: true } });


schema.methods.moveToFolderAndSave = function (relNewPath) {
    const file = this;
    const fullNewPath = path.join(process.env.DATASTORE_ROOT, relNewPath);

    // console.log('HELLO! moving', file.path, 'to', fullNewPath)

    return fs.promises.rename(file.path, fullNewPath)
        .then(() => {
            // console.log('NEED to update path property for File')
            // console.log('old path', file.path, 'new path', relNewPath)
            file.path = fullNewPath; // martin had it as relNewPath
            return file.save()
        })
        .catch(err => {
            console.error(err);
        })
}

const File = mongoose.model('File', schema);

module.exports = File;
