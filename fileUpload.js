const File = require('./models/File');
const FileGroup = require( './models/FileGroup');

module.exports = {

  create: function (event) {

    const parsed = this._parseMetadataString(event.file.upload_metadata);

    console.log('file', parsed);

    const name = event.file.id;
    const originalName = parsed.filename.decoded;
    const type = parsed.filetype.decoded;
    const uploadID = parsed.uploadID.decoded;
    const description = parsed.description ? parsed.description.decoded : null;

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
            fileGroup:fileGroup._id,
            name,
            type,
            originalName,
            description
          })
            .save()

        })
        .then(savedFile => {
          console.log('saved', savedFile.name);
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
