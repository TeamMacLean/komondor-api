const mongoose = require("mongoose");
const express = require("express");

const { isAuthenticated } = require("./middleware");
const { handleError } = require("./_utils");

let router = express.Router();

const LibrarySelection = require("../models/options/LibrarySelection");
const LibrarySource = require("../models/options/LibrarySource");
const LibraryStrategy = require("../models/options/LibraryStrategy");
const LibraryType = require("../models/options/LibraryType");
const SequencingTechnology = require("../models/options/SequencingTechnology");

/**
 * Whether POST/DELETE on the option collections require a valid token.
 *
 * BREAKING CHANGE (defaults to enabled): these routes were previously
 * unauthenticated, so any caller could add or remove controlled-vocabulary
 * entries. Set OPTIONS_WRITE_REQUIRE_AUTH="false" to restore the old behaviour
 * if a consuming service turns out to write to them without a token.
 *
 * GET remains public, as before.
 */
const writeRequiresAuth = () =>
  process.env.OPTIONS_WRITE_REQUIRE_AUTH !== "false";

const requireAuthForWrites = (req, res, next) => {
  if (!writeRequiresAuth()) {
    return next();
  }
  return isAuthenticated(req, res, next);
};

/**
 * Registers the GET/POST/DELETE trio for one option collection.
 *
 * @param {string} path - The route path.
 * @param {object} Model - The mongoose model backing this option type.
 * @param {Function} [buildDoc] - Maps a request body to the document fields.
 */
const registerOptionRoutes = (path, Model, buildDoc) => {
  const toDocument = buildDoc || ((body) => ({ value: body.value }));

  router
    .route(path)
    .get(async (req, res) => {
      try {
        const options = await Model.find({}).sort({ value: 1 });
        res.status(200).send({ options });
      } catch (err) {
        handleError(res, err, 500, `Failed to retrieve options for ${path}.`);
      }
    })
    .post(requireAuthForWrites, async (req, res) => {
      const body = req.body || {};

      if (!body.value || typeof body.value !== "string" || !body.value.trim()) {
        return handleError(
          res,
          new Error('"value" is required and must be a non-empty string'),
          400,
        );
      }

      try {
        const savedDoc = await new Model(toDocument(body)).save();
        res.status(200).send({ doc: savedDoc });
      } catch (err) {
        const status = err.name === "ValidationError" ? 400 : 500;
        handleError(res, err, status, `Failed to create option for ${path}.`);
      }
    })
    .delete(requireAuthForWrites, async (req, res) => {
      const { id } = req.body || {};

      // Guard hard against a missing id. Mongoose strips undefined values from
      // a filter, so `deleteOne({ _id: undefined })` becomes `deleteOne({})`
      // and removes an arbitrary document from the collection.
      if (!id) {
        return handleError(res, new Error('"id" is required'), 400);
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return handleError(res, new Error('"id" is not a valid ID'), 400);
      }

      try {
        const result = await Model.deleteOne({ _id: id });

        if (result && result.deletedCount === 0) {
          return handleError(res, new Error("Option not found"), 404);
        }

        res.status(200).send({});
      } catch (err) {
        handleError(res, err, 500, `Failed to delete option for ${path}.`);
      }
    });
};

registerOptionRoutes("/options/libraryselection", LibrarySelection);
registerOptionRoutes("/options/librarysource", LibrarySource);
registerOptionRoutes("/options/librarystrategy", LibraryStrategy);
registerOptionRoutes("/options/librarytype", LibraryType, (body) => ({
  value: body.value,
  paired: body.paired || false,
  extensions: body.extensions || [],
}));
registerOptionRoutes("/options/sequencingtechnology", SequencingTechnology);

module.exports = router;
