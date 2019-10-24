const mongoose = require('mongoose');


const Schema = mongoose.Schema;
const schema = new Schema({
    uploadID: {type: String, required: true},
}, {timestamps: true});

schema.virtual('files', {
    ref: 'File',
    localField: '_id',
    foreignField: 'fileGroup',
    justOne: false, // set true for one-to-one relationship
});

const FileGroup = mongoose.model('FileGroup', schema);


module.exports = FileGroup;
