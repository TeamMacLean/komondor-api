const mongoose = require('mongoose')
const js2xmlparser = require("js2xmlparser");

const { generateSafeName } = require('../lib/utils')
const NewsItem = require("./NewsItem")



const schema = new mongoose.Schema({
  name: { type: String, required: true },
  safeName: { type: String, required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  scientificName: { type: String, required: true },
  commonName: { type: String, required: true },
  ncbi: { type: String, required: true },
  conditions: { type: String, required: true },

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
  next();
});
schema.post('save', function (doc) {
  if (this.wasNew) {
    //create news item
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
