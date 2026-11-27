/**
 * A lib/site-visibility stand-in for route tests that mock the models.
 *
 * Those tests replace Project/Sample/Run with automocks, so the real loaders'
 * `distinct()` calls would buffer against no connection. This keeps the real
 * pure helpers (isHiddenFromSite, siteFilterFor, ...) and answers the database
 * lookups with "nothing is hidden", which is what every pre-existing route
 * test assumes. Hidden-project behaviour is exercised against a real MongoDB
 * in __tests__/integration/project-site-visibility.test.js.
 *
 * Usage, inside the test file:
 *   jest.mock("../../lib/site-visibility", () =>
 *     require("../setup/siteVisibilityMock")());
 *
 * Plain functions, not jest.fn: a suite's resetAllMocks() must not strip them.
 */

const NONE_HIDDEN = Object.freeze({
  projectIds: Object.freeze([]),
  sampleIds: Object.freeze([]),
  runIds: Object.freeze([]),
});

const createSiteVisibilityMock = () => {
  const actual = jest.requireActual("../../lib/site-visibility");
  const loadHiddenSiteIds = async () => NONE_HIDDEN;

  return {
    ...actual,
    loadHiddenSiteIds,
    isProjectHiddenById: async () => false,
    websiteScope: async (user) => {
      const { visibleGroupIds } = require("../../lib/utils/fullAccessUsers");
      return { groupIds: await visibleGroupIds(user), hidden: NONE_HIDDEN };
    },
  };
};

createSiteVisibilityMock.NONE_HIDDEN = NONE_HIDDEN;

module.exports = createSiteVisibilityMock;
