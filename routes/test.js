const express = require("express")
let router = express.Router();

router.route('/test')
    .get((req, res) => {
        res.status(200).send({ message: "Hello there, good sir! Use yarn!" })
    });

module.exports = router;
