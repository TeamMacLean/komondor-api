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

schema.post("save", async function () {
  const absDestPath = _path.join(process.env.DATASTORE_ROOT, this.safeName);

  try {
    await fs.promises.access(absDestPath);
  } catch (accessError) {
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
 * All groups a user belongs to, for one capability.
 * Only `isAdmin` is broad enough to write everywhere; in "write" mode a
 * full-access user falls through to their real membership like anybody else.
 * @param {Object} user - User object with authentication details
 * @param {Object} [options] - Lookup options
 * @param {"read"|"write"} [options.mode="read"] - Capability being authorised
 * @param {boolean} [options.includeDeleted=false] - Include soft-deleted groups
 * @returns {Promise<Array>} Array of groups the user belongs to
 */
schema.statics.GroupsIAmIn = async function GroupsIAmIn(user, options) {
  if (!user) {
    console.error("[AUTH] GroupsIAmIn called with no user");
    throw new Error("User object is required");
  }

  const { mode = "read", includeDeleted = false } = options || {};

  // Throw on a typo: "read" is the permissive mode, so defaulting to it would
  // silently widen a write check.
  if (mode !== "read" && mode !== "write") {
    throw new Error(
      `GroupsIAmIn: unknown mode "${mode}" (expected "read" or "write")`,
    );
  }

  const username =
    user.username ||
    user.sAMAccountName ||
    user.uid ||
    user.mailNickname ||
    "unknown";

  const fullAccessUsers = getFullAccessUsers();

  // LDAP sends a single-valued memberOf as a plain string, and some directories
  // spell it "memberof"; normalise to an array before choosing criteria.
  const rawMemberOf = user.memberOf != null ? user.memberOf : user.memberof;
  let memberOf = [];
  if (Array.isArray(rawMemberOf)) {
    memberOf = rawMemberOf;
  } else if (rawMemberOf) {
    memberOf = [rawMemberOf];
  }

  let groupFindCriteria;

  if (user.isAdmin) {
    groupFindCriteria = {};
  } else if (mode === "read" && fullAccessUsers.includes(username)) {
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
    // Returns early: Group.find(null) is an empty filter and matches every group.
    console.error(
      `[AUTH] No group criteria for user "${username}" | mode: ${mode}, isAdmin: ${user.isAdmin}, groups: ${JSON.stringify(user.groups)}, memberOf: ${JSON.stringify(rawMemberOf)}`,
    );
    return [];
  }

  // A soft-deleted group authorises nobody, admins included. `$ne: true`, not
  // `false`, so documents written before the field existed still match.
  if (!includeDeleted) {
    groupFindCriteria = { ...groupFindCriteria, deleted: { $ne: true } };
  }

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
