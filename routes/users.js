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

router
    .route('/user')
    .all(isAuthenticated)
    .get((req, res) => {

        if (!req.query.username) {
            res.status(500).send({error: new Error('"username" param required')})
        }

        const targetFunction = new Promise(async (resolve, _) => {
            let foundProjects = await Project.find({owner: req.query.username})
            let foundUser = await User.findOne({username: req.query.username})
            
            resolve({
                user: {
                    ...foundUser,
                    username: req.query.username,
                    projects: foundProjects,
                }
            });
        });            
        async function executeExternalFunctionAndExit(promiseFunction) {
            let result = await promiseFunction;
            //console.log('about to send result', result)
            res.status(200).send(result)             
        }
        executeExternalFunctionAndExit(targetFunction);
    });

module.exports =  router;
