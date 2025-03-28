const app = require("./app");
const mongoose = require("mongoose");
const PORT = process.env.PORT || 3000;
const moongoosePort = process.env.MONGODB_PORT || 27017;

try {
  // will create database if it can't see one

  // martin doesn't expose mongodb outside of the web server; you'd never want to make that available
  // otherwise people could brute force attack
  // even if you tried to do this, the server would probably complain
  // you probably dont want to tinker the live db, just the local db (e.g. modify a model file)

  mongoose.connect(`mongodb://localhost:${mongoosePort}/komondor`, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000 // 10 seconds
  }).then(() => {
    console.log('Connected to MongoDB');
  }).catch(err => {
    console.error('Error connecting to MongoDB', err);
  });
} catch (err) {
  console.error('Unexpected error:', err);
}

app.listen(PORT, () => console.log(`API running on port ${PORT}!`));
