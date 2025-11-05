const LdapAuth = require("ldapauth-fork");

exports.authenticate = function authenticate(username, password) {
  return new Promise((good, bad) => {
    if (!username) {
      console.error("LDAP authentication error: No username provided");
      bad(new Error("Username is required for authentication"));
      return;
    }

    const options = {
      url: process.env.LDAP_URL,
      bindDN: process.env.LDAP_BIND_DN,
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS,
      searchBase: process.env.LDAP_SEARCH_BASE,
      searchFilter: process.env.LDAP_SEARCH_FILTER,
    };
    const auth = new LdapAuth(options);
    auth.authenticate(username, password, function (err, user) {
      auth.close(function () {
        // We don't care about the closing
      });

      if (err) {
        bad(err);
      } else {
        if (user) {
          // if (user.username && user.username === "ges23jir") {
          //   console.log(
          //     "Figure out auth for user " + user.username + ":",
          //     user,
          //   );
          // }
          good(user);
        } else {
          bad(new Error("user not found"));
        }
      }
    });
    auth.once("error", function (err) {
      console.error("LDAP once authentication error:", err);
    });
    auth.on("error", function (err) {
      console.error("LDAP on authentication error:", err);
    });
  });
};
