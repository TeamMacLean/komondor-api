const { isAuthenticated } =require( "./middleware")

const User =require( '../models/User')
const Project =require( '../models/Project')

const express =require( "express")
let router = express.Router();

router
    .route('/users')
    .all(isAuthenticated)
    .get((req, res) => {
        User.find({})
            .then(users => {
                res.status(200).send({users})
            })
            .catch(err => {
                res.status(500).send({error: err})
            });

    });

function getUsersProjects(user) {

    Project.find({owner: user.username})
        .then(projects => {
            //TODO filter what I can see

            user.projects = projects.filter(p => {
                //public //i am the owner //same i am in that group
                return (p.public || p.owner && p.owner === user.username || user.groups.indexOf(p.group) > -1);
            });
            Promise.resolve(user)
        })
}

router.route('/user')
    .all(isAuthenticated)
    .get((req, res) => {

        function promiseHandle(user) {
            if (req.body.projects) {
                return getUsersProjects(user)
            } else {
                return Promise.resolve(user)
            }
        }

        if (req.query.id || req.query.username) {

            if (req.query.id) {
                User.findOneById(req.query.id)
                    .then(promiseHandle)
                    .then(user => {
                        res.status(200).send({user})
                    })
                    .catch(err => res.status(500).send({error: err}));
            } else {
                User.findOne({username: req.query.username})
                    .then(promiseHandle)
                    .then(user => {
                        res.status(200).send({user})
                    })
                    .catch(err => res.status(500).send({error: err}));
            }


        } else {
            console.log('has not');
            res.status(500).send({error: new Error('user "id" or "username" param required')})
        }

    });
    module.exports =  router;
