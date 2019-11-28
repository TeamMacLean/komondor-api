import jwt from "jsonwebtoken";
import Group from "../models/Group";

const JWT_SECRET = process.env.JWT_SECRET;

export function _toSafeName(unsafeName) {
  return unsafeName
    .replace("&", "and")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
}

export function generateSafeName(name, list) {
  return new Promise((good, bad) => {
    const safeName = this._toSafeName(name);
    let canHave = false;
    let testName = safeName;
    let testCount = 1;

    const filter = function(res) {
      return res.safeName.toLowerCase() === testName.toLowerCase();
    };

    while (!canHave) {
      const dupes = list.filter(filter);

      if (dupes.length) {
        testCount += 1;
        testName = safeName + "_" + testCount;
      } else {
        canHave = true;
        good(testName);
      }
    }
  });
}

export function getUserFromRequest(req) {
  return new Promise((good, bad) => {
    const authorizationHeader = req.headers.authorization;
    if (
      authorizationHeader &&
      authorizationHeader.split(" ")[0] &&
      authorizationHeader.split(" ")[0].toLowerCase() === "bearer"
    ) {
      try {
        const decoded = jwt.verify(
          authorizationHeader.split(" ")[1],
          JWT_SECRET
        );
        good(decoded);
      } catch (err) {
        bad(err);
      }
    } else {
      good();
    }
  });
}

export function getUserForToken(user) {
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

    // const groupsIDS = [];

    Group.GroupsIAmIn({ memberOf: user.memberOf, isAdmin })
      .then(groups => {
        const groupIDS = groups.map(g => g.id);

        return good({
          username: user.username || user.uid,
          name: user.fullName || fullName,
          company: user.company,
          email: user.email || email,
          groups: groupIDS
          // icon: User.GetIcon(user.username)
        });
      })
      .catch(err => {
        return bad(err);
      });
  });
}
export async function sign(user) {
  return jwt.sign(user, JWT_SECRET);
}

