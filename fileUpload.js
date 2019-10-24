const File = require('./models/File');
const FileGroup = require('./models/FileGroup');
const path = require('path');
const UPLOAD_PATH = process.env.UPLOAD_PATH;

// const fs = require('fs');
// const path = require('path');
//
// function move(oldPath, newPath, callback) {
//
//     fs.rename(oldPath, newPath, function (err) {
//         if (err) {
//             if (err.code === 'EXDEV') {
//                 copy();
//             } else {
//                 callback(err);
//             }
//             return;
//         }
//         callback();
//     });
//
//     function copy() {
//         var readStream = fs.createReadStream(oldPath);
//         var writeStream = fs.createWriteStream(newPath);
//
//         readStream.on('error', callback);
//         writeStream.on('error', callback);
//
//         readStream.on('close', function () {
//             fs.unlink(oldPath, callback);
//         });
//
//         readStream.pipe(writeStream);
//     }
// }

module.exports = {


    create: function (event) {

        const parsed = this._parseMetadataString(event.file.upload_metadata);

        console.log('parsed', parsed);

        const name = event.file.id;
        const originalName = parsed.filename.decoded;
        const type = parsed.filetype.decoded;
        const uploadID = parsed.uploadID.decoded;
        const description = parsed.description ? parsed.description.decoded : null;

        const filePath = path.join(UPLOAD_PATH, name);

        if (name && originalName && type && uploadID) {

            //TODO move the file to its final location

            FileGroup.findOne({uploadID: uploadID})
                .then(foundGroup => {
                    if (foundGroup) {
                        return Promise.resolve(foundGroup)
                    } else {
                        return new FileGroup({
                            uploadID: uploadID
                        }).save()
                    }
                })
                .then(fileGroup => {

                    return new File({
                        fileGroup: fileGroup._id,
                        name,
                        type,
                        originalName,
                        description,
                        path: filePath
                    })
                        .save()

                })
                .then(savedFile => {
                    console.log('saved', savedFile);
                })
                .catch(err => console.error(err));
        } else {
            console.error('incomplete');
        }
    },

    _parseMetadataString(metadata_string) {
        const kv_pair_list = metadata_string.split(',');
        return kv_pair_list.reduce((metadata, kv_pair) => {
            const [key, base64_value] = kv_pair.split(' ');
            metadata[key] = {
                encoded: base64_value,
                decoded: Buffer.from(base64_value, 'base64').toString('ascii'),
            };
            return metadata;
        }, {});
    }


};
