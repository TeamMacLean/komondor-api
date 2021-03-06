const mongoose = require('mongoose')

const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  company: { type: String, required: true },
  email: { type: String, required: true },
  lastLogin: { type: 'Date', default: Date.now },
  isAdmin: { type: Boolean, default: false },
  groups: { type: [String], default: [] },
  // TODO hasLeftCompany: {type: Boolean, default: false},
}, { timestamps: true,toJSON: { virtuals: true }});

schema.statics.login = function login(id) {
  return this.findByIdAndUpdate(id, { $set: { 'lastLogin': Date.now() } });
};

schema.methods.notifyLogin = function login() {
  this.lastLogin = Date.now();
  return this.save();
};

const User = mongoose.model('User', schema);

module.exports = User
