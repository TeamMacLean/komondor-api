const mongoose = require('mongoose')
const path = require('path')
const generateSafeName = require('../lib/utils/generateSafeName')
const NewsItem = require('./NewsItem')
const moveAdditionalFilesToFolder = require('../lib/utils/moveAdditionalFilesToFolder');

const ENAParse = require('../../ena-js/lib/parse');

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    safeName: { type: String, required: true },
    owner: { type: String, required: true },
    shortDesc: { type: String, required: true },
    longDesc: { type: String, required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    isPublic: { type: Boolean, default: false },
    additionalFilesUploadID: { type: String },

    doNotSendToEna: { type: Boolean, default: false },
    doNotSendToEnaReason: { type: String }
    // additionalFiles: { type: mongoose.Schema.Types.ObjectId, ref: 'FileGroup', required: false },
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', function () {
    return Project.find({})
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

    const doc = this;

    moveAdditionalFilesToFolder(doc)
        .then(() => {
            next();
        })
        .catch(err => {
            next(err);
        })

});
schema.post('save', function (doc) {
    if (this.wasNew) {

        function createNewsItem() {
             
            return new NewsItem({
                type: 'project',
                typeId: doc._id,
                owner: doc.owner,
                group: doc.group._id || doc.group,
                name: doc.name,
                body: doc.shortDesc
            })
                .save()
                .then((savedNewsItem) => {
                    console.log('created news item', savedNewsItem)
                    return Promise.resolve();
                })
                .catch(err => {
                    console.error(err);
                    return Promise.resolve();
                })
        }


        return createNewsItem()

    } else {
        return Promise.resolve()
    }
});

schema.virtual('samples', {
    ref: 'Sample',
    localField: '_id',
    foreignField: 'project',
    justOne: false, // set true for one-to-one relationship
});

schema.virtual('additionalFiles', {
    ref: 'File',
    localField: 'additionalFilesUploadID',
    foreignField: 'uploadID',
    justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
    const doc = this;
    return doc.populate({
        path: 'group',
    })
        .execPopulate()
        .then(populatedDoc => {
            return path.join(populatedDoc.group.safeName, populatedDoc.safeName)
        })
}

schema.methods.getAbsPath = function getPath() {
    const doc = this;

    return doc.getRelativePath()
        .then(relPath => {
            return path.join(process.env.DATASTORE_ROOT, relPath);
        })
};

schema.methods.toXML = function toXML() {
    const doc = this;
    return new Promise((resolve, reject) => {

        //TODO ALIAS NEEDS TO BE UINIQUE!!!!
        // const xml = ENAParse.study({
        //     title: doc.name, alias: doc._id, abstract: doc.shortDesc, center: 'TODO! TSL', studyType: ENAParse.StudyTypes.wholeGenomeSequencing
        // })
        const xml = ENAParse.study({
            title: 'doc.name', alias: 'doc._id', abstract: 'doc.shortDesc', center: 'TODO! TSL', studyType: 'ENAParse.StudyTypes.wholeGenomeSequencing'
        })

        resolve(xml);
    })
}

schema.statics.iCanSee = function iCanSee(user) {
    if (user.username === 'admin') {
        return Project.find({})
    }
    const filters = [
        { 'owner': user.username }
    ];
    if (user.groups) {
        user.groups.map(g => {
            filters.push({ 'group': g })
        });
    }
    return Project.find({ $or: filters })
};

const Project = mongoose.model('Project', schema);

module.exports = Project;
