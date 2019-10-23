//AUTH
const ldap = require('../ldap');
const jwt = require("jsonwebtoken");
const express = require('express');
const router = express.Router();
const Utils = require('../utils');
const User = require('../models/User');
const Group = require('../models/Group');


const JWT_SECRET = process.env.JWT_SECRET;
const groupRequirement = process.env.LDAP_MUST_BE_MEMBER_OF;

async function sign(user) {
    return jwt.sign(user, JWT_SECRET)
}


router.get('/me', (req, res, next) => {
    Utils.getUserFromRequest(req)
        .then(user => {
            res.status(200).json({user: user})
        })
        .catch(err => {
            res.status(500).json({error: err})
        })
});

function getUserForToken(user) {

    return new Promise((good, bad) => {


        let fullName = user.displayName;
        if (user.givenName && user.sn) {
            fullName = user.givenName + ' ' + user.sn;
        }

        let email = user.mail;
        if (email) {
            email = email.toLowerCase();
        }

        const isAdmin = user.username === 'admin';

        // const groupsIDS = [];

        Group.GroupsIAmIn({memberOf: user.memberOf, isAdmin})
            .then(groups => {
                const groupIDS = groups.map(g => g.id);

                return good({
                    username: user.uid,
                    name: fullName,
                    company: user.company,
                    email: email,
                    groups: groupIDS,
                    // icon: User.GetIcon(user.username)
                });
            })
            .catch(err => {
                return bad(err);
            })


        //   // const groups = user.memberOf || [];
        //   const groups = [];
        //
        //   //TODO match groups
        //
        //
        //   Group.GroupsIAmIn({
        //     isAdmin: user.username === 'admin',
        //     memberOf: user.memberOf
        //   });
        //
        //   Group.find({})
        //     .then(foundGroups => {
        //
        //       const groups = [];
        //       if (user.memberOf) {
        //         user.memberOf.map(mo => {
        //           foundGroups.map(fg => {
        //             if (fg.ldapGroups.indexOf(mo) > -1) {
        //               groups.push(fg._id);
        //             }
        //           })
        //         })
        //       }
        //
        //       return good({username: user.uid, name: fullName, company: user.company, email: email, groups: groups});
        //     })
        //     .catch(err => {
        //       console.error(err);
        //       return good({username: user.uid, name: fullName, company: user.company, email: email, groups: []});
        //
        //     });
        //
        //
    })
}

function updateDB(user) {
    User.findOne({username: user.username})
        .then(foundUser => {

            if (foundUser) {
                foundUser.notifyLogin();
            } else {
                new User({
                    username: user.username,
                    name: user.name,
                    company: user.company,
                    email: user.email,
                    isAdmin: user.username === 'admin'
                })
                    .save()
            }

        })
        .catch(err => {
            console.error(err);
        })
}

function signAndReturn(userTokenObject, res) {


    sign(userTokenObject)
        .then(token => {
            res.status(200).json({token: token});
            updateDB(userTokenObject);
        })
        .catch(err => {
            console.error(err);
            res.status(500).json({error: err})
        })
}

// Add POST - /api/login
router.post('/login', (req, res, next) => {

    if (req.body && req.body.username && req.body.password) {

        //TODO check if local admin
        if (req.body.username === 'admin' && req.body.password === process.env.ADMIN_PASSWORD) {
            signAndReturn({
                username: 'admin',
                name: 'Admin',
                company: 'admins',
                email: 'admin@example.org',
                isAdmin: true,
                groups: []
            }, res);
        } else {
            ldap.authenticate(req.body.username, req.body.password)
                .then(user => {
                    getUserForToken(user)
                        .then(userTokenObject => {
                            signAndReturn(userTokenObject, res);
                        })
                })
                .catch(err => {
                    console.log(err);
                    res.status(401).json({message: 'Bad credentials'})
                });
        }
    } else {
        console.log(req.body);
        console.log('Bad credentials');
        res.status(401).json({message: 'Bad credentials'})
    }
});

router.get('/logout', (req, res, next) => {
    res.sendStatus(200)
});
router.post('/logout', (err, req, res, next) => {
    res.sendStatus(200)
});


module.exports =  router;

