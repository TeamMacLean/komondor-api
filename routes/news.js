const Middleware = require("./middleware");

const express = require('express');
const router = express.Router();
const NewsItem = require('../models/NewsItem');
const moment = require('moment');


router.route('/news')
    .all(Middleware.isAuthenticated)
    .get((req, res) => {

        if (req.user) {

            NewsItem.iCanSee(req.user)
                .limit(20)
                .then(news => {

                    news.sort(function (a, b) {
                        return new Date(b.date) - new Date(a.date);
                    });

                    //TODO format the news

                    news = news.map(ni => {
                        return {
                            type: ni.type,
                            user: ni.owner,
                            title: 'created a new ' + ni.type,
                            name: ni.name,
                            body: ni.body,
                            date: ni.createdAt,
                            dateHuman: moment(ni.createdAt).calendar(),
                            link: {name: ni.type, query: {id: ni.typeId}}
                        }
                    });

                    res.status(200).send({news: news})
                })
                .catch(err => {
                    console.error(err);
                    res.status(500).send({error: new Error('could not get news')});
                });
            res.status(500)
        } else {
            res.status(500).send({error: new Error('could not get user from request')});
        }

    });

module.exports =  router;
