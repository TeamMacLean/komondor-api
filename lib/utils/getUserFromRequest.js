const jwt = require("jsonwebtoken")

module.exports = function (req) {
    return new Promise((good, bad) => {
        const authorizationHeader = req.headers.authorization;
        if (
            authorizationHeader &&
            authorizationHeader.split(" ")[0] &&
            authorizationHeader.split(" ")[0].toLowerCase() === "bearer"
        ) {
            try {
                const decoded = jwt.verify(
                    authorizationHeader.split(" ")[1],
                    process.env.JWT_SECRET
                );
                good(decoded);
            } catch (err) {
                bad(err);
            }
        } else {
            good();
        }
    });
}