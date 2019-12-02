import LdapAuth from 'ldapauth-fork';

export function authenticate(username, password) {
  return new Promise((good, bad) => {

    const options = {
      url: process.env.LDAP_URL,
      bindDNz: process.env.LDAP_BIND_DN,
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS,
      searchBase: process.env.LDAP_SEARCH_BASE,
      searchFilter: process.env.LDAP_SEARCH_FILTER
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
