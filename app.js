const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const authRoutes = require("./routes/auth");
const projectsRoutes = require("./routes/projects");
const samplesRoutes = require("./routes/samples");
const runRoutes = require("./routes/runs");
const searchRoutes = require("./routes/search");
const groupRoutes = require("./routes/groups");
const directoryFilesRoutes = require("./routes/directory-files");
const userRoutes = require("./routes/users");
const accessionRoutes = require("./routes/accessions");
const newsRoutes = require("./routes/news");
const uploadRoutes = require("./routes/uploads");
const optionRoutes = require("./routes/options");
const testRoutes = require("./routes/test");
const getUserFromRequest = require("./lib/utils/getUserFromRequest");

const app = express();

const HEADERS = [
  "Authorization",
  "Content-Type",
  "Location",
  "Tus-Extension",
  "Tus-Max-Size",
  "Tus-Resumable",
  "Tus-Version",
  "Upload-Defer-Length",
  "Upload-Length",
  "Upload-Metadata",
  "Upload-Offset",
  "X-HTTP-Method-Override",
  "X-Requested-With",
];
const EXPOSED_HEADERS = HEADERS.join(", ");
var corsOptions = {
  //origin: process.env.WEB_APP_URL,
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200,
  exposedHeaders: EXPOSED_HEADERS,
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/**
 * get user if auth token in request
 */
app.use((req, _, next) => {
  getUserFromRequest(req)
    .then((user) => {
      if (user) {
        req.user = user;
      }
      next();
    })
    .catch((err) => {
      next(err);
    });
});

app.use(authRoutes);
app.use(projectsRoutes);
app.use(samplesRoutes);
app.use(runRoutes);
app.use(searchRoutes);
app.use(groupRoutes);
app.use(directoryFilesRoutes);
app.use(userRoutes);
app.use(accessionRoutes);
app.use(newsRoutes);
app.use(optionRoutes);
app.use(uploadRoutes);
app.use(testRoutes);

module.exports = app;
