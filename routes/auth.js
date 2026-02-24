//AUTH
const { authenticate } = require("../lib/ldap");
const express = require("express");
let router = express.Router();

const getUserFromRequest = require("../lib/utils/getUserFromRequest");
const sign = require("../lib/utils/jwtSign");
const getUserForToken = require("../lib/utils/getUserForToken");
const User = require("../models/User");

// Development mode user list - only used when NODE_ENV is 'development'
const DEV_USERS = [
  {
    username: "testadmin",
    password: "testpass",
    name: "Test Admin",
    company: "Test Company",
    email: "testadmin@example.org",
    isAdmin: true,
    groups: [],
  },
  {
    username: "testuser",
    password: "testpass",
    name: "Test User",
    company: "Test Company",
    email: "testuser@example.org",
    isAdmin: false,
    groups: [],
  },
];

router.get("/me", (req, res, next) => {
  getUserFromRequest(req)
    .then((user) => {
      res.status(200).json({ user: user });
    })
    .catch((err) => {
      res.status(500).json({ error: err });
    });
});

function updateDB(user) {
  User.findOne({ username: user.username })
    .then((foundUser) => {
      if (foundUser) {
        foundUser.notifyLogin();
      } else {
        new User({
          username: user.username,
          name: user.name,
          company: user.company,
          email: user.email,
          isAdmin: user.username === "admin",
        }).save();
      }
    })
    .catch((err) => {
      console.error("[AUTH] Failed to update DB on login:", err);
    });
}

function signAndReturn(userTokenObject, res) {
  sign(userTokenObject)
    .then((token) => {
      res.status(200).json({ token: token });
      updateDB(userTokenObject);
    })
    .catch((err) => {
      console.error("[AUTH] Failed to sign JWT:", err);
      res.status(500).json({ error: err });
    });
}

// Add POST - /api/login
router.post("/login", (req, res, next) => {
  if (req.body && req.body.username && req.body.password) {
    //TODO check if local admin
    if (
      req.body.username === "admin" &&
      req.body.password === process.env.ADMIN_PASSWORD
    ) {
      console.log(
        `[LOGIN] User "admin" logged in | Groups: [all - admin] | Admin: true`,
      );
      signAndReturn(
        {
          username: "admin",
          name: "Admin",
          company: "admins",
          email: "admin@example.org",
          isAdmin: true,
          groups: [],
        },
        res,
      );
    } else if (process.env.NODE_ENV === "development") {
      // Check against dev users list in development mode
      const devUser = DEV_USERS.find(
        (user) =>
          user.username === req.body.username &&
          user.password === req.body.password,
      );

      if (devUser) {
        console.log(
          `[LOGIN] User "${devUser.username}" logged in (dev mode) | Groups: [${(devUser.groups || []).join(", ")}] | Admin: ${!!devUser.isAdmin}`,
        );
        signAndReturn(
          {
            username: devUser.username,
            name: devUser.name,
            company: devUser.company,
            email: devUser.email,
            isAdmin: devUser.isAdmin,
            groups: devUser.groups,
          },
          res,
        );
      } else {
        // Fall through to LDAP authentication in development mode
        authenticate(req.body.username, req.body.password)
          .then((user) => {
            getUserForToken(user).then((userTokenObject) => {
              signAndReturn(userTokenObject, res);
            });
          })
          .catch((err) => {
            console.error(
              `[LOGIN_FAILED] User "${req.body.username}" failed to authenticate (dev mode, LDAP fallback): ${err.message || err}`,
            );
            res.status(401).json({ message: "Bad credentials" });
          });
      }
    } else {
      authenticate(req.body.username, req.body.password)
        .then((user) => {
          getUserForToken(user).then((userTokenObject) => {
            signAndReturn(userTokenObject, res);
          });
        })
        .catch((err) => {
          console.error(
            `[LOGIN_FAILED] User "${req.body.username}" failed to authenticate: ${err.message || err}`,
          );
          res.status(401).json({ message: "Bad credentials" });
        });
    }
  } else {
    res.status(401).json({ message: "Bad credentials" });
  }
});

router.get("/logout", (req, res, next) => {
  res.sendStatus(200);
});
router.post("/logout", (err, req, res, next) => {
  res.sendStatus(200);
});

module.exports = router;
