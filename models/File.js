const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')

const schema = new mongoose.Schema({
    name: { type: String, required: true }, // should NOT have unique, rely on path instead
    type: { type: String, required: true }, // used to be required FALSE TODO check if needed still I think it fixed a bug
    uploadName: { type: String, required: true },
    originalName: { type: String, required: true },
    description: { type: String },
    path: { type: String, required: false }, // HACK to required false
    createFileDocumentId: {type: String},
    tempUploadPath: { type: String, required: true }, // new field i added to help with bugs
    oldParentID: {type: String}, // George added
    oldReadId: {type: String}, // George added
    oldAdditionalFileId: {type: String}, // George added
}, { timestamps: true, toJSON: { virtuals: true } });

// create a unique combo of name and path (and when uploaded)
schema.index({ name: 1, path: 1, createFileDocumentId: 1}, { unique: true });

// i converted to async function, check this still works
schema.methods.moveToFolderAndSave = async function (relNewPath) {
    const file = this;
    const fullNewPath = path.join(process.env.DATASTORE_ROOT, relNewPath);

    try {
        //console.log('moving (rel):', file.path, 'to (abs):', fullNewPath );
        
        await fs.promises.rename(file.path, fullNewPath);
        file.path = relNewPath; 
        return file.save();
    }
    catch (err) {
        console.error(err);
    }
}

const File = mongoose.model('File', schema);

module.exports = File;
