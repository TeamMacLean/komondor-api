const app = require('./app')
const mongoose = require('mongoose')
const PORT = process.env.PORT;

try {
    mongoose.connect('mongodb://localhost:27017/komondor', { useNewUrlParser: true });
} catch (err) {
    console.error(err);
}

app.listen(PORT, () => console.log(`API running on port ${PORT}!`));