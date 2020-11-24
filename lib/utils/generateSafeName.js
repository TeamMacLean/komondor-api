function toSafeName(unsafeName) {
    return unsafeName
        .replace("&", "and")
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
}

const generateSafeNameFunc = (name, list) => {
    return new Promise((good, bad) => {
        const safeName = toSafeName(name);
        let canHave = false;
        let testName = safeName;
        let testCount = 1;

        const filter = function (res) {
            return res.safeName.toLowerCase() === testName.toLowerCase();
        };

        while (!canHave) {
            const dupes = list.filter(filter);

            if (dupes.length) {
                testCount += 1;
                testName = safeName + "_" + testCount;
            } else {
                canHave = true;
                good(testName);
            }
        }
    });
}

module.exports = {
    default: generateSafeNameFunc,
};