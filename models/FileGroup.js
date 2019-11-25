import mongoose from 'mongoose'


const schema = new mongoose.Schema({
    uploadID: {type: String, required: true},
}, {timestamps: true});

schema.virtual('files', {
    ref: 'File',
    localField: '_id',
    foreignField: 'fileGroup',
    justOne: false, // set true for one-to-one relationship
});

const FileGroup = mongoose.model('FileGroup', schema);


export default FileGroup;
