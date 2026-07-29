const Group = require("../../models/Group");

/**
 * Builds the JWT payload for a freshly authenticated LDAP user.
 *
 * @param {object} user - The raw LDAP user record.
 * @returns {Promise<object>} The token payload.
 */
module.exports = async function getUserForToken(user) {
  if (!user) {
    throw new Error("A user is required to build a token");
  }

  let fullName = user.displayName;
  if (user.givenName && user.sn) {
    fullName = user.givenName + " " + user.sn;
  }

  let email = user.mail;
  if (email) {
    email = email.toLowerCase();
  }

  const theUsername = user.username || user.uid;
  const isAdmin = theUsername === "admin";

  const groups = await Group.GroupsIAmIn(user);
  const groupIDS = groups.map((g) => g.id);
  const groupSafeNames = groups.map((g) => g.safeName);

  console.log(
    `[LOGIN] User "${theUsername}" logged in | Groups: [${groupSafeNames.join(", ")}] | Admin: ${!!isAdmin}`,
  );

  return {
    username: theUsername,
    name: user.fullName || fullName,
    company: user.company,
    email: user.email || email,
    groups: groupIDS,
    isAdmin,
  };
};
