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

schema.statics.GroupsIAmIn = async function GroupsIAmIn(user) {  
  console.log('figuring out user', user)
  const allGroupsFilter = {};
  var groupFindCriteria;
  if (user.isAdmin) {
    console.log('user.isadmin')
    groupFindCriteria = allGroupsFilter;  
  } else if (
    FULL_RECORDS_ACCESS_USERS &&
    FULL_RECORDS_ACCESS_USERS.length &&
    user &&
    user.username &&
    FULL_RECORDS_ACCESS_USERS.includes(user.username)
    ){  
    console.log('full records access user')
    groupFindCriteria = allGroupsFilter;  
  } else if (user.groups) {
    
    groupFindCriteria = {
      '_id': { $in: user.groups }
    }
    console.log('user.groups', user.groups, groupFindCriteria)
  } else if (user.memberOf) {
    const filters = user.memberOf.map(g => ({
      'ldapGroups': g
    }));
    groupFindCriteria = { $or: filters };
    console.log('user.memberOf', user.memberOf, filters, groupFindCriteria)
  } else {
  }
  const result = await Group.find(groupFindCriteria);
  console.log('result to send to frontend:', result);
  
  // HACK for bad LDAP groups for specific users
  if (result === []){
    if (user.username === 'grandelc'){
      console.log('grandelc as result = [], forming two blades instead')
      return await Group.find({'name': 'two_blades'});
    } else {
      console.log('reached no results unexpectedly', );
      
    }
  }

  return result; 
};

const Group = mongoose.model('Group', schema);

module.exports = Group
