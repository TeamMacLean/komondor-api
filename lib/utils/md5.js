const crypto = require('crypto');
const fs = require('fs');

/**
 * Calculates the MD5 checksum of a file.
 * @param {string} filePath - The absolute path to the file.
 * @returns {Promise<string>} A promise that resolves with the MD5 checksum in hex format,
 * or rejects if an error occurs.
 */
const calculateFileMd5 = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => {
      hash.update(data);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      console.error(`Error calculating MD5 for file ${filePath}:`, err);
      reject(err);
    });
  });
};

module.exports = {
  calculateFileMd5,
};
