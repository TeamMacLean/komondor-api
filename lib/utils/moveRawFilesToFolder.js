const path = require('path');
const fs = require('fs');
const File = require('../../models/File');

function makeFolder(dirpath) {
    return fs.promises.mkdir(dirpath, { recursive: true })
}

module.exports = function (doc) {

    doc.populate('file')
        .then(doc => {
            if (doc) {
                return doc.getRelativePath()
                    .then(relPath => {
                        relPath = path.join(relPath, 'raw')
                        const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const relPathWithFilename = path.join(relPath, file.originalName)
                                return file.moveToFolderAndSave(relPathWithFilename)
                            })
                    })
            } else {
                return Promise.resolve()
            }
        })
        .catch(err => {
            return Promise.reject(err);
        });

   
}