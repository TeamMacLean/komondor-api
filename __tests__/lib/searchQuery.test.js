/**
 * Verifies the search query is built correctly against *real* mongoose rather
 * than a hand-written stub.
 *
 * routes/search.test.js mocks the whole chain, so it would pass even if
 * `.where().regex()` were not a valid mongoose API. This asserts the filter
 * that actually reaches the driver.
 */

const mongoose = require("mongoose");

const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;

/** Mirrors searchByName in routes/search.js. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildSearch = (Model, user, query) =>
  Model.iCanSee(user)
    .where("name")
    .regex(new RegExp(escapeRegex(query), "i"))
    .populate("group");

beforeEach(() => {
  process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
});

afterAll(async () => {
  if (ORIGINAL === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL;
  }
  await mongoose.connection.close();
});

describe.each([
  ["Project", () => Project],
  ["Sample", () => Sample],
  ["Run", () => Run],
])("%s search query", (name, getModel) => {
  const user = { username: "eve", groups: ["g1"] };

  test("chaining where().regex().populate() yields a usable query", () => {
    const query = buildSearch(getModel(), user, "abc");

    expect(query).toBeInstanceOf(mongoose.Query);
    expect(typeof query.exec).toBe("function");
  });

  test("combines the visibility filter with the name match", () => {
    const filter = buildSearch(getModel(), user, "abc").getFilter();

    expect(filter.$or).toEqual([{ owner: "eve" }, { group: "g1" }]);
    expect(filter.name).toEqual({ $regex: /abc/i });
  });

  test("the name match is case-insensitive", () => {
    const filter = buildSearch(getModel(), user, "ABC").getFilter();

    expect(filter.name.$regex.flags).toContain("i");
    expect("xx-abc-yy").toMatch(filter.name.$regex);
  });

  test("regex metacharacters are matched literally", () => {
    const filter = buildSearch(getModel(), user, "a(b").getFilter();

    expect("xxa(byy").toMatch(filter.name.$regex);
    expect("ab").not.toMatch(filter.name.$regex);
  });

  test("a full-access user gets the name match with no ownership filter", () => {
    const filter = buildSearch(getModel(), { username: "alice" }, "abc").getFilter();

    expect(filter.$or).toBeUndefined();
    expect(filter.name).toEqual({ $regex: /abc/i });
  });

  test("a user with no identifying information matches nothing", () => {
    const filter = buildSearch(getModel(), {}, "abc").getFilter();

    expect(filter._id).toEqual({ $in: [] });
  });
});
