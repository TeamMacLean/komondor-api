const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const Read = require('../models/Read');
const mongoose = require('mongoose')

const _path = require('path')
const fs = require('fs');
const UPLOAD_PATH = _path.join(process.cwd(), 'files');

const createAdditionalFileDocument = async (file) => {

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

const createReadFileDocument = async (file, rawFilesUploadInfo) => {

    return await new Promise(async (res, rej) => {
        const originalName = file.name;
        
        // contingent variables
        var filePath;
        var name;
        if (rawFilesUploadInfo.method === 'hpc-mv'){
            
            name = file.name;            
            filePath = _path.join(process.env.HPC_TRANSFER_DIRECTORY, rawFilesUploadInfo.relativePath, file.name);
            
        } else { // file system uploader
            
            name = file.uploadName;
            filePath = _path.join(UPLOAD_PATH, name);
        
        }

        if (!name || !originalName || !filePath || rawFilesUploadInfo.method){
            console.error('Issue with finding info in File mongo document creation.\nname:', name, '\noriginalName:', originalName, '\nfilePath', filePath, '\nfarFilesUPloadInfo.method(whole obj):', rawFilesUploadInfo)
            // return Promise.reject();
        }
    
        const savedFile = await new File({
            name,
            type: 'run',
            originalName,
            path: filePath,
            createFileDocumentId: Math.random().toString(16).substr(2, 12),
            tempUploadPath: filePath,
            uploadName: name,
            uploadMethod: rawFilesUploadInfo.method,
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
                const savedFile = await createAdditionalFileDocument(file)
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
const sortReadFiles = async (readFiles, runId, runPath, rawFilesUploadInfo) => {
    const relPath = _path.join(runPath, 'raw')
    const absDestPath = _path.join(process.env.DATASTORE_ROOT, relPath);
    const errorInMkDir = false

    fs.promises.access(absDestPath)
        .then(() => {
            console.log('already has raw folder')
        })
        .catch(() => {
            console.log('creating raw folder')
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
                /** STEP 0: Initialise variable needed in steps 1 + 3 */
                const pairedEntriesToUpdate = [];
                
                /** STEP 1: Create promises to create File + Read documents */
                const filePromises = readFiles.map(async file => {   
                    const savedFile = await createReadFileDocument(file, rawFilesUploadInfo)

                    const readMD5 = (rawFilesUploadInfo.method === 'hpc-mv') ? file.MD5 : file.md5;
                    const readPaired = (rawFilesUploadInfo.method === 'hpc-mv') ? !!(file.sibling) : file.paired;

                    const readFile = await new Read({
                        run: runId,
                        md5: readMD5,
                        file: savedFile._id,
                        paired: readPaired,
                    }).save();

                    if (file.paired){

                        if (rawFilesUploadInfo.method === 'hpc-mv') {

                            pairedEntriesToUpdate.push({
                                id: readFile._id,
                                indexValue: pairedEntriesToUpdate.length,
                                siblingName: file.sibling,
                            });

                        } else {
                            pairedEntriesToUpdate.push({
                                id: readFile._id,
                                rowId: file.rowID,
                                indexValue: pairedEntriesToUpdate.length,
                            })
                        }                         
                    }
                    return readFile;
                })

                /** STEP 2: Execute creating File + Read documents */
                const stepTwo = await Promise.all(filePromises)

                // different methods based on raw files upload method
                var updateSiblingsPromises;
                if (rawFilesUploadInfo.method === 'hpc-mv'){
                    /** Create promises to update Read documents */                
                    updateSiblingsPromises = pairedEntriesToUpdate.map(async (completeEntry, index) => {
                        const siblingFindInfo = {name: completeEntry.siblingName};
                        try {
                            const result = await Read.find(siblingFindInfo);
                            const findInfo = {_id: mongoose.Types.ObjectId(completeEntry.id)};
                            const updateInfo = { sibling : mongoose.Types.ObjectId(result[0]._id)};
                            const updateResult = await Read.updateOne(findInfo, updateInfo);
                            return Promise.resolve();
                        } catch (e) {
                            Promise.reject(e)
                        }
                    });
                } else {
                    /** Update each paired=true entry with siblingID */
                    const entriesWithSiblingId = pairedEntriesToUpdate.map((entry, entryIndex) => {
                        var siblingTarget = pairedEntriesToUpdate.find((comparisonEntry, comparisonIndex) => {                        
                                if (entryIndex === comparisonIndex){
                                    return false // exclude ourselves
                                }
                                if (entry.rowId === comparisonEntry.rowId){
                                    return true // identical rows
                                }
                                return false;                            
                            })
                        return {
                            ...entry,
                            siblingId: siblingTarget.id || null,
                        };
                    })

                    /** Create promises to update Read documents */                
                    updateSiblingsPromises = entriesWithSiblingId.map(async (completeEntry, index) => {
                        const findInfo = {_id: mongoose.Types.ObjectId(completeEntry.id)}
                        const updateInfo = { sibling : mongoose.Types.ObjectId(completeEntry.siblingId)};
                        try {
                            const result = await Read.updateOne(findInfo, updateInfo);
                            return Promise.resolve();
                        } catch (e) {
                            Promise.reject(e)
                        }
                    })                                
                }
                
                /** STEP 5: Execute updating Read documents */
                const stepFive = await Promise.all(updateSiblingsPromises)
                
                return Promise.resolve();
            } catch (e) {                
                return Promise.reject(e)
            }
        })
}

module.exports = {
    sortAdditionalFiles,
    sortReadFiles,
}
