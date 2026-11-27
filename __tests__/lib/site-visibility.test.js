/**
 * lib/site-visibility: the request-boundary helpers behind Project.displayOnSite.
 * Real-database behaviour lives in
 * __tests__/integration/project-site-visibility.test.js.
 */

jest.mock("../../models/Project", () => ({ distinct: jest.fn(), exists: jest.fn() }));
jest.mock("../../models/Sample", () => ({ distinct: jest.fn() }));
jest.mock("../../models/Run", () => ({ distinct: jest.fn() }));
jest.mock("../../lib/utils/fullAccessUsers", () => ({
  visibleGroupIds: jest.fn().mockResolvedValue(["g1"]),
}));

const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");
const visibility = require("../../lib/site-visibility");

beforeEach(() => jest.clearAllMocks());

describe("isHiddenFromSite", () => {
  test.each([
    [{}, false],
    [{ displayOnSite: undefined }, false],
    [{ displayOnSite: true }, false],
    [{ displayOnSite: false }, true],
    // A stored string is not the flag; the runbook refuses to write one.
    [{ displayOnSite: "false" }, false],
    [null, false],
    [undefined, false],
  ])("%p -> %p", (project, expected) => {
    expect(visibility.isHiddenFromSite(project)).toBe(expected);
  });
});

describe("siteVisibleProjectFilter", () => {
  test("matches missing and true, never asks for true", () => {
    expect(visibility.siteVisibleProjectFilter()).toEqual({ displayOnSite: { $ne: false } });
  });

  test("returns a fresh object each time", () => {
    const a = visibility.siteVisibleProjectFilter();
    a.extra = 1;
    expect(visibility.siteVisibleProjectFilter()).not.toHaveProperty("extra");
    expect(Object.isFrozen(visibility.SITE_VISIBLE_PROJECT)).toBe(true);
  });
});

describe("loadHiddenSiteIds", () => {
  test("one query when nothing is hidden", async () => {
    Project.distinct.mockResolvedValue([]);

    await expect(visibility.loadHiddenSiteIds()).resolves.toEqual({
      projectIds: [],
      sampleIds: [],
      runIds: [],
    });
    expect(Project.distinct).toHaveBeenCalledWith("_id", { displayOnSite: false });
    expect(Sample.distinct).not.toHaveBeenCalled();
    expect(Run.distinct).not.toHaveBeenCalled();
  });

  test("walks Project -> Sample -> Run in three batched queries", async () => {
    Project.distinct.mockResolvedValue(["p1"]);
    Sample.distinct.mockResolvedValue(["s1", "s2"]);
    Run.distinct.mockResolvedValue(["r1"]);

    await expect(visibility.loadHiddenSiteIds()).resolves.toEqual({
      projectIds: ["p1"],
      sampleIds: ["s1", "s2"],
      runIds: ["r1"],
    });
    expect(Sample.distinct).toHaveBeenCalledWith("_id", { project: { $in: ["p1"] } });
    expect(Run.distinct).toHaveBeenCalledWith("_id", { sample: { $in: ["s1", "s2"] } });
  });

  test("skips the Run query for a hidden project with no samples", async () => {
    Project.distinct.mockResolvedValue(["p1"]);
    Sample.distinct.mockResolvedValue([]);

    await expect(visibility.loadHiddenSiteIds()).resolves.toEqual({
      projectIds: ["p1"],
      sampleIds: [],
      runIds: [],
    });
    expect(Run.distinct).not.toHaveBeenCalled();
  });
});

describe("isProjectHiddenById", () => {
  test("asks for this id with an explicit false", async () => {
    Project.exists.mockResolvedValue(true);

    await expect(visibility.isProjectHiddenById("p1")).resolves.toBe(true);
    expect(Project.exists).toHaveBeenCalledWith({ _id: "p1", displayOnSite: false });
  });

  test("accepts a populated reference", async () => {
    Project.exists.mockResolvedValue(false);

    await expect(visibility.isProjectHiddenById({ _id: "p2" })).resolves.toBe(false);
    expect(Project.exists).toHaveBeenCalledWith({ _id: "p2", displayOnSite: false });
  });

  test("a missing id is not hidden and costs no query", async () => {
    await expect(visibility.isProjectHiddenById(null)).resolves.toBe(false);
    expect(Project.exists).not.toHaveBeenCalled();
  });
});

describe("siteFilterFor", () => {
  const hidden = { projectIds: ["p1"], sampleIds: ["s1"], runIds: ["r1"] };
  const none = { projectIds: [], sampleIds: [], runIds: [] };

  test("adds nothing when nothing is hidden", () => {
    for (const kind of ["Sample", "Run", "NewsItem"]) {
      expect(visibility.siteFilterFor(kind, none)).toEqual({});
    }
  });

  test("excludes by each model's parent link", () => {
    expect(visibility.siteFilterFor("Sample", hidden)).toEqual({ project: { $nin: ["p1"] } });
    expect(visibility.siteFilterFor("Run", hidden)).toEqual({ sample: { $nin: ["s1"] } });
    expect(visibility.siteFilterFor("NewsItem", hidden)).toEqual({
      typeId: { $nin: ["p1", "s1", "r1"] },
    });
  });

  test.each([[undefined], [null], [{}], [{ projectIds: [], sampleIds: [] }]])(
    "fails closed on %p",
    (bad) => {
      expect(() => visibility.siteFilterFor("Sample", bad)).toThrow(TypeError);
    },
  );

  test("refuses an unknown model", () => {
    expect(() => visibility.siteFilterFor("Read", none)).toThrow(TypeError);
  });
});

test("websiteScope fetches the live groups and the hidden set together", async () => {
  Project.distinct.mockResolvedValue([]);

  await expect(visibility.websiteScope({ username: "eve" })).resolves.toEqual({
    groupIds: ["g1"],
    hidden: { projectIds: [], sampleIds: [], runIds: [] },
  });
});
