const mongoose = require('mongoose')


module.exports = mongoose.model('LibrarySelection',
    new mongoose.Schema({
        value: { type: String, required: true },
    })
);