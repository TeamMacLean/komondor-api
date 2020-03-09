const jwt = require("jsonwebtoken")

module.exports = function (user) {
    return new Promise((good, bad) => {
        const token = jwt.sign(user, process.env.JWT_SECRET);
        good(token);
    })
}
