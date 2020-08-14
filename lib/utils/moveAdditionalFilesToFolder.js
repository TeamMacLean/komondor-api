
function makeFolder(dirpath) {
    const fs = require('fs');
    return fs.promises.mkdir(dirpath, { recursive: true })
}

module.exports = function (doc) {
    const path = require('path');
    const AdditionalFile = require('../../models/AdditionalFile');
    AdditionalFile.find({
        $or: [
            { 'project': doc._id },
            { 'sample': doc._id },
            { 'run': doc._id },
        ]
    })
        .populate('file')
        .then(additionalFiles => {
            if (additionalFiles && additionalFiles.length) {
                return doc.getRelativePath()
                    .then(relPath => {
                        relPath = path.join(relPath, 'additional')
                        const absPath = path.join(process.env.DATASTORE_ROOT, relPath);
                        return makeFolder(absPath)
                            .then(() => {
                                const ToMove = additionalFiles.map(additionalFile => {
                                    // console.log('additionalFile', additionalFile)
                                    const relPathWithFilename = path.join(relPath, additionalFile.file.originalName)
                                    const returnType = additionalFile.file.moveToFolderAndSave(relPathWithFilename)
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