const mongoose = require('mongoose')
const path = require('path')
const generateSafeName = require('../lib/utils/generateSafeName')

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    safeName: { type: String, required: true },
    sample: { type: mongoose.Schema.Types.ObjectId, ref: 'Sample', required: true },

    sequencingProvider: { type: String, required: true },
    sequencingTechnology: { type: String, required: true },
    librarySource: { type: String, required: true },
    libraryType: { type: String, required: true },
    librarySelection: { type: String, required: true },
    insertSize: { type: String, required: true },
    libraryStrategy: { type: String, required: true },
    additionalFilesUploadID: { type: String },
    owner: { type: String, required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },

}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', function () {
    return Run.find({})
        .then(allOthers => {
            console.log(this.name, allOthers)
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
            return path.join(populatedDoc.group.safeName, populatedDoc.sample.project.safeName, populatedDoc.sample.safeName, populatedDoc.safeName)
        })
}

schema.methods.getAbsPath = function getPath() {
    const doc = this;

    return doc.getRelativePath()
        .then(relPath => {
            return path.join(process.env.DATASTORE_ROOT, relPath);
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


const Run = mongoose.model('Run', schema);

module.exports = Run
