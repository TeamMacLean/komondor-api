//AUTH
const { authenticate } = require("../ldap")
const express = require("express")
let router = express.Router();

const { getUserFromRequest, sign, getUserForToken } = require("../lib/utils")
const User = require("../models/User")

router.get("/me", (req, res, next) => {
  getUserFromRequest(req)
    .then(user => {
      res.status(200).json({ user: user });
    })
    .catch(err => {
      res.status(500).json({ error: err });
    });
});

function updateDB(user) {
  User.findOne({ username: user.username })
    .then(foundUser => {
      if (foundUser) {
        foundUser.notifyLogin();
      } else {
        new User({
          username: user.username,
          name: user.name,
          company: user.company,
          email: user.email,
          isAdmin: user.username === "admin"
        }).save();
      }
    })
    .catch(err => {
      console.error(err);
    });
}

function signAndReturn(userTokenObject, res) {
  sign(userTokenObject)
    .then(token => {
      res.status(200).json({ token: token });
      updateDB(userTokenObject);
    })
    .catch(err => {
      console.error(err);
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
      signAndReturn(
        {
          username: "admin",
          name: "Admin",
          company: "admins",
          email: "admin@example.org",
          isAdmin: true,
          groups: []
        },
        res
      );
    } else {
      authenticate(req.body.username, req.body.password)
        .then(user => {
          getUserForToken(user).then(userTokenObject => {
            signAndReturn(userTokenObject, res);
          });
        })
        .catch(err => {
          console.log(err);
          res.status(401).json({ message: "Bad credentials" });
        });
    }
  } else {
    console.log(req.body);
    console.log("Bad credentials");
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
