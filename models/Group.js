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
    console.error("[AUTH] GroupsIAmIn called with no user");
    throw new Error("User object is required");
  }

  // Detect username from various possible properties
  const username =
    user.sAMAccountName || user.uid || user.mailNickname || "unknown";

  // Parse full access users from environment variable
  let fullAccessUsers = [];
  if (FULL_RECORDS_ACCESS_USERS) {
    try {
      fullAccessUsers = JSON.parse(FULL_RECORDS_ACCESS_USERS);
    } catch (e) {
      fullAccessUsers = FULL_RECORDS_ACCESS_USERS.split(",").map((u) =>
        u.trim(),
      );
    }
  }

  let groupFindCriteria = null;

  // Determine group find criteria based on user permissions
  if (user.isAdmin) {
    groupFindCriteria = {};
  } else if (fullAccessUsers.length && fullAccessUsers.includes(username)) {
    groupFindCriteria = {};
  } else if (user.groups && user.groups.length) {
    groupFindCriteria = {
      _id: { $in: user.groups },
    };
  } else if (user.memberOf && user.memberOf.length) {
    const filters = user.memberOf.map((ldapString) => ({
      ldapGroups: ldapString,
    }));

    groupFindCriteria = { $or: filters };
  } else {
    console.error(
      `[AUTH] No group criteria for user "${username}" | isAdmin: ${user.isAdmin}, groups: ${JSON.stringify(user.groups)}, memberOf: ${JSON.stringify(user.memberOf)}`,
    );
  }

  // Find groups matching criteria
  let groups = [];
  try {
    groups = await Group.find(groupFindCriteria);

    if (!groups || groups.length === 0) {
      const ldapInfo = user.memberOf?.length
        ? ` | LDAP memberOf: [${user.memberOf.join(", ")}]`
        : "";
      console.error(
        `[AUTH] No groups found for user "${username}" | Criteria: ${JSON.stringify(groupFindCriteria)}${ldapInfo}`,
      );
    }
  } catch (error) {
    console.error(
      `[AUTH] DB error finding groups for user "${username}":`,
      error,
    );
    throw error;
  }

  return groups;
};

const Group = mongoose.model("Group", schema);

module.exports = Group;
