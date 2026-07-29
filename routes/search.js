const { isAuthenticated } = require("./middleware");

const express = require("express");
let router = express.Router();

const Project = require("../models/Project");
const Sample = require("../models/Sample");
const Run = require("../models/Run");

// Upper bound on a search term. Long terms produce pathological regexes and
// have no legitimate use against entity names.
const MAX_QUERY_LENGTH = 200;

/**
 * Escapes regex metacharacters so a user's search term is matched literally.
 * Without this, a query of "(" produces an invalid regex and a 500.
 * @param {string} value - The raw search term.
 * @returns {string} The escaped term.
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalises the `query` parameter, which may arrive repeated (`?query=a&query=b`)
 * and therefore as an array.
 * @param {*} raw - The raw req.query.query value.
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
 * Runs a case-insensitive substring search over the names of the records a user
 * may see.
 *
 * The match is performed in MongoDB rather than in JavaScript. The previous
 * implementation loaded every visible record into memory and then compared
 * `name.toLowerCase().includes(query)` against the *raw* query, so any search
 * term containing an uppercase letter could never match.
 *
 * @param {object} Model - A mongoose model exposing the `iCanSee` static.
 * @param {object} user - The authenticated user.
 * @param {string} query - The normalised search term.
 * @returns {Promise<Array>} The matching documents.
 */
const searchByName = (Model, user, query) => {
  return Model.iCanSee(user)
    .where("name")
    .regex(new RegExp(escapeRegex(query), "i"))
    .populate("group")
    .exec();
};

const searchProjects = (user, query) => searchByName(Project, user, query);
const searchSamples = (user, query) => searchByName(Sample, user, query);
const searchRuns = (user, query) => searchByName(Run, user, query);

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
 *
 * These endpoints answer 200 with an empty result set when the search fails,
 * which is the contract existing consumers rely on. An `error` field is added
 * alongside so a failure is still diagnosable rather than silently empty.
 *
 * @param {string} path - The route path.
 * @param {Function} searchFn - The search function for this entity type.
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
