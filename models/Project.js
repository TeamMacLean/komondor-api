const mongoose = require('mongoose');
const Utils  = require( '../utils');
const NewsItem  = require( './NewsItem');

const Schema = mongoose.Schema;
const schema = new Schema({
  name: {type: String, required: true},
  safeName: {type: String, required: true},
  owner: {type: String, required: true},
  shortDesc: {type: String, required: true},
  longDesc: {type: String, required: true},
  group: {type: Schema.Types.ObjectId, ref: 'Group', required: true},
  isPublic: {type: Boolean, default: false},
  additionalFiles:{type: Schema.Types.ObjectId, ref: 'FileGroup', required: false},
}, {timestamps: true, toJSON: {virtuals: true}});

schema.pre('validate', function () {
  return Project.find({})
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
      type: 'project',
      typeId: doc._id,
      owner: doc.owner,
      group:doc.group,
      name: doc.name,
      body: doc.shortDesc
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

schema.virtual('samples', {
  ref: 'Sample',
  localField: '_id',
  foreignField: 'project',
  justOne: false, // set true for one-to-one relationship
});

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

module.exports =  Project
