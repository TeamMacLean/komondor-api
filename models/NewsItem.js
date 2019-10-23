const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const schema = new Schema({

  type: {type: String, required: true},
  typeId: {type: String, required: true},
  owner: {type: String, required: true},
  group: {type: String, required: true},
  name: {type: String, required: true},
  body: {type: String, required: true}

}, {timestamps: true});

schema.statics.iCanSee = function iCanSee(user) {
  if (user.username === 'admin') {
    return NewsItem.find({})
  }
  const filters = [
    {'owner': user.username}
  ];
  if (user.groups) {
    user.groups.map(g => {
      filters.push({'group': g})
    });
  }
  return NewsItem.find({$or: filters})
};


const NewsItem = mongoose.model('NewsItem', schema);


module.exports =  NewsItem
