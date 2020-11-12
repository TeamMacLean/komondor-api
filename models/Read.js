import { Schema as _Schema, model } from 'mongoose';

const schema = new _Schema({
    run: { type: _Schema.Types.ObjectId, ref: 'Run', required: true, unique: false },
    file: { type: _Schema.Types.ObjectId, ref: 'File', required: true, unique: true },
    MD5: { type: String }, // TODO one day migrate to File object (along with File)
    paired: { type: Boolean }, // removed required because of migration script
    sibling: { type: _Schema.Types.ObjectId, ref: 'Read' },

    oldReadId: {type: String}, // George added, basically a flag for migration
    oldSiblingID: {type: String}, //https://stackoverflow.com/questions/7955040/mongodb-mongoose-unique-if-not-null
    oldRunID: {type: String}, 

    // check with Martin whether to keep these
    // oldLegacyPath: { type: String },
    // oldFileName: { type: String },
    // oldSafeName: { type: String },
    // oldProcessed: { type: Boolean },
    // oldFastQCLocation: { type: String },
}, { timestamps: true, toJSON: { virtuals: true } });

schema.pre('save', function (next) {

    if (this.oldReadId){
        // migrated, so dont do file change
        next()
    } else {
        const Run = require('./Run').default;
        const read = this;
        const path = require('path');
        const fs = require('fs');

        console.log('SHOULD NOT REACH');
    
        function makeFolder(dirpath) {
            return fs.promises.mkdir(dirpath, { recursive: true })
        }
        
        return Promise.all([Run.findById(this.run), read.populate('file').execPopulate()])
            .then(out => {
                const run = out[0];
                const reeeeed = out[1];
                return run.getRelativePath()
                    .then(relPath => {
                        relPath = path.join(relPath, 'raw')
                        const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const relPathWithFilename = path.join(relPath, reeeeed.file.originalName)
                                return reeeeed.file.moveToFolderAndSave(relPathWithFilename)
                            })
                    })
            })
            .then((res) => {
                next()
            })
            .catch(next)
    }
});

const Read = model('Read', schema);

export default Read;
