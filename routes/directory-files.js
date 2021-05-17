const { isAuthenticated } = require("./middleware")
const _path = require('path')
const express = require("express")
const fs = require('fs')
let router = express.Router();

const cleanTargetDirectoryName = (targetDirectoryName) => {

  let result = targetDirectoryName;

  // remove beginning and trailing slashes
  if (result.startsWith('/')){
    result = result.substr(1, result.length)
  } 
  if (result.endsWith('/')){
    result = result.substr(0, result.length - 1)
  } 

  return result;
};

router
  .route('/directory-files')
  .all(isAuthenticated)
  .get(async (req, res) => {
    const { targetDirectoryName } = req.query;

    console.log('targetDirectoryName', targetDirectoryName);

    try {                            
      const cleanedTargetDirectoryName = cleanTargetDirectoryName(targetDirectoryName);
      
      const dirRoot = _path.join(process.env.HPC_TRANSFER_DIRECTORY, cleanedTargetDirectoryName);

      console.log('dirRoot', dirRoot);
      
      var dirExists = false;
      try {
          dirExists = fs.statSync(dirRoot).isDirectory();
      } catch (e) {
          throw new Error('Issue reading target directory')
      }                            
      if (!dirExists){
        throw new Error('Directory does not exist')
      }

      const filesResults = fs.readdirSync(dirRoot)

      if (!filesResults.length){
        throw new Error('No files found in target directory')
      }

      res.status(200).send({
          filesResults,
      });

    } catch (e) {
        console.error(e, e.message)
        res.status(200).send({error: e.message})
    }

  });

  module.exports =  router;
