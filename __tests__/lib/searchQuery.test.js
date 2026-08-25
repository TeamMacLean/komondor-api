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

// searchByName resolves the caller's live group ids first and hands them to
// iCanSee; `null` is what visibleGroupIds() returns for a full-access user.
const buildSearch = (Model, user, query, groupIds = []) =>
  Model.iCanSee(user, groupIds)
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
    const query = buildSearch(getModel(), user, "abc", ["g1"]);

    expect(query).toBeInstanceOf(mongoose.Query);
    expect(typeof query.exec).toBe("function");
  });

  test("combines the visibility filter with the name match", () => {
    const filter = buildSearch(getModel(), user, "abc", ["g1"]).getFilter();

    // Group membership alone. The filter used to be
    // `$or: [{ owner }, { group }]`; the owner clause was a read grant that
    // removing somebody from a group could not withdraw, and `owner` was
    // copied straight out of the request body when a record was created.
    expect(filter.group).toEqual({ $in: ["g1"] });
    expect(filter.$or).toBeUndefined();
    expect(filter.name).toEqual({ $regex: /abc/i });
  });

  test("authorises against the live ids, not the token's groups claim", () => {
    // The token still claims g1; the live lookup no longer returns it because
    // the group was soft-deleted after the token was issued.
    const filter = buildSearch(getModel(), user, "abc", []).getFilter();

    expect(filter._id).toEqual({ $in: [] });
    expect(filter.name).toEqual({ $regex: /abc/i });
  });

  test("the name match is case-insensitive", () => {
    const filter = buildSearch(getModel(), user, "ABC", ["g1"]).getFilter();

    expect(filter.name.$regex.flags).toContain("i");
    expect("xx-abc-yy").toMatch(filter.name.$regex);
  });

  test("regex metacharacters are matched literally", () => {
    const filter = buildSearch(getModel(), user, "a(b", ["g1"]).getFilter();

    expect("xxa(byy").toMatch(filter.name.$regex);
    expect("ab").not.toMatch(filter.name.$regex);
  });

  test("a full-access user gets the name match with no ownership filter", () => {
    const filter = buildSearch(
      getModel(),
      { username: "alice" },
      "abc",
      null,
    ).getFilter();

    expect(filter.$or).toBeUndefined();
    expect(filter.name).toEqual({ $regex: /abc/i });
  });

  test("a user with no identifying information matches nothing", () => {
    const filter = buildSearch(getModel(), {}, "abc", []).getFilter();

    expect(filter._id).toEqual({ $in: [] });
  });
});
