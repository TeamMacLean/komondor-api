import mongoose from 'mongoose'
import Utils from '../lib/utils';
import Project from "./Project";

import NewsItem from "./NewsItem";

const schema = new mongoose.Schema({
    name: {type: String, required: true},
    safeName: {type: String, required: true},
    sample: {type: Schema.Types.ObjectId, ref: 'Sample', required: true},

    sequencingProvider: {type: String, required: true},
    sequencingTechnology: {type: String, required: true},
    librarySource: {type: String, required: true},
    libraryType: {type: String, required: true},
    librarySelection: {type: String, required: true},
    insertSize: {type: String, required: true},
    submitToGalaxy: {type: Boolean, required: true},


    owner: {type: String, required: true},
    group: {type: Schema.Types.ObjectId, ref: 'Group', required: true},

}, {timestamps: true, toJSON: {virtuals: true}});

schema.pre('validate', function () {
    return Run.find({})
        .then(allOthers => {
            return Utils.generateSafeName(this.name, allOthers.filter(f => f._id.toString() !== this._id.toString()));
        })
        .then(safeName => {
            this.safeName = safeName;
            return Promise.resolve()
        })
});


schema.pre('save', function (next) {
    this.wasNew = this.isNew;
    next();
});
schema.post('save', function (doc) {
    if (this.wasNew) {
        //create news item
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


schema.statics.iCanSee = function iCanSee(user) {
    if (user.username === 'admin') {
        return Run.find({})
    }
    const filters = [
        {'owner': user.username}
    ];
    if (user.groups) {
        user.groups.map(g => {
            filters.push({'group': g})
        });
    }
    return Run.find({$or: filters})
};


const Run = mongoose.model('Run', schema);

module.exports =  Run
