import { Schema, model } from 'mongoose';
import { join } from 'path';
import generateSafeName from '../lib/utils/generateSafeName';

const schema = new Schema({
    name: { type: String, required: true }, // should NOT have unique, rely on path instead
    safeName: { type: String, required: true, unique: true },
    sample: { type: Schema.Types.ObjectId, ref: 'Sample', required: true },

    forceSafeName: {type: Boolean, default: false}, // workaround for old db migration

    sequencingProvider: { type: String, required: true },
    sequencingTechnology: { type: String, required: true },
    librarySource: { type: String, required: true },
    libraryType: { type: String, required: true }, // TODO link to librarytype actual model
    librarySelection: { type: String, required: true },
    insertSize: { type: String, required: true },
    libraryStrategy: { type: String, required: true },
    owner: { type: String, required: true },
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },

    // ensure each element in array is unique?
    additionalFilesUploadIDs: [{ type: String }], // George has changed to array and renamed

    // George add
    oldId: {type: String, required: false},
    oldSafeName: {type: String, unique: false, required: false}, // temp?
    path: {type: String, required: false, unique: true}, // George add unique: true; surely required is true also? Also, why did Martin remove this?

    // Martin has removed
    // submissionToGalaxy: true/false,

    // NB
    // create new ID
    // create new safeName

    // no reference to reads , nb

}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', function () {
    if (this.forceSafeName){        
        return Promise.resolve();
    }
    
    return Run.find({})
        .then(allOthers => {
            return generateSafeName(this.name, allOthers.filter(f => f._id.toString() !== this._id.toString()));
        })
        .then(safeName => {
            this.safeName = safeName;
            return Promise.resolve()
        })
});


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next()
});

schema.post('save', function (doc) {
    if (this.wasNew) {
        //create news item
        const NewsItem = require("./NewsItem")
        return new NewsItem({
            type: 'run',
            typeId: doc._id,
            owner: doc.owner,
            group: doc.group,
            name: doc.name,
            body: doc.sequencingProvider
        })
            .save()
            .then(() => {
                Promise.resolve();
            })
            .catch(err => {
                console.error(err);
                Promise.resolve();
            })
    } else {
        return Promise.resolve()
    }
});

schema.virtual('additionalFiles', {
    ref: 'AdditionalFile',
    localField: '_id',
    foreignField: 'run',
    justOne: false, // set true for one-to-one relationship
});
schema.virtual('rawFiles', {
    ref: 'Read',
    localField: '_id',
    foreignField: 'run',
    justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
    const doc = this;
    return doc
        .populate({
            path: 'group',
        })
        .populate({
            path: 'sample',
            populate: {
                path: 'project'
            }
        })
        .execPopulate()
        .then(populatedDoc => {
            return join(populatedDoc.group.safeName, populatedDoc.sample.project.safeName, populatedDoc.sample.safeName, populatedDoc.safeName)
        })
}

schema.methods.getAbsPath = function getPath() {
    const doc = this;

    return doc.getRelativePath()
        .then(relPath => {
            return join(process.env.DATASTORE_ROOT, relPath);
        })
};

schema.statics.iCanSee = function iCanSee(user) {
    if (user.username === 'admin') {
        return Run.find({})
    }
    const filters = [
        { 'owner': user.username }
    ];
    if (user.groups) {
        user.groups.map(g => {
            filters.push({ 'group': g })
        });
    }
    return Run.find({ $or: filters })
};


const Run = model('Run', schema);

export default Run
