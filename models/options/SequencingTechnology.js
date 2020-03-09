const mongoose = require('mongoose')


module.exports = mongoose.model('SequencingTechnology',
    new mongoose.Schema({
        value: { type: String, required: true },
    })
);