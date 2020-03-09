const mongoose = require('mongoose')


module.exports = mongoose.model('LibraryType',
    new mongoose.Schema({
        value: { type: String, required: true },
        paired: { type: Boolean, required: true }
    })
);