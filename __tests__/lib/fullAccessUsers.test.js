/**
 * Tests for lib/utils/fullAccessUsers.js
 *
 * The previous implementation tested `process.env.FULL_RECORDS_ACCESS_USERS
 * .includes(username)`, a substring match against the raw environment string.
 * Any username that happened to be a substring of that value — including single
 * letters — was silently granted access to every record. These tests pin the
 * exact-match behaviour that replaced it.
 */

// resolveVisibilityFilter re-derives membership through groupAccess, which
// reads models/Group. Mocked so these stay unit tests: what matters here is
// *which* list of groups the filter is built from, not how Group.GroupsIAmIn
// finds it (that is __tests__/models/GroupsIAmIn.test.js).
jest.mock("../../models/Group", () => ({
  GroupsIAmIn: jest.fn(),
}));

const Group = require("../../models/Group");

const {
  getFullAccessUsers,
  hasFullRecordsAccess,
  buildVisibilityFilter,
  resolveVisibilityFilter,
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

  test("filters by group for an ordinary user", () => {
    // UPDATED: this used to expect `$or: [{ owner: "eve" }, …]`. `owner` is
    // copied verbatim out of the request body when a record is created, so a
    // standalone owner clause was a read grant no group change could withdraw
    // — and, because the client chooses the value, a way to hand access to
    // somebody else. Visibility is group visibility now.
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", "g2"] }),
    ).toEqual({ group: { $in: ["g1", "g2"] } });
  });

  test("does not grant a user access to their own records outside their groups", () => {
    const filter = buildVisibilityFilter({
      username: "eve",
      groups: ["g1"],
    });

    // Nothing anywhere in the filter may key off the owner field.
    expect(JSON.stringify(filter)).not.toContain("owner");
  });

  test("matches nothing when the user has no groups", () => {
    // Previously `{ $or: [{ owner: "eve" }] }`: a user removed from every
    // group kept reading every record they had created.
    expect(buildVisibilityFilter({ username: "eve" })).toEqual({
      _id: { $in: [] },
    });
  });

  test("ignores falsy group entries", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", null, ""] }),
    ).toEqual({ group: { $in: ["g1"] } });
  });

  test("tolerates a non-array groups value", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: "not-an-array" }),
    ).toEqual({ _id: { $in: [] } });
  });

  test("normalises group ids to strings", () => {
    // The claim is whatever was signed into the token; a non-string entry
    // would otherwise reach mongo as a query operator.
    const objectIdish = { toString: () => "g1" };

    expect(
      buildVisibilityFilter({ username: "eve", groups: [objectIdish] }),
    ).toEqual({ group: { $in: ["g1"] } });
  });

  test("matches nothing when the user carries no identifying information", () => {
    // Critically this must not be `{}`, which would match every document.
    expect(buildVisibilityFilter({})).toEqual({ _id: { $in: [] } });
  });

  test("authorises against an explicit group list when given one", () => {
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", "g2"] }, ["g1"]),
    ).toEqual({ group: { $in: ["g1"] } });
  });
});

describe("resolveVisibilityFilter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
  });

  test("excludes a group that was soft-deleted after the token was issued", async () => {
    // The whole point. `user.groups` is baked into the JWT at login, so a
    // group deleted afterwards stays in the claim for the token's whole life.
    // GroupsIAmIn drops it, which is why the per-record routes already 403;
    // the list, search and news endpoints must agree.
    Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }]);

    const filter = await resolveVisibilityFilter({
      username: "eve",
      groups: ["g1", "g2-since-deleted"],
    });

    expect(filter).toEqual({ group: { $in: ["g1"] } });
  });

  test("asks for the read capability", async () => {
    Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }]);

    await resolveVisibilityFilter({ username: "eve", groups: ["g1"] });

    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      expect.objectContaining({ username: "eve" }),
      { mode: "read" },
    );
  });

  test("returns null for a full-access user without consulting the database", async () => {
    await expect(
      resolveVisibilityFilter({ username: "alice" }),
    ).resolves.toBeNull();

    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
  });

  test("matches nothing when every group the token names has gone", async () => {
    Group.GroupsIAmIn.mockResolvedValue([]);

    await expect(
      resolveVisibilityFilter({ username: "eve", groups: ["g1"] }),
    ).resolves.toEqual({ _id: { $in: [] } });
  });

  test("matches nothing for a missing user rather than throwing", async () => {
    // GroupsIAmIn throws on a null user; a visibility filter must fail closed.
    await expect(resolveVisibilityFilter(null)).resolves.toEqual({
      _id: { $in: [] },
    });

    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
  });

  test("normalises ObjectId group ids to strings", async () => {
    Group.GroupsIAmIn.mockResolvedValue([{ _id: { toString: () => "g1" } }]);

    await expect(
      resolveVisibilityFilter({ username: "eve", groups: ["g1"] }),
    ).resolves.toEqual({ group: { $in: ["g1"] } });
  });
});
