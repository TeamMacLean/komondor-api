const Group = require("../../models/Group");

module.exports = function (user) {
  return new Promise((good, bad) => {
    let fullName = user.displayName;
    if (user.givenName && user.sn) {
      fullName = user.givenName + " " + user.sn;
    }

    let email = user.mail;
    if (email) {
      email = email.toLowerCase();
    }

    const isAdmin = user.username === "admin";

    Group.GroupsIAmIn(user)
      .then((groups) => {
        const groupIDS = groups.map((g) => g.id);

        const theUsername = user.username || user.uid;

        return good({
          username: theUsername,
          name: user.fullName || fullName,
          company: user.company,
          email: user.email || email,
          groups: groupIDS,
        });
      })
      .catch((err) => {
        return bad(err);
      });
  });
};
