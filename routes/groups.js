const { isAuthenticated } = require("./middleware")

const express = require("express")
let router = express.Router();
const Group = require('../models/Group')

router
  .route('/groups')
  .all(isAuthenticated)
  .get((req, res) => {

    Group.GroupsIAmIn(req.user)
      .then(groups => {
        res.status(200).send({ groups })
      })
      .catch(err => {
        res.status(500).send({ error: err })
      });

  });

router
  .route('/groups/new')
  .all(isAuthenticated)
  .post((req, res) => {


    //TODO check permission

    new Group({
      name: req.body.name,
      ldapGroups: req.body.ldapGroups
    })
      .save()
      .then(savedGroup => {
        res.status(200).send({ group: savedGroup })
      })
      .catch(err => {
        console.error(err);
        res.status(500).send({ error: err })
      })

  });

router.route('/groups/edit')
  .all(isAuthenticated)
  .post((req, res) => {
    if (req.body.id) {


      //TODO check permission
      Group.findById(req.body.id)
        .then(group => {

          if (group) {

            group.ldapGroups = req.body.ldapGroups;
            group.name = req.body.name;
             
            if (req.body.sendToEna) {
              group.sendToEna = req.body.sendToEna;
            }

            

            group.save()
              .then(savedGroup => {
                res.status(200).send({ group: savedGroup });
              })
              .catch(err => {
                console.error(err);
                res.status(500).send({ error: err })
              })

          } else {
            res.status(500).send({ error: new Error('group not found') })
          }

        })
        .catch(err => {
          res.status(500).send({ error: err })
        })

    }
  });

router.route('/groups/delete')
  .all(isAuthenticated)
  .post((req, res) => {

    if (req.user.isAdmin) {

      if (req.body.id) {

        Group.findById(req.body.id)
          .then((group) => {
            if (group) {
              group.deleted = true;

              group.save()
                .then(savedGroup => {
                  res.status(200).send({})
                })
                .catch(err => {
                  res.status(500).send({ error: err });
                })
            } else {
              res.status(500).send({ error: new Error('group not found') });
            }

          }).catch(err => {
            res.status(500).send({ error: err });
          })

      } else {
        res.status(500).send({ error: new Error('id not received') })
      }

    } else {
      res.status(500).send({ error: new Error('only an ADMIN can delete groups') })
    }


  });


router.route('/groups/resurrect')
  .all(isAuthenticated)
  .post((req, res) => {

    if (req.user.isAdmin) {

      if (req.body.id) {

        findById(req.body.id)
          .then((group) => {
            if (group) {
              group.deleted = false;

              group.save()
                .then(savedGroup => {
                  res.status(200).send({})
                })
                .catch(err => {
                  res.status(500).send({ error: err });
                })
            } else {
              res.status(500).send({ error: new Error('group not found') });
            }

          }).catch(err => {
            res.status(500).send({ error: err });
          })

      } else {
        res.status(500).send({ error: new Error('id not received') })
      }

    } else {
      res.status(500).send({ error: new Error('only an ADMIN can resurrect groups') })
    }


  });
  module.exports =  router;
