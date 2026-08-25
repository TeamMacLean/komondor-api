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
 *
 * These are *global* controlled vocabularies: one list of library types, of
 * sequencing technologies and so on, shared by every group. A bad entry — or a
 * deletion — is visible to everybody and changes what every future run may be
 * described as, so adding and removing them is an administrative act rather
 * than an ordinary user's. komondor-web agrees: the controls live only on the
 * admin screen, behind its `admin` middleware. The gate is therefore isAdmin,
 * not merely "presented a valid token".
 *
 * OPTIONS_WRITE_REQUIRE_AUTH="false" still lifts the gate for local
 * development, but it is ignored when NODE_ENV is production. A setting whose
 * only effect is to open a shared vocabulary to anonymous writes should not be
 * one line in a deployment .env away from being switched on by accident.
 *
 * GET remains public, as before.
 *
 * @returns {boolean} True when writes must be authenticated and admin.
 */
const writesAreGated = () =>
  process.env.NODE_ENV === "production" ||
  process.env.OPTIONS_WRITE_REQUIRE_AUTH !== "false";

const requireAdminForWrites = (req, res, next) => {
  if (!writesAreGated()) {
    return next();
  }
  // isAuthenticated first so an anonymous caller gets 401 rather than the 403
  // isAdmin would give them, which reads as "log in as someone else".
  return isAuthenticated(req, res, () => isAdmin(req, res, next));
};

/**
 * True when `value` is an array and every element of it is a string.
 *
 * @param {*} value - The candidate value from a request body.
 * @returns {boolean} True if `value` is a string array.
 */
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

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

      // Guard hard against a missing id. Mongoose strips undefined values from
      // a filter, so `deleteOne({ _id: undefined })` becomes `deleteOne({})`
      // and removes an arbitrary document from the collection.
      if (!id) {
        return handleError(res, new Error('"id" is required'), 400);
      }

      // The string check is not redundant with isValid: an id of
      // `{ $ne: null }` is read by mongoose as a query condition rather than a
      // cast failure, and deletes the first document whose _id is not null.
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
// `paired` and `extensions` go straight from the request body into a mongoose
// document, so they are narrowed rather than passed through: mongoose's Boolean
// cast accepts "yes"/"no"/0/1, and a bare string lands in a [String] field as a
// one-element array. komondor-web sends a real checkbox and a real tag list.
registerOptionRoutes("/options/librarytype", LibraryType, (body) => ({
  value: body.value,
  paired: body.paired === true,
  extensions: isStringArray(body.extensions) ? body.extensions : [],
}));
registerOptionRoutes("/options/sequencingtechnology", SequencingTechnology);

module.exports = router;
