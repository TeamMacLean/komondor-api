const mongoose = require('mongoose')
const generateSafeName = require('../lib/utils/generateSafeName').default
const _path = require('path')
const fs = require('fs')
const FULL_RECORDS_ACCESS_USERS = process.env.FULL_RECORDS_ACCESS_USERS;

const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  safeName: { type: String, required: true },
  ldapGroups: { type: [String], required: true },
  deleted: { type: Boolean, default: false },
  sendToEna: { type: Boolean, default: false },
  oldId: {type: String}
}, { timestamps: true,toJSON: { virtuals: true } });

schema.pre('validate', function () {

  return Group.find({})
    .then(allOthers => {

      allOthers.filter(f => f._id.toString() === this._id.toString());

      return generateSafeName(this.name, allOthers.filter(f => f._id.toString() !== this._id.toString()));
    })
    .then(safeName => {
      this.safeName = safeName;
      
      return Promise.resolve()
    })
});

schema.post('save', function () { 

  const absDestPath = _path.join(process.env.DATASTORE_ROOT, this.safeName);
  
  fs.promises.access(absDestPath)
    .then(() => {
        //console.log(`Directory already exists for ${this.name}. Skipping.`)
    })
    .catch(() => {
        try {            
            return fs.promises.mkdir(absDestPath).then(() => {
              console.log('Directory for ' + this.name + ' did not exist, so now created!')
              return Promise.resolve()
            })
        } catch (e) {
            console.log('Error creating directory. Please create yourself.', e);
            
            return Promise.resolve();
        }
    })
})

schema.statics.GroupsIAmIn = function GroupsIAmIn(user) {  
  if (user.isAdmin) {
    return Group.find({})
  }

  if (
    FULL_RECORDS_ACCESS_USERS &&
    FULL_RECORDS_ACCESS_USERS.length &&
    user &&
    user.username &&
    FULL_RECORDS_ACCESS_USERS.includes(user.username)
  ){  
      return Group.find({})
  }

  if (user.groups) {
    return Group.find({
      '_id': { $in: user.groups }
    });

  } else if (user.memberOf) {

    const filters = [];
    user.memberOf.map(g => {
      filters.push({ 'ldapGroups': g })
    });
    return Group.find({ $or: filters })

  } else {
    // user has no group, so let them store in bioinformatics
    console.log('no groups for user' + (user.username || user) + ', returning bioinformatics');    
    return Group.find({'name': 'bioinformatics'})
  }

};

const Group = mongoose.model('Group', schema);

module.exports = Group
