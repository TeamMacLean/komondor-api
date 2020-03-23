const File = require("../models/File")
// const FileGroup = require("../models/FileGroup")
const path = require("path")
const UPLOAD_PATH = path.join(process.cwd(), 'uploads');

function _parseMetadataString(metadata_string) {
  const kv_pair_list = metadata_string.split(",");
  return kv_pair_list.reduce((metadata, kv_pair) => {
    const [key, base64_value] = kv_pair.split(" ");
    metadata[key] = Buffer.from(base64_value, "base64").toString("ascii")
    return metadata;
  }, {});
}

module.exports = {
  create: function (event) {
    const parsed = _parseMetadataString(event.file.upload_metadata);


    console.log(parsed);
    if (!parsed.filename || !parsed.filetype || !parsed.uploadID || !parsed.UUID) {
      console.error("BAD UPLOAD", parsed)
      return;
    }

    // const UUID = parsed.UUID;
    const name = event.file.id;
    const originalName = parsed.filename;
    const type = parsed.filetype;
    // const uploadID = parsed.uploadID;
    // const rowID = parsed.rowID;
    const description = parsed.description ? parsed.description : null;

    const filePath = path.join(UPLOAD_PATH, name);

    // console.log(event, parsed)

    if (name && originalName && type && uploadID) {
      //TODO move the file to its final location

      return new File({
        name,
        type,
        originalName,
        description,
        path: filePath,
        uploadName: name
      }).save();
    } else {
      console.error("incomplete");
    }
  }
}