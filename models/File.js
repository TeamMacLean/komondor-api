const mongoose = require('mongoose')

const schema = new mongoose.Schema({
    fileGroup: {type: mongoose.Schema.Types.ObjectId, ref: 'FileGroup', required: true},
    name: {type: String, required: true},
    type: {type: String, required: true},
    originalName: {type: String, required: true},
    description: {type: String},
    path: {type: String, required: true},
}, {timestamps: true});

const File = mongoose.model('File', schema);

module.exports =  File;
