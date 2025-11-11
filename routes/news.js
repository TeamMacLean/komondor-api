const { isAuthenticated } =require( "./middleware")
const express =require( "express")
let router = express.Router();
const NewsItem =require( '../models/NewsItem')

// Native replacement for moment().calendar()
function formatDateCalendar(date) {
    const now = new Date();
    const dateObj = new Date(date);
    const diffMs = now - dateObj;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (diffDays === 0) {
        return `Today at ${timeStr}`;
    } else if (diffDays === 1) {
        return `Yesterday at ${timeStr}`;
    } else if (diffDays < 7) {
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        return `Last ${dayName} at ${timeStr}`;
    } else {
        return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ` at ${timeStr}`;
    }
}


router.route('/news')
    .all(isAuthenticated)
    .get((req, res) => {

        if (req.user) {

            NewsItem.iCanSee(req.user)
                .sort('-createdAt')
                .limit(20)
                .then(news => {

                    news = news.map(ni => {
                        return {
                            type: ni.type,
                            user: ni.owner,
                            name: ni.name,
                            body: ni.body,
                            date: ni.createdAt,
                            dateHuman: formatDateCalendar(ni.createdAt),
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

    module.exports =   router;
