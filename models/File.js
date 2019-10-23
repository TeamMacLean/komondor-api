const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const schema = new Schema({
    fileGroup: {type: Schema.Types.ObjectId, ref: 'FileGroup', required: true},
    name: {type: String, required: true},
    type: {type: String, required: true},
    originalName: {type: String, required: true},
    description: {type: String}
}, {timestamps: true});

const File = mongoose.model('File', schema);


module.exports =  File
