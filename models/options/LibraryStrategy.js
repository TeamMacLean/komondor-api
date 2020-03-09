const mongoose = require('mongoose')


module.exports = mongoose.model('LibraryStrategy',
    new mongoose.Schema({
        value: { type: String, required: true },
    })
);