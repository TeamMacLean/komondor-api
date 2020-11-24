const File = require('../models/File');
const AdditionalFile = require('../models/AdditionalFile');
const Read = require('../models/Read');
const mongoose = require('mongoose')

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
                /** STEP 0: Initialise variable needed in steps 1 + 3 */
                // console.log('STEP 0: Initialise variable needed in steps 1 + 3');               
                
                const pairedEntriesToUpdate = [];
                
                /** STEP 1: Create promises to create File + Read documents */
                // console.log('STEP 1: Create promises to create File + Read documents');

                const filePromises = readFiles.map(async file => {   
                    // console.log('file.rowId', file, file.rowId);

                    const savedFile = await createFileDocument(file)
                    const readFile = await new Read({
                        run: runId,
                        md5: file.md5,
                        file: savedFile._id,
                        paired: file.paired,
                    }).save();

                    if (file.paired){
                        pairedEntriesToUpdate.push({
                            id: readFile._id,
                            rowId: file.rowID,
                            indexValue: pairedEntriesToUpdate.length,
                        })
                    }

                    // if (!!readFile) {
                    //     console.log('readFile created', readFile._id);                        
                    // }
                    return readFile;
                })

                /** STEP 2: Execute creating File + Read documents */
                // console.log('STEP 2: Execute creating File + Read documents');
                
                const stepTwo = await Promise.all(filePromises)
                // console.log('steptwo complete', stepTwo);                

                /** STEP 3: Update each paired=true entry with siblingID */
                // console.log('STEP 3: Update each paired=true entry with siblingID');

                const entriesWithSiblingId = pairedEntriesToUpdate.map((entry, entryIndex) => {

                    // console.log('\n\n\ntrying to find sibling for entry #' + (entryIndex + 1) + ':');
                    // console.log('\tid of:', entry.id);
                    // console.log('\trowId of:', entry.rowId);   

                    const siblingTarget = pairedEntriesToUpdate.find((comparisonEntry, comparisonIndex) => {

                        // console.log('\ncomparing with entry #' + (comparisonIndex + 1) + ':');
                        // console.log('\tid of:', comparisonEntry.id);
                        // console.log('\trowId of:', comparisonEntry.rowId);                        

                        // exclude ourselves
                        if (entryIndex === comparisonIndex){
                            // console.log('CANNOT be itself, return false');
                            
                            return false
                        } else {
                            // console.log('is not itself, continuing search');                            
                        }
                        if (entry.rowId === comparisonEntry.rowId){
                            // console.log('rowIds are identical, returning true', entry.rowId);                            
                            return true
                        }
                        // console.log('rowIds werent matching, so returning false, FYI they were:', entry.rowId, comparisonEntry.rowId);                        
                        return false
                    })

                    // console.log('found siblingTarget: ' + siblingTarget.id);
                    // console.log('\thad rowId of:', siblingTarget.rowId);
                    
                    return {
                        ...entry,
                        siblingId: siblingTarget.id || null,
                    };
                })

                // console.log('stepthree complete', entriesWithSiblingId.length);

                /** STEP 4: Create promises to update Read documents */
                // console.log('STEP 4: Create promises to update Read documents');
                
                const updateSiblingsPromises = entriesWithSiblingId.map(async (completeEntry, index) => {
                    // console.log('reached for paired file #' + (index + 1));
                                        
                    const findInfo = {_id: mongoose.Types.ObjectId(completeEntry.id)}
                    const updateInfo = { sibling : mongoose.Types.ObjectId(completeEntry.siblingId)};
                    try {
                        // console.log('about to try with this:', findInfo, updateInfo);
                        const result = await Read.updateOne(findInfo, updateInfo);
                        console.log('Updated read outcome:', result);
                        
                        return Promise.resolve();
                    } catch (e) {
                        Promise.reject(e)
                    }
                })
                
                /** STEP 5: Execute updating Read documents */
                // console.log('STEP 5: Execute updating Read documents');

                const stepFive = await Promise.all(updateSiblingsPromises)
                // console.log('stepFive complete', stepFive);
                // console.log('now returning promise.resolve');
                
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
