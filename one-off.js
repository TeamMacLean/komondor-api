const mongoose = require("mongoose");
const Sample = require("./models/Sample"); // Update the path as necessary

mongoose
  .connect("mongodb://localhost:27017/komondor", {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    //console.log("Connected to MongoDB");

    // Your query
    // Sample.findOne({}, "_id safeName", { sort: { createdAt: -1 } }) // Sorting by createdAt in descending order

    Sample.find(
      { path: "/maw/srna_sequencing_in_soybean/ev" },
      "_id safeName",
      { sort: { createdAt: -1 } }
    )

      .then((result) => {
        console.log(result);
        mongoose.disconnect(); // Disconnect after the operation is complete
      })
      .catch((err) => {
        console.error(err);
        mongoose.disconnect();
      });
  })
  .catch((err) => {
    console.error("Connection error", err);
  });
