const mongoose = require('mongoose')
const generateSafeName = require("../lib/utils/generateSafeName")

const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  safeName: { type: String, required: true },
  ldapGroups: { type: [String], required: true },
  deleted: { type: Boolean, default: false },
  sendToEna: { type: Boolean, default: false }
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

schema.statics.GroupsIAmIn = function GroupsIAmIn(user) {
  if (user.isAdmin) {
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
    return Promise.resolve([])
  }

};

const Group = mongoose.model('Group', schema);

module.exports = Group
