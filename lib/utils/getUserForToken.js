const Group = require("../../models/Group");

/**
 * Builds the JWT payload for a freshly authenticated LDAP user.
 * @param {object} user - Raw LDAP user record.
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

  // Write mode: this stamps the token's `groups` claim, which later write
  // checks trust as real membership. Read mode would stamp every group id.
  const groups = await Group.GroupsIAmIn(user, { mode: "write" });
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
