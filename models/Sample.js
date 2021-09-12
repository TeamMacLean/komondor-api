//import { Schema, model } from 'mongoose';
const mongoose = require('mongoose')
const { Schema, model } = mongoose;
//import { join } from 'path';

const generateSafeName = require('../lib/utils/generateSafeName').default
const fs = require('fs')
const { join } = require('path');

const schema = new Schema({
  name: { type: String, required: true }, // should NOT have unique, rely on path instead
  safeName: { type: String, required: true }, //should have unique
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  scientificName: { type: String, required: true },
  commonName: { type: String, required: true },
  ncbi: { type: String, required: true },
  conditions: { type: String, required: true },
  owner: { type: String, required: true },
  group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },

  oldId: {type: String},

  accession: {type: String, unique: false}, // unique except null TODO

  // TODO ensure each is unique?
  additionalFilesUploadIDs: [{ type: String }], // George has changed to array and renamed

  // GG added
  path: {type: String, required: false, unique: true}, // George add unique: true; surely required is true also? 
  oldSafeName: {type: String, unique: false, required: false}, // temp?
  sampleGroup: {type: String, required: false},
  // i could add oldProjectID, but I dont see the point

  // not sure if 'required' cos its in validate function, TODO check
  //originallyAdded: {type: Number} // timestamp (w. 2dp) from original datahog, OR timestamp from creation (i.e. komondor)
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('validate', function () {
  return Sample.find({})
    .then(allOthers => {
      // if (this.safeName){
      //   console.log('already has a safename, so not generating one');
      // }
      return this.safeName || generateSafeName(this.name, allOthers.filter(f => f._id.toString() !== this._id.toString()));
    })
    .then(safeName => {
      this.safeName = safeName;
      // if (!this.originallyAdded){
      //   this.originallyAdded = Date.now();
      // }
      const doc = this;
      return doc.populate({
          path: 'project',
      })
          .execPopulate()
          .then(populatedDoc => {
            //console.log('poplateddoc', populatedDoc);
            
              try {                        
                  this.path = join(populatedDoc.project.path, populatedDoc.safeName)                   
                  return Promise.resolve()                                             
              } catch (e) {
                  return Promise.reject(e)
              }
          })
    })
});

schema.pre('save', function (next) {
  this.wasNew = this.isNew;
  next()
});

schema.post('save', function (next) {

  const doc = this;

  //create news item
  const NewsItem = require("./NewsItem")
  return new NewsItem({
    type: 'sample',
    typeId: doc._id,
    owner: doc.owner,
    group: doc.group,
    name: doc.name,
    body: doc.conditions,
    //originallyAdded: doc.originallyAdded,
  })
    .save()
    .then(() => {
      // create directory
      const absPath = join(process.env.DATASTORE_ROOT, this.path);     
      return fs.promises.mkdir(absPath) 
    })
    .catch(err => {
      console.error(err);
      Promise.resolve();
    })
  
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
      return join(populatedDoc.group.safeName, populatedDoc.project.safeName, populatedDoc.safeName)
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
  if (user.username === 'admin' || process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username)) {
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


const Sample = model('Sample', schema);

module.exports = Sample
