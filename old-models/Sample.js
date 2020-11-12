const mongoose = require('mongoose')
const path = require('path')
const generateSafeName = require('../lib/utils/generateSafeName')

const schema = new mongoose.Schema({
  name: { type: String, required: true },
  safeName: { type: String, required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  scientificName: { type: String, required: true },
  commonName: { type: String, required: true },
  ncbi: { type: String, required: true },
  conditions: { type: String, required: true },
  additionalFilesUploadID: { type: String },
  owner: { type: String, required: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },


}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', function () {
  return Sample.find({})
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
      type: 'sample',
      typeId: doc._id,
      owner: doc.owner,
      group: doc.group,
      name: doc.name,
      body: doc.conditions
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

schema.virtual('runs', {
  ref: 'Run',
  localField: '_id',
  foreignField: 'sample',
  justOne: false, // set true for one-to-one relationship
});

schema.virtual('additionalFiles', {
  ref: 'AdditionalFile',
  localField: '_id',
  foreignField: 'sample',
  justOne: false, // set true for one-to-one relationship
});

schema.methods.getRelativePath = function () {
  const doc = this;
  return doc
    .populate({
      path: 'group',
    })
    .populate({
      path: 'project'
    })
    .execPopulate()
    .then(populatedDoc => {
      return path.join(populatedDoc.group.safeName, populatedDoc.project.safeName, populatedDoc.safeName)
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
    return Sample.find({})
  }
  const filters = [
    { 'owner': user.username }
  ];
  if (user.groups) {
    user.groups.map(g => {
      filters.push({ 'group': g })
    });
  }
  return Sample.find({ $or: filters })
};

schema.methods.toENA = function toENA() {

  const sample = this;

  js2xmlparser.parse("sample", sample)

}


const Sample = mongoose.model('Sample', schema);

module.exports = Sample
