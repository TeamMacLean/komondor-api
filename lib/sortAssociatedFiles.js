const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const Read = require('../models/Read');

const _path = require('path')
const fs = require('fs');
const UPLOAD_PATH = _path.join(process.cwd(), 'uploads');

const createFileDocument = async (file) => {

    return await new Promise(async (res, rej) => {
        const name = file.uploadName;
        const originalName = file.name;
        const type = file.type;
        
        const filePath = _path.join(UPLOAD_PATH, name);
    
        const savedFile = await new File({
            name,
            type,
            originalName,
            path: filePath,
            createFileDocumentId: Math.random().toString(16).substr(2, 12),
            tempUploadPath: filePath,
            uploadName: name
        }).save();
    
        res(savedFile);
    });
}

const sortAdditionalFiles = async (additionalFiles, savedParentType, savedParentId, savedParentPath) => {
    
    const relPath = _path.join(savedParentPath, 'additional')
    const absDestPath = _path.join(process.env.DATASTORE_ROOT, relPath);
    const errorInMkDir = false

    fs.promises.access(absDestPath)
        .then(() => {
            console.log('already has additional folder')
        })
        .catch(() => {
            console.log('creating additional folder')
            try {
                return fs.promises.mkdir(absDestPath)
            } catch (e) {
                errorInMkDir = true;
                return Promise.resolve();
            }
        })
        .finally(async () => {
            if (errorInMkDir){
                return Promise.reject('Error in mkdir')
            }
            try {
                const filePromises = additionalFiles.map(async file => {    
                    const savedFile = await createFileDocument(file)
                    const additionalFile = await new AdditionalFile({
                        [savedParentType]: savedParentId,
                        file: savedFile._id
                    }).save();
                    return additionalFile;
                })
    
                return Promise.all([filePromises])
            } catch (e) {                
                return Promise.reject(e)
            }
        })
}

// TODO refactor with shared code of sortAdditioanlFiles
const sortReadFiles = async (readFiles, runId, runPath) => {
    const relPath = _path.join(runPath, 'raw')
    const absDestPath = _path.join(process.env.DATASTORE_ROOT, relPath);
    const errorInMkDir = false

    fs.promises.access(absDestPath)
        .then(() => {
            console.log('already has additional folder')
        })
        .catch(() => {
            console.log('creating additional folder')
            try {
                return fs.promises.mkdir(absDestPath)
            } catch (e) {
                errorInMkDir = true;
                return Promise.resolve();
            }
        })
        .finally(async () => {
            if (errorInMkDir){
                return Promise.reject('Error in mkdir')
            }
            try {
                const filePromises = readFiles.map(async file => {    
                    console.log('should be md5 (and paried, sibling?) amongst this:', file);
                    
                    const savedFile = await createFileDocument(file)
                    const readFile = await new Read({
                        run: runId,
                        md5: file.md5,
                        file: savedFile._id,
                        paired: file.paired,
                        sibling: file.sibling || null,
                    }).save();
                    return readFile;
                })
    
                return Promise.all([filePromises])
            } catch (e) {                
                return Promise.reject(e)
            }
        })
}

module.exports = {
    sortAdditionalFiles,
    sortReadFiles,
}