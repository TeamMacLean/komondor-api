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

schema.pre("validate", function () {
  return Group.find({})
    .then((allOthers) => {
      allOthers.filter((f) => f._id.toString() === this._id.toString());

      return generateSafeName(
        this.name,
        allOthers.filter((f) => f._id.toString() !== this._id.toString()),
      );
    })
    .then((safeName) => {
      this.safeName = safeName;

      return Promise.resolve();
    });
});

schema.post("save", function () {
  const absDestPath = _path.join(process.env.DATASTORE_ROOT, this.safeName);

  fs.promises
    .access(absDestPath)
    .then(() => {
      //console.log(`Directory already exists for ${this.name}. Skipping.`)
    })
    .catch(() => {
      try {
        return fs.promises.mkdir(absDestPath).then(() => {
          console.log(
            "Directory for " + this.name + " did not exist, so now created!",
          );
          return Promise.resolve();
        });
      } catch (e) {
        console.log("Error creating directory. Please create yourself.", e);

        return Promise.resolve();
      }
    });
});

schema.statics.GroupsIAmIn = async function GroupsIAmIn(user) {
  const allGroupsFilter = {};

  console.log("debug user attempt to login:", user);

  // debug by changing these
  let userIsAdmin = user.isAdmin;
  let fullAccessUsers = FULL_RECORDS_ACCESS_USERS;
  // let userIsAdmin = false;
  // let fullAccessUsers = [];

  var groupFindCriteria;
  if (userIsAdmin) {
    console.log("user is admin");
    groupFindCriteria = allGroupsFilter;
  } else if (
    fullAccessUsers &&
    fullAccessUsers.length &&
    user &&
    user.username &&
    fullAccessUsers.includes(user.username)
  ) {
    console.log("user is full access");
    groupFindCriteria = allGroupsFilter;
  } else if (user.groups && user.groups.length) {
    console.log("user has group assigned already");
    groupFindCriteria = {
      _id: { $in: user.groups },
    };
  } else if (user.memberOf && user.memberOf.length) {
    console.log("user has ldap strings to go after");
    // BEST FOR DEBUGGING USER'S GROUPS LDAP

    const groupLdapStrings = user.memberOf;
    // debug here by only having one group (good for testing me/admin only)
    // const groupLdapStrings = user.memberOf.splice(0, 1);
    // groupLdapStrings.push(
    //   "CN=TSL-Data-Bioinformatics,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
    // );

    const filters = groupLdapStrings.map((g) => ({
      ldapGroups: g,
    }));
    console.log("filters", filters);
    groupFindCriteria = { $or: filters };
  } else {
    console.error(
      "No criteria if statement activated for groupfind...",
      user.username,
    );
  }
  // HACK here if necessary
  if (user.username === "ges23jir") {
    return await Group.find({ name: "ntalbot" });
  }

  if (!groupFindCriteria) {
    throw new Error("No groupfind criteria for user found", user.username);
  }
  const result = await Group.find(groupFindCriteria);

  if (!result.length) {
    console.error(
      "No groups found for user",
      user,
      new Date().format("DD-MM-YYYY HH:mm:ss"),
    );
  }

  // simple name and ldapStrings output
  const debugOutput = result.map((g) => {
    return {
      name: g.name,
      ldapGroups: g.ldapGroups,
    };
  });
  console.log("debugOutput user and groups", user.username, debugOutput);

  // HACK here if necessary
  if (user.username === "ges23jir") {
    return await Group.find({ name: "ntalbot" });
  }

  return result;
};

const Group = mongoose.model("Group", schema);

module.exports = Group;
