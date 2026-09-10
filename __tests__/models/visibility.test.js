/**
 * Tests for the `iCanSee` statics on Project, Sample, Run and NewsItem.
 *
 * These decide which records a user may read, so the filter each one builds is
 * asserted directly. Before this refactor they tested
 * `process.env.FULL_RECORDS_ACCESS_USERS.includes(username)` — a substring
 * match that granted unrestricted access to short usernames and threw when the
 * variable was unset.
 *
 * `iCanSee` now takes the caller's *live* group ids as a second argument
 * instead of reading the `groups` claim baked into the token at login, so a
 * group soft-deleted after that token was issued stops being visible here as
 * well as on the per-record routes. Resolving those ids is a database round
 * trip and lives in lib/utils/fullAccessUsers.visibleGroupIds; this static
 * stays synchronous because a mongoose Query is a thenable and would be
 * executed by any caller's await.
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

// Every principal now arrives here with a *list*. visibleGroupIds() used to
// hand a full-access user `null` — "no filter at all" — and Model.find({})
// returns records in soft-deleted groups, the very groups canReadGroup 403s on
// the per-record route. Admins are given every live group instead, so their
// query is scoped like everyone else's.
const LIVE_GROUPS = ["g1", "g2"];

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
    const query = getModel().iCanSee({ username: "eve" }, []);

    expect(typeof query.populate).toBe("function");
    expect(typeof query.sort).toBe("function");
    expect(typeof query.exec).toBe("function");
  });

  // These three used to assert `{}` — an unrestricted query — for exactly the
  // principals who use the admin screen. That is how the list, search and news
  // endpoints kept serving records whose group had been soft-deleted while the
  // per-record endpoint refused the same group.
  describe.each([
    ["the built-in admin", { username: "admin" }],
    ["a user flagged isAdmin", { username: "carol", isAdmin: true }],
    ["a configured full-access user", { username: "alice" }],
  ])("for %s", (_label, user) => {
    test("scopes the query to the live groups, never to everything", () => {
      const query = getModel().iCanSee(user, LIVE_GROUPS);

      expect(filterOf(query)).toEqual({ group: { $in: LIVE_GROUPS } });
      expect(filterOf(query)).not.toEqual({});
    });

    test("matches nothing when every group has been deleted", () => {
      const query = getModel().iCanSee(user, []);

      expect(filterOf(query)).toEqual({ _id: { $in: [] } });
    });

    test("fails closed on the legacy null group list", () => {
      // `null` was the "sees everything" sentinel. visibleGroupIds no longer
      // produces it, and if something reintroduces it the query must match
      // nothing rather than reopen the whole collection.
      const query = getModel().iCanSee(user, null);

      expect(filterOf(query)).not.toEqual({});
      expect(filterOf(query)).toEqual({ _id: { $in: [] } });
    });
  });

  test("restricts an ordinary user to their groups' records", () => {
    const query = getModel().iCanSee({ username: "eve" }, ["g1", "g2"]);

    expect(filterOf(query)).toEqual({ group: { $in: ["g1", "g2"] } });
  });

  test("authorises against the ids passed in, not the token's claim", () => {
    // The claim still names g1 and g2 — one of them was soft-deleted after the
    // token was issued, so the live lookup returns only g1. The stale claim
    // used to keep serving the deleted group's records for the rest of that
    // token's life, which is the whole defect this argument closes.
    const query = getModel().iCanSee(
      { username: "eve", groups: ["g1", "g2"] },
      ["g1"],
    );

    expect(filterOf(query)).toEqual({ group: { $in: ["g1"] } });
  });

  test("matches nothing for a user whose live membership is empty", () => {
    // Not `{}` — that would return every record in the collection.
    const query = getModel().iCanSee({ username: "eve", groups: ["g1"] }, []);

    expect(filterOf(query)).toEqual({ _id: { $in: [] } });
  });

  test("refuses to be called without the live group ids", () => {
    // Omitting them used to mean "fall back to user.groups", silently
    // restoring the stale-claim behaviour. It has to fail loudly instead.
    expect(() =>
      getModel().iCanSee({ username: "eve", groups: ["g1"] }),
    ).toThrow(TypeError);
  });

  test("does not hand a user records they own outside their groups", () => {
    // `owner` was copied straight from the request body when a record was
    // created, so an owner clause was both a grant group revocation could not
    // withdraw and a way to name somebody else as the beneficiary.
    const query = getModel().iCanSee({ username: "eve" }, ["g1"]);

    expect(JSON.stringify(filterOf(query))).not.toContain("owner");
  });

  describe("substring usernames do not gain full access", () => {
    test.each([["a"], ["ali"], ["lice"], ["ce"]])(
      "restricts username %p",
      (username) => {
        const query = getModel().iCanSee({ username }, []);

        // No groups, and owning a record is no longer a grant: nothing.
        expect(filterOf(query)).toEqual({ _id: { $in: [] } });
      },
    );
  });

  test("does not throw when FULL_RECORDS_ACCESS_USERS is unset", () => {
    delete process.env.FULL_RECORDS_ACCESS_USERS;

    expect(() => getModel().iCanSee({ username: "eve" }, [])).not.toThrow();
  });

  test("matches nothing for a user with no identifying information", () => {
    const query = getModel().iCanSee({}, []);

    expect(filterOf(query)).toEqual({ _id: { $in: [] } });
  });

  test("matches nothing rather than everything for no user at all", () => {
    const query = getModel().iCanSee(null, []);

    expect(filterOf(query)).toEqual({ _id: { $in: [] } });
  });
});
