const LdapAuth = require("ldapauth-fork");
const ldap = require("ldapjs");

/**
 * Escapes the special characters of an LDAP search filter value (RFC 4515).
 *
 * The search filter is built by substituting a username into a template, so an
 * unescaped value such as `*` or `admin)(uid=*` would rewrite the filter and
 * match users it should not.
 *
 * @param {string} value - The untrusted value to embed in a filter.
 * @returns {string} The escaped value.
 */
const escapeLdapFilterValue = (value) =>
  String(value).replace(/[\\*()\0/]/g, (char) => {
    switch (char) {
      case "\\":
        return "\\5c";
      case "*":
        return "\\2a";
      case "(":
        return "\\28";
      case ")":
        return "\\29";
      case "\0":
        return "\\00";
      case "/":
        return "\\2f";
      default:
        return char;
    }
  });

exports.escapeLdapFilterValue = escapeLdapFilterValue;

// Give up on an unresponsive LDAP server rather than leaving the HTTP request
// hanging until the client times out.
const LDAP_AUTH_TIMEOUT_MS = Number(process.env.LDAP_TIMEOUT_MS) || 15000;

exports.authenticate = function authenticate(username, password) {
  return new Promise((good, bad) => {
    if (!username) {
      console.error("[LDAP] Authentication error: No username provided");
      bad(new Error("Username is required for authentication"));
      return;
    }

    if (!process.env.LDAP_URL) {
      bad(new Error("LDAP is not configured (LDAP_URL is required)"));
      return;
    }

    const options = {
      url: process.env.LDAP_URL,
      bindDN: process.env.LDAP_BIND_DN,
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS,
      searchBase: process.env.LDAP_SEARCH_BASE,
      searchFilter: process.env.LDAP_SEARCH_FILTER,
    };

    let auth;
    try {
      auth = new LdapAuth(options);
    } catch (constructionError) {
      console.error("[LDAP] Failed to create client:", constructionError);
      bad(constructionError);
      return;
    }

    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        auth.close(function () {
          // We don't care about the closing
        });
      } catch (closeError) {
        console.error("[LDAP] Error closing client:", closeError);
      }
      fn(value);
    };

    // Registered before authenticate() so a connection failure always has a
    // listener; an unhandled 'error' event would otherwise throw.
    //
    // Deliberately does not settle the promise. ldapauth-fork re-emits 'error'
    // and 'connectTimeout' from both its admin and user clients, so a transient
    // socket blip would otherwise race ahead of the authenticate callback and
    // be reported to the user as "Bad credentials". The timeout below is what
    // guarantees this promise settles.
    let lastTransportError = null;
    auth.on("error", function (err) {
      console.error("[LDAP] Authentication error:", err);
      lastTransportError = err;
    });

    timer = setTimeout(() => {
      // Prefer the transport's own error: "connect ECONNREFUSED" is far more
      // actionable in the logs than a bare timeout.
      finish(
        bad,
        lastTransportError || new Error("LDAP authentication timed out"),
      );
    }, LDAP_AUTH_TIMEOUT_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    auth.authenticate(username, password, function (err, user) {
      if (err) {
        finish(bad, err);
      } else if (user) {
        finish(good, user);
      } else {
        finish(bad, new Error("user not found"));
      }
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
    if (!username || typeof username !== "string") {
      reject(new Error("Username is required for verification"));
      return;
    }

    const { LDAP_URL, LDAP_SEARCH_FILTER, LDAP_SEARCH_BASE } = process.env;

    if (!LDAP_URL || !LDAP_SEARCH_FILTER || !LDAP_SEARCH_BASE) {
      reject(
        new Error(
          "LDAP is not configured (LDAP_URL, LDAP_SEARCH_FILTER and LDAP_SEARCH_BASE are required)",
        ),
      );
      return;
    }

    // The promise settles once; later client 'error' events must not re-reject.
    let settled = false;
    const settleOnce = (fn) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };
    const resolveOnce = settleOnce(resolve);
    const rejectOnce = settleOnce(reject);

    const client = ldap.createClient({
      url: LDAP_URL,
    });

    client.on("error", (err) => {
      console.error("[LDAP] Client error:", err);
      rejectOnce(err);
    });

    // Bind with service account
    client.bind(
      process.env.LDAP_BIND_DN,
      process.env.LDAP_BIND_CREDENTIALS,
      (bindErr) => {
        if (bindErr) {
          console.error("[LDAP] Bind error:", bindErr);
          client.unbind();
          rejectOnce(bindErr);
          return;
        }

        // Build search filter from template. The username is escaped so it
        // cannot alter the structure of the filter.
        const searchFilter = LDAP_SEARCH_FILTER.replace(
          "{{username}}",
          escapeLdapFilterValue(username),
        );

        const searchOptions = {
          scope: "sub",
          filter: searchFilter,
          attributes: ["uid", "cn", "mail", "sn", "givenName"],
        };

        client.search(LDAP_SEARCH_BASE, searchOptions, (searchErr, res) => {
          if (searchErr) {
            console.error("[LDAP] Search error:", searchErr);
            client.unbind();
            rejectOnce(searchErr);
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
            console.error("[LDAP] Search result error:", err);
            client.unbind();
            rejectOnce(err);
          });

          res.on("end", () => {
            client.unbind();
            if (userFound) {
              resolveOnce({ exists: true, user: userFound });
            } else {
              resolveOnce({ exists: false });
            }
          });
        });
      },
    );
  });
};
