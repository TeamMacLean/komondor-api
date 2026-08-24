const mongoose = require("mongoose");
const generateSafeName = require("../lib/utils/generateSafeName").default;
const _path = require("path");
const fs = require("fs");
const { getFullAccessUsers } = require("../lib/utils/fullAccessUsers");

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
    user.username || user.sAMAccountName || user.uid || user.mailNickname || "unknown";

  const fullAccessUsers = getFullAccessUsers();

  // LDAP returns multi-valued attributes as arrays but single-valued ones as
  // plain strings, so a user in exactly one group arrives with a string
  // memberOf. Some directories also name the attribute "memberof". Normalise
  // to an array before deciding which criteria apply.
  const rawMemberOf = user.memberOf != null ? user.memberOf : user.memberof;
  let memberOf = [];
  if (Array.isArray(rawMemberOf)) {
    memberOf = rawMemberOf;
  } else if (rawMemberOf) {
    memberOf = [rawMemberOf];
  }

  let groupFindCriteria;

  // Determine group find criteria based on user permissions
  if (user.isAdmin) {
    groupFindCriteria = {};
  } else if (fullAccessUsers.includes(username)) {
    groupFindCriteria = {};
  } else if (user.groups && user.groups.length) {
    groupFindCriteria = {
      _id: { $in: user.groups },
    };
  } else if (memberOf.length) {
    const filters = memberOf.map((ldapString) => ({
      ldapGroups: {
        $regex: new RegExp(
          "^" + ldapString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
          "i",
        ),
      },
    }));

    groupFindCriteria = { $or: filters };
  } else {
    // No admin flag, no group IDs and no LDAP memberOf: the user belongs to
    // nothing. Returning early matters — `Group.find(null)` is treated by
    // mongoose as an empty filter and would hand back *every* group.
    console.error(
      `[AUTH] No group criteria for user "${username}" | isAdmin: ${user.isAdmin}, groups: ${JSON.stringify(user.groups)}, memberOf: ${JSON.stringify(rawMemberOf)}`,
    );
    return [];
  }

  // Find groups matching criteria
  let groups = [];
  try {
    groups = await Group.find(groupFindCriteria);

    if (!groups || groups.length === 0) {
      const ldapInfo = memberOf.length
        ? ` | LDAP memberOf: [${memberOf.join(", ")}]`
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
