const jwt = require("jsonwebtoken");

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
          process.env.JWT_SECRET,
        );
        // Tokens issued before August 2026 carry no exp claim and
        // would otherwise stay valid forever — including the stale
        // empty-groups tokens from the LDAP group-string incident.
        // Refusing them forces a one-time re-login; every token
        // issued since jwtSign added expiresIn has exp set.
        if (typeof decoded.exp !== "number") {
          bad(
            new jwt.TokenExpiredError(
              "legacy token without expiry",
              new Date(0),
            ),
          );
          return;
        }
        good(decoded);
      } catch (err) {
        bad(err);
      }
    } else {
      good();
    }
  });
};
