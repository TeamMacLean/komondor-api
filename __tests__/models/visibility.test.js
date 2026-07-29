/**
 * Tests for the `iCanSee` statics on Project, Sample, Run and NewsItem.
 *
 * These decide which records a user may read, so the filter each one builds is
 * asserted directly. Before this refactor they tested
 * `process.env.FULL_RECORDS_ACCESS_USERS.includes(username)` — a substring
 * match that granted unrestricted access to short usernames and threw when the
 * variable was unset.
 */

const mongoose = require("mongoose");

const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");
const NewsItem = require("../../models/NewsItem");

const MODELS = [
  ["Project", () => Project],
  ["Sample", () => Sample],
  ["Run", () => Run],
  ["NewsItem", () => NewsItem],
];

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;

/** Reads the filter a query was built with, across mongoose versions. */
const filterOf = (query) =>
  typeof query.getFilter === "function" ? query.getFilter() : query._conditions;

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

describe.each(MODELS)("%s.iCanSee", (name, getModel) => {
  test("returns a mongoose query so callers can keep chaining", () => {
    const query = getModel().iCanSee({ username: "eve", groups: [] });

    expect(typeof query.populate).toBe("function");
    expect(typeof query.sort).toBe("function");
    expect(typeof query.exec).toBe("function");
  });

  test("applies no filter for the built-in admin", () => {
    const query = getModel().iCanSee({ username: "admin" });

    expect(filterOf(query)).toEqual({});
  });

  test("applies no filter for a user flagged isAdmin", () => {
    const query = getModel().iCanSee({ username: "carol", isAdmin: true });

    expect(filterOf(query)).toEqual({});
  });

  test("applies no filter for a configured full-access user", () => {
    const query = getModel().iCanSee({ username: "alice" });

    expect(filterOf(query)).toEqual({});
  });

  test("restricts an ordinary user to their own and their groups' records", () => {
    const query = getModel().iCanSee({ username: "eve", groups: ["g1", "g2"] });

    expect(filterOf(query)).toEqual({
      $or: [{ owner: "eve" }, { group: "g1" }, { group: "g2" }],
    });
  });

  describe("substring usernames do not gain full access", () => {
    test.each([["a"], ["ali"], ["lice"], ["ce"]])(
      "restricts username %p",
      (username) => {
        const query = getModel().iCanSee({ username, groups: [] });

        expect(filterOf(query)).toEqual({ $or: [{ owner: username }] });
      },
    );
  });

  test("does not throw when FULL_RECORDS_ACCESS_USERS is unset", () => {
    delete process.env.FULL_RECORDS_ACCESS_USERS;

    expect(() => getModel().iCanSee({ username: "eve", groups: [] })).not.toThrow();
  });

  test("restricts a user with no groups when the variable is unset", () => {
    delete process.env.FULL_RECORDS_ACCESS_USERS;

    const query = getModel().iCanSee({ username: "eve" });

    expect(filterOf(query)).toEqual({ $or: [{ owner: "eve" }] });
  });

  test("matches nothing for a user with no identifying information", () => {
    // Must not be `{}` — that would return every record in the collection.
    const query = getModel().iCanSee({});

    expect(filterOf(query)).toEqual({ _id: { $in: [] } });
  });
});
