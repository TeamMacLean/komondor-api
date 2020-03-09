const path = require('path');
const fs = require('fs');
const File = require('../../models/File');

function makeFolder(dirpath) {
    return fs.promises.mkdir(dirpath, { recursive: true })
}

module.exports = function (doc) {


    return File.find({ uploadID: doc.rawFilesUploadID })
        .then(filesFound => {
            if (filesFound && filesFound.length) {
                return doc.getRelativePath()
                    .then(relPath => {
                        relPath = path.join(relPath, 'raw')
                        const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const ToMove = filesFound.map(file => {
                                    const relPathWithFilename = path.join(relPath, file.originalName)
                                    const returnType = file.moveToFolderAndSave(relPathWithFilename)
                                    return returnType
                                })

                                return Promise.all(ToMove)
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