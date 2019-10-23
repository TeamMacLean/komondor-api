var LdapAuth = require('ldapauth-fork');
// LDAP Connection Settings
const server = process.env.LDAP_URL; // 192.168.1.1
const bindDN = process.env.LDAP_BIND_DN; // Username
const bindCredentials = process.env.LDAP_BIND_CREDENTIALS; // User password
const bindSearchBase = process.env.LDAP_SEARCH_BASE; // test.com
const searchFilter = process.env.LDAP_SEARCH_FILTER;


function authenticate(username, password) {
  return new Promise((good, bad) => {

    const options = {
      url: server,
      bindDN: bindDN,
      bindCredentials: bindCredentials,
      searchBase: bindSearchBase,
      searchFilter: searchFilter
    };
    const auth = new LdapAuth(options);
    auth.authenticate(username, password, function (err, user) {

      // console.log(user)

      auth.close(function () {
        // We don't care about the closing
      });

      if (err) {
        bad(err)
      } else {
        if (user) {
          good(user);
        } else {
          bad(new Error('user not found'))
        }
      }
    });
    auth.once('error', function (err) {

    });
    auth.on('error', function () { /* Ignored */
    });
  })
}

module.exports = {authenticate};
