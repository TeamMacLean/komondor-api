/**
 * Website visibility for Projects and everything under them.
 *
 * `Project.displayOnSite` is an administrator-set flag, changed only by a
 * reviewed mongosh command (docs/PROJECT_SITE_VISIBILITY.md). Only a stored
 * BSON `false` hides a Project; a missing field or `true` leaves it visible,
 * so no backfill is needed. It never grants access: group permissions still
 * decide who may see a visible Project.
 *
 * Applied at request boundaries only. This is deliberately NOT a global query
 * hook: archive commands, reconciliation, retention reports and background
 * workers share these models and must keep finding hidden Projects.
 */

/** Matches Projects the website may show. `$ne`, not `true`: legacy documents lack the field. */
const SITE_VISIBLE_PROJECT = Object.freeze({ displayOnSite: { $ne: false } });

/** A fresh copy of {@link SITE_VISIBLE_PROJECT}, safe for callers to extend. */
const siteVisibleProjectFilter = () => ({ displayOnSite: { $ne: false } });

/**
 * Whether a loaded Project is hidden from the website.
 * @param {object} project - A Project document or lean object.
 * @returns {boolean} True only for an explicit `false`.
 */
const isHiddenFromSite = (project) =>
  Boolean(project) && project.displayOnSite === false;

/**
 * Whether the Project with this id is hidden. A missing Project is not
 * "hidden"; callers already answer that case with their own 404.
 * @param {*} projectId - Project id.
 * @returns {Promise<boolean>} True if the Project exists and is hidden.
 */
const isProjectHiddenById = async (projectId) => {
  if (!projectId) return false;
  const Project = require("../models/Project");
  return Boolean(
    await Project.exists({ _id: projectId._id || projectId, displayOnSite: false }),
  );
};

/**
 * The ids of every hidden Project and of the Samples and Runs beneath them,
 * in at most three queries for the whole request (none past the first when
 * nothing is hidden). Hidden Projects are expected to be few, so `$nin` over
 * these lists stays small; Sample.project and Run.sample are both indexed.
 * @returns {Promise<{projectIds: Array, sampleIds: Array, runIds: Array}>}
 */
const loadHiddenSiteIds = async () => {
  // Lazy: the models require modules that require this one.
  const Project = require("../models/Project");
  const projectIds = await Project.distinct("_id", { displayOnSite: false });
  if (!projectIds.length) return { projectIds: [], sampleIds: [], runIds: [] };

  const Sample = require("../models/Sample");
  const sampleIds = await Sample.distinct("_id", { project: { $in: projectIds } });
  if (!sampleIds.length) return { projectIds, sampleIds: [], runIds: [] };

  const Run = require("../models/Run");
  const runIds = await Run.distinct("_id", { sample: { $in: sampleIds } });
  return { projectIds, sampleIds, runIds };
};

/**
 * Validates what {@link loadHiddenSiteIds} returned, so a model's iCanSee can
 * fail closed when a caller forgets it rather than silently show everything.
 * @param {*} hidden - Candidate hidden-id set.
 * @param {string} caller - Name used in the error message.
 * @returns {{projectIds: Array, sampleIds: Array, runIds: Array}} The set.
 */
const assertHiddenSiteIds = (hidden, caller) => {
  if (
    !hidden ||
    !Array.isArray(hidden.projectIds) ||
    !Array.isArray(hidden.sampleIds) ||
    !Array.isArray(hidden.runIds)
  ) {
    throw new TypeError(
      `${caller} requires the hidden ids from loadHiddenSiteIds(); ` +
        "without them hidden Projects' records would reach the website.",
    );
  }
  return hidden;
};

/**
 * The extra filter for one model's website queries. Empty when nothing is
 * hidden, so ordinary queries are unchanged.
 * @param {"Sample"|"Run"|"NewsItem"} kind - Model the filter is for.
 * @param {object} hidden - From {@link loadHiddenSiteIds}.
 * @returns {object} A mongoose filter fragment with no keys shared with group filters.
 */
const siteFilterFor = (kind, hidden) => {
  const { projectIds, sampleIds, runIds } = assertHiddenSiteIds(hidden, `${kind}.iCanSee`);
  switch (kind) {
    case "Sample":
      return projectIds.length ? { project: { $nin: projectIds } } : {};
    case "Run":
      return sampleIds.length ? { sample: { $nin: sampleIds } } : {};
    case "NewsItem": {
      // NewsItem.typeId is a String, so compare as strings.
      const ids = [...projectIds, ...sampleIds, ...runIds].map(String);
      return ids.length ? { typeId: { $nin: ids } } : {};
    }
    default:
      throw new TypeError(`No website visibility filter for ${kind}`);
  }
};

/**
 * Everything a website list query needs: the caller's live group ids and the
 * hidden-id set, fetched in parallel.
 * @param {object} user - Authenticated user.
 * @returns {Promise<{groupIds: Array, hidden: object}>}
 */
const websiteScope = async (user) => {
  const { visibleGroupIds } = require("./utils/fullAccessUsers");
  const [groupIds, hidden] = await Promise.all([
    visibleGroupIds(user),
    loadHiddenSiteIds(),
  ]);
  return { groupIds, hidden };
};

/** Stable code for a name that is taken, by a visible Project or a hidden one. */
const NAME_UNAVAILABLE_CODE = "PROJECT_NAME_UNAVAILABLE";

module.exports = {
  SITE_VISIBLE_PROJECT,
  siteVisibleProjectFilter,
  isHiddenFromSite,
  isProjectHiddenById,
  loadHiddenSiteIds,
  assertHiddenSiteIds,
  siteFilterFor,
  websiteScope,
  NAME_UNAVAILABLE_CODE,
};
