import mongoose from 'mongoose'
import { generateSafeName } from '../lib/utils';
import NewsItem from './NewsItem';
import FileGroup from './FileGroup';

const schema = new mongoose.Schema({
    name: {type: String, required: true},
    safeName: {type: String, required: true},
    owner: {type: String, required: true},
    shortDesc: {type: String, required: true},
    longDesc: {type: String, required: true},
    group: {type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true},
    isPublic: {type: Boolean, default: false},
    additionalFiles: {type: mongoose.Schema.Types.ObjectId, ref: 'FileGroup', required: false},
}, {timestamps: true, toJSON: {virtuals: true}});

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
    next();
});
schema.post('save', function (doc) {
    if (this.wasNew) {

        function makeFolder(){
            fs.promises.mkdir(dirpath, { recursive: true })
        }

        function moveFilesToFolder() {
            return FileGroup.findOne(doc.additionalFiles)
                .populate('files')
                .then(fileGroup => {
                    console.log('fileGroup', fileGroup);
                    return Promise.resolve()
                })
                .catch(err => {
                    return Promise.reject(err);
                });
        }

        function createNewsItem() {
            console.log('making news item');
            return new NewsItem({
                type: 'project',
                typeId: doc._id,
                owner: doc.owner,
                group: doc.group,
                name: doc.name,
                body: doc.shortDesc
            })
                .save()
                .then((savedNewsItem) => {
                    console.log('created news item',savedNewsItem)
                    return Promise.resolve();
                })
                .catch(err => {
                    console.error(err);
                    return Promise.resolve();
                })
        }

        return Promise.all([createNewsItem(), moveFilesToFolder()])

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

schema.methods.getPath = function getPath(doc) {

    //root + group + project

    return doc.populate({
        path: 'group',
    }).exec()
        .then(populatedDoc => {
            return populatedDoc.group.safeName + populatedDoc.safeName
        })
        .catch(err => {
            console.error(err);
        })

};

schema.statics.iCanSee = function iCanSee(user) {
    if (user.username === 'admin') {
        return Project.find({})
    }
    const filters = [
        {'owner': user.username}
    ];
    if (user.groups) {
        user.groups.map(g => {
            filters.push({'group': g})
        });
    }
    return Project.find({$or: filters})
};

const Project = mongoose.model('Project', schema);

export default Project;
