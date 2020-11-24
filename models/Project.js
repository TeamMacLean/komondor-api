const mongoose = require('mongoose')
const { join } = require('path')
const generateSafeName = require('../lib/utils/generateSafeName').default
const fs = require('fs')

const schema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // keep unique but update UI to reflect this // TODO
    safeName: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    shortDesc: { type: String, required: true },
    longDesc: { type: String, required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    isPublic: { type: Boolean, default: false },

    // GG new fields
    oldId : {type: String, unique: true}, // TODO i dont think i need this but hard to extract
    oldSafeName: {type: String, unique: false, required: false}, // temp?
    secondaryOwner: {type: String, required: false},
    path: {type: String, required: false, unique: true}, // George add unique: true; surely required is true also? 

    // TODO ensure each is unique?
    additionalFilesUploadIDs: [{ type: String }], // George has created (was missing with Martin)

    doNotSendToEna: { type: Boolean, default: false },
    doNotSendToEnaReason: { type: String }
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', async function () {
    const allOthers = await Project.find({});
    const safeName = await generateSafeName(this.name, allOthers.filter(f => f._id.toString() !== this._id.toString()));
    this.safeName = safeName;
    const doc = this;
    const populatedDoc = await doc.populate({
        path: 'group',
    })
        .execPopulate();
    try {
        this.path = join('/', populatedDoc.group.safeName, populatedDoc.safeName);
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(e);
    }
});

schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next()
});
schema.post('save', async function (doc) {
    if (this.wasNew) {

        async function createNewsItem() {
            const NewsItem = require('./NewsItem')
            try {
                const savedNewsItem = await new NewsItem({
                    type: 'project',
                    typeId: doc._id,
                    owner: doc.owner,
                    group: doc.group._id || doc.group,
                    name: doc.name,
                    body: doc.shortDesc
                })
                    .save();
                return Promise.resolve();
            } catch (err) {
                console.error(err);
                return Promise.resolve();
            }
        }

        // create directory
        const absPath = join(process.env.DATASTORE_ROOT, this.path);                        
        await fs.promises.mkdir(absPath);
        return createNewsItem(); 

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
    ref: 'AdditionalFile',
    localField: '_id',
    foreignField: 'project',
    justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
    const doc = this;
    return doc.populate({
        path: 'group',
    })
        .execPopulate()
        .then(populatedDoc => {
            return join(populatedDoc.group.safeName, populatedDoc.safeName)
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
    // const res = process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username);
    // console.log('full access allowed?', !!res);
    
    if (user.username === 'admin' || process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username)) {
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
