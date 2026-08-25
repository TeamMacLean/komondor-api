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

  // Write mode, deliberately. This call stamps the token's `groups` claim, and
  // Group.GroupsIAmIn reads that claim back as real membership when answering
  // write checks. In read mode a FULL_RECORDS_ACCESS_USERS user's token would
  // be stamped with every group id, and the write check would then trust the
  // inflated claim — silently re-granting write-everywhere and defeating the
  // read/write split. Cross-group *read* breadth is unaffected: it is
  // re-derived per request from the username against getFullAccessUsers().
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
