module.exports = function (unsafeName) {
    return unsafeName
        .replace("&", "and")
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
}