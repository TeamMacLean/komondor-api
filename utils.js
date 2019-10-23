const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = {
    _toSafeName(unsafeName) {
        return unsafeName.replace('&', 'and').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    },
    generateSafeName(name, list) {
        return new Promise((good, bad) => {
            const safeName = this._toSafeName(name);
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
                    testName = safeName + '_' + testCount;
                } else {
                    canHave = true;
                    good(testName);
                }
            }
        })
    },
    getUserFromRequest(req) {
        return new Promise((good, bad) => {
            const authorizationHeader = req.headers.authorization;
            // console.log(req.url);
            // console.log('headers', req.headers.authorization);
            if (authorizationHeader && authorizationHeader.split(' ')[0] === 'Bearer') {
                // console.log(authorizationHeader.split(' ')[1], JWT_SECRET);

                try {
                    const decoded = jwt.verify(authorizationHeader.split(' ')[1], JWT_SECRET);
                    good(decoded);
                } catch (err) {
                    bad(err)
                }

            } else {
                good();
            }
        })
    }
};
