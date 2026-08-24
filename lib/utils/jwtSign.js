const jwt = require("jsonwebtoken");

// Tokens used to be signed without an expiry, so a token issued while group
// resolution was broken carried its empty groups forever. An expiry bounds
// that: group membership is baked into the token at login, so it can only be
// this stale before the client is forced to re-authenticate (the API answers
// 401 and the web app's interceptor redirects to sign-in).
const DEFAULT_EXPIRY = "7d";

module.exports = function (user) {
  return new Promise((good, bad) => {
    try {
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRY,
      });
      good(token);
    } catch (err) {
      bad(err);
    }
  });
};
