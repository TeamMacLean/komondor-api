const mongoose = require('mongoose');


const Schema = mongoose.Schema;
const schema = new Schema({
  uploadID: {type: String, required: true},
}, {timestamps: true});

const FileGroup = mongoose.model('FileGroup', schema);


module.exports =  FileGroup
