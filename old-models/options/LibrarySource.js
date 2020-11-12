const mongoose = require('mongoose')


module.exports = mongoose.model('LibrarySource',
    new mongoose.Schema({
        value: { type: String, required: true },
    })
);