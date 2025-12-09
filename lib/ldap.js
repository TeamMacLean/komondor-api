const LdapAuth = require("ldapauth-fork");
const ldap = require("ldapjs");

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

/**
 * Verifies if a username exists in LDAP without requiring their password.
 * Uses the service account credentials to search for the user.
 * @param {string} username - The username to verify
 * @returns {Promise<{exists: boolean, user?: object}>} - Whether the user exists and their info if found
 */
exports.verifyUserExists = function verifyUserExists(username) {
  return new Promise((resolve, reject) => {
    if (!username) {
      reject(new Error("Username is required for verification"));
      return;
    }

    const client = ldap.createClient({
      url: process.env.LDAP_URL,
    });

    client.on("error", (err) => {
      console.error("LDAP client error:", err);
      reject(err);
    });

    // Bind with service account
    client.bind(
      process.env.LDAP_BIND_DN,
      process.env.LDAP_BIND_CREDENTIALS,
      (bindErr) => {
        if (bindErr) {
          console.error("LDAP bind error:", bindErr);
          client.unbind();
          reject(bindErr);
          return;
        }

        // Build search filter from template
        const searchFilter = process.env.LDAP_SEARCH_FILTER.replace(
          "{{username}}",
          username,
        );

        const searchOptions = {
          scope: "sub",
          filter: searchFilter,
          attributes: ["uid", "cn", "mail", "sn", "givenName"],
        };

        client.search(
          process.env.LDAP_SEARCH_BASE,
          searchOptions,
          (searchErr, res) => {
            if (searchErr) {
              console.error("LDAP search error:", searchErr);
              client.unbind();
              reject(searchErr);
              return;
            }

            let userFound = null;

            res.on("searchEntry", (entry) => {
              userFound = {
                username: entry.pojo?.attributes?.find((a) => a.type === "uid")
                  ?.values?.[0],
                cn: entry.pojo?.attributes?.find((a) => a.type === "cn")
                  ?.values?.[0],
                mail: entry.pojo?.attributes?.find((a) => a.type === "mail")
                  ?.values?.[0],
              };
            });

            res.on("error", (err) => {
              console.error("LDAP search result error:", err);
              client.unbind();
              reject(err);
            });

            res.on("end", () => {
              client.unbind();
              if (userFound) {
                resolve({ exists: true, user: userFound });
              } else {
                resolve({ exists: false });
              }
            });
          },
        );
      },
    );
  });
};
