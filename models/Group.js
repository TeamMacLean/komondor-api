const mongoose = require("mongoose");
const generateSafeName = require("../lib/utils/generateSafeName").default;
const _path = require("path");
const fs = require("fs");

const FULL_RECORDS_ACCESS_USERS = process.env.FULL_RECORDS_ACCESS_USERS;

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    safeName: { type: String, required: true },
    ldapGroups: { type: [String], required: true },
    deleted: { type: Boolean, default: false },
    sendToEna: { type: Boolean, default: false },
    oldId: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

/**
 * Pre-validate hook to generate a safe name for the grouph
 */
schema.pre("validate", async function () {
  try {
    const allOthers = await Group.find({});
    const othersExcludingSelf = allOthers.filter(
      (group) => group._id.toString() !== this._id.toString(),
    );

    this.safeName = await generateSafeName(this.name, othersExcludingSelf);
  } catch (error) {
    console.error(
      `Error generating safe name for group "${this.name}":`,
      error,
    );
    throw error;
  }
});

/**
 * Post-save hook to create directory for group if it doesn't exist
 */
schema.post("save", async function () {
  const absDestPath = _path.join(process.env.DATASTORE_ROOT, this.safeName);

  try {
    await fs.promises.access(absDestPath);
    // Directory already exists, no action needed
  } catch (accessError) {
    // Directory doesn't exist, create it
    try {
      await fs.promises.mkdir(absDestPath, { recursive: true });
      console.log(
        `Directory created for group "${this.name}" at: ${absDestPath}`,
      );
    } catch (mkdirError) {
      console.error(
        `Failed to create directory for group "${this.name}" at ${absDestPath}:`,
        mkdirError,
      );
    }
  }
});

/**
 * Static method to find all groups a user belongs to
 * @param {Object} user - User object with authentication details
 * @returns {Promise<Array>} Array of groups the user belongs to
 */
schema.statics.GroupsIAmIn = async function GroupsIAmIn(user) {
  if (!user) {
    console.error("GroupsIAmIn: No user provided");
    throw new Error("User object is required");
  }

  // Log the full user object structure for debugging
  // console.log(
  //   "GroupsIAmIn: Full user object received:",
  //   JSON.stringify(user, null, 2),
  // );

  // Detect username from various possible properties
  const username =
    user.sAMAccountName || user.uid || user.mailNickname || "unknown";
  // console.log(`GroupsIAmIn: Processing user "${username}"`);

  // Parse full access users from environment variable
  let fullAccessUsers = [];
  if (FULL_RECORDS_ACCESS_USERS) {
    try {
      // Try parsing as JSON array first
      fullAccessUsers = JSON.parse(FULL_RECORDS_ACCESS_USERS);
    } catch (e) {
      // Fall back to comma-separated string
      fullAccessUsers = FULL_RECORDS_ACCESS_USERS.split(",").map((u) =>
        u.trim(),
      );
    }
  }

  // Log FULL_RECORDS_ACCESS_USERS for debugging
  // console.log(
  //   `GroupsIAmIn: FULL_RECORDS_ACCESS_USERS configured:`,
  //   fullAccessUsers.length > 0 ? fullAccessUsers : "NONE",
  // );
  // console.log(
  //   `GroupsIAmIn: Checking if "${username}" is in full access list:`,
  //   fullAccessUsers.includes(username),
  // );

  let groupFindCriteria = null;

  //console.log(user);

  // Determine group find criteria based on user permissions
  if (user.isAdmin) {
    // console.log(
    //   `GroupsIAmIn: User "${username}" is admin - granting all groups access`,
    // );
    groupFindCriteria = {};
  } else if (fullAccessUsers.length && fullAccessUsers.includes(username)) {
    // console.log(
    //   `GroupsIAmIn: User "${username}" has full access - granting all groups access`,
    // );
    groupFindCriteria = {};
  } else if (user.groups && user.groups.length) {
    // console.log(
    //   `GroupsIAmIn: User "${username}" has ${user.groups.length} group(s) directly assigned`,
    // );
    groupFindCriteria = {
      _id: { $in: user.groups },
    };
  } else if (user.memberOf && user.memberOf.length) {
    console.log(
      `GroupsIAmIn: User "${username}" has ${user.memberOf.length} LDAP group(s) to match`,
    );

    const filters = user.memberOf.map((ldapString) => ({
      ldapGroups: ldapString,
    }));

    groupFindCriteria = { $or: filters };
  } else {
    console.error(
      `GroupsIAmIn: No valid criteria found for user "${username}". ` +
        `User object:`,
      JSON.stringify(
        {
          username: username,
          isAdmin: user.isAdmin,
          groups: user.groups,
          memberOf: user.memberOf,
        },
        null,
        2,
      ),
    );
  }

  // Find groups matching criteria
  let groups = [];
  try {
    groups = await Group.find(groupFindCriteria); // empty object will find all groups

    if (!groups || groups.length === 0) {
      console.error(
        `GroupsIAmIn: No groups found for user "${username}". ` +
          `Criteria used:`,
        JSON.stringify(groupFindCriteria, null, 2),
      );

      if (user.memberOf && user.memberOf.length) {
        console.error(`GroupsIAmIn: User's LDAP groups:`, user.memberOf);

        // Check which LDAP groups exist in database
        const allGroups = await Group.find({}, { name: 1, ldapGroups: 1 });
        const matchingLdapGroups = allGroups.filter((group) =>
          group.ldapGroups.some((ldap) => user.memberOf.includes(ldap)),
        );

        if (matchingLdapGroups.length === 0) {
          console.error(
            `GroupsIAmIn: None of the user's LDAP groups match any groups in the database.`,
          );
        } else {
          console.error(
            `GroupsIAmIn: Found ${matchingLdapGroups.length} matching LDAP groups:`,
            matchingLdapGroups.map((g) => ({
              name: g.name,
              ldapGroups: g.ldapGroups,
            })),
          );
        }
      }
    } else {
      // console.log(
      //   `GroupsIAmIn: Found ${groups.length} group(s) for user "${username}":`,
      //   groups.map((g) => ({ name: g.name, ldapGroups: g.ldapGroups })),
      // );
    }
  } catch (error) {
    console.error(
      `GroupsIAmIn: Database error while finding groups for user "${username}":`,
      error,
    );
    throw error;
  }

  return groups;
};

const Group = mongoose.model("Group", schema);

module.exports = Group;
