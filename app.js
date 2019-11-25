import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import projectsRoutes from "./routes/projects";
import samplesRoutes from "./routes/samples";
import searchRoutes from "./routes/search";
import groupRoutes from "./routes/groups";
import userRoutes from "./routes/users";
import newsRoutes from "./routes/news";
import uploadRoutes from "./routes/uploads";
import { getUserFromRequest } from "./utils";

const app = express();
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// app.use((req, res, next) => {
//     console.log(req.method, req.url);
//     next();
// });

/**
 * get user if auth token in request
 */
app.use((req, res, next) => {
  getUserFromRequest(req)
    .then(user => {
      if (user) {
        req.user = user;
      }
      next();
    })
    .catch(err => {
      next(err);
    });
});

app.use(authRoutes);
app.use(projectsRoutes);
app.use(samplesRoutes);
app.use(searchRoutes);
app.use(groupRoutes);
app.use(userRoutes);
app.use(newsRoutes);
app.use(uploadRoutes);

export default app;
