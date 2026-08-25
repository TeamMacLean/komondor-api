const mongoose = require("mongoose");
const express = require("express");

const { isAuthenticated, isAdmin } = require("./middleware");
const { handleError } = require("./_utils");

let router = express.Router();

const LibrarySelection = require("../models/options/LibrarySelection");
const LibrarySource = require("../models/options/LibrarySource");
const LibraryStrategy = require("../models/options/LibraryStrategy");
const LibraryType = require("../models/options/LibraryType");
const SequencingTechnology = require("../models/options/SequencingTechnology");

/**
 * Whether the gate on POST/DELETE for the option collections is active.
 * These vocabularies are global to every group, so writes are admin-only.
 * OPTIONS_WRITE_REQUIRE_AUTH="false" lifts the gate for local development and
 * is ignored in production. GET is public.
 * @returns {boolean} True when writes must be authenticated and admin.
 */
const writesAreGated = () =>
  process.env.NODE_ENV === "production" ||
  process.env.OPTIONS_WRITE_REQUIRE_AUTH !== "false";

const requireAdminForWrites = (req, res, next) => {
  if (!writesAreGated()) {
    return next();
  }
  // isAuthenticated first so an anonymous caller gets 401, not a confusing 403.
  return isAuthenticated(req, res, () => isAdmin(req, res, next));
};

/**
 * True when `value` is an array and every element of it is a string.
 * @param {*} value - Candidate value from a request body.
 * @returns {boolean} True if `value` is a string array.
 */
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Registers the GET/POST/DELETE trio for one option collection.
 * @param {string} path - The route path.
 * @param {object} Model - Mongoose model backing this option type.
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
    .post(requireAdminForWrites, async (req, res) => {
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
    .delete(requireAdminForWrites, async (req, res) => {
      const { id } = req.body || {};

      // Mongoose strips undefined from a filter, so deleteOne({ _id: undefined })
      // becomes deleteOne({}) and removes an arbitrary document.
      if (!id) {
        return handleError(res, new Error('"id" is required'), 400);
      }

      // The string check is not redundant with isValid: `{ $ne: null }` is read
      // as a query condition, not a cast failure.
      if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
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
// Narrowed, not passed through: mongoose's Boolean cast accepts "yes"/0/1, and
// a bare string lands in a [String] field as a one-element array.
registerOptionRoutes("/options/librarytype", LibraryType, (body) => ({
  value: body.value,
  paired: body.paired === true,
  extensions: isStringArray(body.extensions) ? body.extensions : [],
}));
registerOptionRoutes("/options/sequencingtechnology", SequencingTechnology);

module.exports = router;
