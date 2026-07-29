/**
 * Tests for lib/utils/fullAccessUsers.js
 *
 * The previous implementation tested `process.env.FULL_RECORDS_ACCESS_USERS
 * .includes(username)`, a substring match against the raw environment string.
 * Any username that happened to be a substring of that value — including single
 * letters — was silently granted access to every record. These tests pin the
 * exact-match behaviour that replaced it.
 */

const {
  getFullAccessUsers,
  hasFullRecordsAccess,
  buildVisibilityFilter,
} = require("../../lib/utils/fullAccessUsers");

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL;
  }
});

describe("getFullAccessUsers", () => {
  test("parses a JSON array", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice", "bob"]';
    expect(getFullAccessUsers()).toEqual(["alice", "bob"]);
  });

  test("parses a comma-separated list", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = "alice, bob ,carol";
    expect(getFullAccessUsers()).toEqual(["alice", "bob", "carol"]);
  });

  test("parses a single bare username", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = "alice";
    expect(getFullAccessUsers()).toEqual(["alice"]);
  });

  test("ignores non-string entries in a JSON array", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice", 5, null, "bob"]';
    expect(getFullAccessUsers()).toEqual(["alice", "bob"]);
  });

  test("returns an empty list when unset", () => {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
    expect(getFullAccessUsers()).toEqual([]);
  });

  test("returns an empty list when blank", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = "   ";
    expect(getFullAccessUsers()).toEqual([]);
  });

  test("reads the environment on each call rather than at import time", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
    expect(getFullAccessUsers()).toEqual(["alice"]);
    process.env.FULL_RECORDS_ACCESS_USERS = '["bob"]';
    expect(getFullAccessUsers()).toEqual(["bob"]);
  });
});

describe("hasFullRecordsAccess", () => {
  beforeEach(() => {
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice", "bob"]';
  });

  test("grants access to a listed user", () => {
    expect(hasFullRecordsAccess({ username: "alice" })).toBe(true);
  });

  test("grants access to the built-in admin username", () => {
    expect(hasFullRecordsAccess({ username: "admin" })).toBe(true);
  });

  test("grants access to a user flagged isAdmin", () => {
    expect(hasFullRecordsAccess({ username: "carol", isAdmin: true })).toBe(
      true,
    );
  });

  test("denies an unlisted user", () => {
    expect(hasFullRecordsAccess({ username: "eve" })).toBe(false);
  });

  describe("does not grant access by substring match", () => {
    // Each of these is a substring of '["alice", "bob"]'.
    test.each([["a"], ["b"], ["ali"], ["ce"], ["lice"], ['"']])(
      "denies username %p",
      (username) => {
        expect(hasFullRecordsAccess({ username })).toBe(false);
      },
    );

    test("denies a substring of a comma-separated configuration", () => {
      process.env.FULL_RECORDS_ACCESS_USERS = "usernames,here";
      expect(hasFullRecordsAccess({ username: "user" })).toBe(false);
      expect(hasFullRecordsAccess({ username: "usernames" })).toBe(true);
    });
  });

  describe("fails closed on unusable input", () => {
    test("denies when the environment variable is unset", () => {
      delete process.env.FULL_RECORDS_ACCESS_USERS;
      expect(hasFullRecordsAccess({ username: "alice" })).toBe(false);
    });

    test("does not throw when the environment variable is unset", () => {
      delete process.env.FULL_RECORDS_ACCESS_USERS;
      expect(() => hasFullRecordsAccess({ username: "alice" })).not.toThrow();
    });

    test.each([[null], [undefined], [{}], [{ username: "" }], [{ username: 5 }]])(
      "denies for user %p",
      (user) => {
        expect(hasFullRecordsAccess(user)).toBe(false);
      },
    );
  });
});

describe("buildVisibilityFilter", () => {
  beforeEach(() => {
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
  });

  test("returns null (unrestricted) for a full-access user", () => {
    expect(buildVisibilityFilter({ username: "alice" })).toBeNull();
  });

  test("filters by owner and group for an ordinary user", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", "g2"] }),
    ).toEqual({
      $or: [{ owner: "eve" }, { group: "g1" }, { group: "g2" }],
    });
  });

  test("filters by owner alone when the user has no groups", () => {
    expect(buildVisibilityFilter({ username: "eve" })).toEqual({
      $or: [{ owner: "eve" }],
    });
  });

  test("ignores falsy group entries", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", null, ""] }),
    ).toEqual({ $or: [{ owner: "eve" }, { group: "g1" }] });
  });

  test("tolerates a non-array groups value", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: "not-an-array" }),
    ).toEqual({ $or: [{ owner: "eve" }] });
  });

  test("matches nothing when the user carries no identifying information", () => {
    // Critically this must not be `{}`, which would match every document.
    expect(buildVisibilityFilter({})).toEqual({ _id: { $in: [] } });
  });
});
