const { isAuthenticated } = require("./middleware");

const express = require("express");
let router = express.Router();

const Project = require("../models/Project");
const Sample = require("../models/Sample");
const Run = require("../models/Run");
const { visibleGroupIds } = require("../lib/utils/fullAccessUsers");
const { attachProjectStorage } = require("../lib/storage-state");

// Upper bound on a search term: long terms produce pathological regexes.
const MAX_QUERY_LENGTH = 200;

/**
 * Escapes regex metacharacters so a user's search term is matched literally.
 * Without this, a query of "(" produces an invalid regex and a 500.
 * @param {string} value - The raw search term.
 * @returns {string} The escaped term.
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalises the `query` parameter, which arrives as an array when repeated.
 * @param {*} raw - Raw req.query.query value.
 * @returns {string|null} A usable search term, or null when unusable.
 */
const normaliseQuery = (raw) => {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_QUERY_LENGTH) {
    return null;
  }

  return trimmed;
};

/**
 * Case-insensitive substring search over the names of records a user may see.
 * @param {object} Model - A mongoose model exposing the `iCanSee` static.
 * @param {object} user - Authenticated user.
 * @param {string} query - Normalised search term.
 * @returns {Promise<Array>} The matching documents.
 */
const searchByName = async (Model, user, query) => {
  // Live group ids, not the token's claim — see routes/projects.js.
  const groupIds = await visibleGroupIds(user);

  return Model.iCanSee(user, groupIds)
    .where("name")
    .regex(new RegExp(escapeRegex(query), "i"))
    .populate("group")
    .exec();
};

const searchProjects = (user, query) => searchByName(Project, user, query);
const searchSamples = async (user, query) => {
  const samples = await searchByName(Sample, user, query);
  await attachProjectStorage(samples, { via: "project" });
  return samples;
};
const searchRuns = async (user, query) => {
  const runs = await searchByName(Run, user, query);
  await attachProjectStorage(runs, { via: "sample" });
  return runs;
};

router
  .route("/search")
  .all(isAuthenticated)
  .get(async (req, res) => {
    const query = normaliseQuery(req.query.query);

    if (!query) {
      return res.status(200).send({ results: [] });
    }

    try {
      const [projects, samples, runs] = await Promise.all([
        searchProjects(req.user, query),
        searchSamples(req.user, query),
        searchRuns(req.user, query),
      ]);

      res.status(200).send({ results: { projects, samples, runs } });
    } catch (err) {
      console.error("[search] Combined search failed:", err);
      res.status(500).send({ error: err.message || "Search failed" });
    }
  });

/**
 * Builds a single-entity search route.
 * Answers 200 with an empty result set on failure — the contract existing
 * consumers rely on — plus an `error` field so the failure stays diagnosable.
 * @param {string} path - The route path.
 * @param {Function} searchFn - Search function for this entity type.
 */
const registerEntitySearch = (path, searchFn) => {
  router
    .route(path)
    .all(isAuthenticated)
    .get(async (req, res) => {
      const query = normaliseQuery(req.query.query);

      if (!query) {
        return res.status(200).send({ results: [] });
      }

      try {
        const results = await searchFn(req.user, query);
        res.status(200).send({ results });
      } catch (err) {
        console.error(`[search] ${path} failed:`, err);
        res
          .status(200)
          .send({ results: [], error: err.message || "Search failed" });
      }
    });
};

registerEntitySearch("/search/project", searchProjects);
registerEntitySearch("/search/sample", searchSamples);
registerEntitySearch("/search/run", searchRuns);

module.exports = router;
