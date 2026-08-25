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
  visibleGroupIds,
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

  // The filter is now a pure function of the group ids handed in — there is no
  // "sees everything" exemption for anyone. An exemption returned null, null
  // means no filter, and no filter includes records in *soft-deleted* groups,
  // which canReadGroup refuses on the per-record route. The two layers only
  // agree if the admin screen's query is scoped to a group list too.
  describe.each([
    ["an admin", { username: "carol", isAdmin: true }],
    ["the built-in admin username", { username: "admin" }],
    ["a FULL_RECORDS_ACCESS_USERS member", { username: "alice" }],
  ])("gives %s no exemption from the filter", (_label, user) => {
    test("never returns null", () => {
      expect(buildVisibilityFilter(user, ["g1"])).not.toBeNull();
    });

    test("scopes to the group ids it was given", () => {
      expect(buildVisibilityFilter(user, ["g1", "g2"])).toEqual({
        group: { $in: ["g1", "g2"] },
      });
    });

    test("matches nothing when no group is readable", () => {
      // Critically not `{}`: every live group being gone must not become
      // "every record, including those in deleted groups".
      expect(buildVisibilityFilter(user, [])).toEqual({ _id: { $in: [] } });
    });
  });

  test("filters by group for an ordinary user", () => {
    // UPDATED: this used to expect `$or: [{ owner: "eve" }, …]`. `owner` is
    // copied verbatim out of the request body when a record is created, so a
    // standalone owner clause was a read grant no group change could withdraw
    // — and, because the client chooses the value, a way to hand access to
    // somebody else. Visibility is group visibility now.
    expect(
      buildVisibilityFilter({ username: "eve" }, ["g1", "g2"]),
    ).toEqual({ group: { $in: ["g1", "g2"] } });
  });

  test("does not grant a user access to their own records outside their groups", () => {
    const filter = buildVisibilityFilter({ username: "eve" }, ["g1"]);

    // Nothing anywhere in the filter may key off the owner field.
    expect(JSON.stringify(filter)).not.toContain("owner");
  });

  test("matches nothing when the user has no readable group", () => {
    // Previously `{ $or: [{ owner: "eve" }] }`: a user removed from every
    // group kept reading every record they had created.
    expect(buildVisibilityFilter({ username: "eve" }, [])).toEqual({
      _id: { $in: [] },
    });
  });

  test("ignores falsy group entries", () => {
    expect(
      buildVisibilityFilter({ username: "eve" }, ["g1", null, ""]),
    ).toEqual({ group: { $in: ["g1"] } });
  });

  test("matches nothing for a non-array group list", () => {
    expect(
      buildVisibilityFilter({ username: "eve" }, "not-an-array"),
    ).toEqual({ _id: { $in: [] } });
  });

  test("normalises group ids to strings", () => {
    // Ids arrive as ObjectIds from the database; a non-string entry would
    // otherwise reach mongo as a query operator.
    const objectIdish = { toString: () => "g1" };

    expect(buildVisibilityFilter({ username: "eve" }, [objectIdish])).toEqual({
      group: { $in: ["g1"] } });
  });

  test("matches nothing when the user carries no identifying information", () => {
    // Critically this must not be `{}`, which would match every document.
    expect(buildVisibilityFilter({}, [])).toEqual({ _id: { $in: [] } });
  });

  test("matches nothing for a missing user whatever ids are passed", () => {
    expect(buildVisibilityFilter(null, ["g1"])).toEqual({ _id: { $in: [] } });
  });

  test("ignores the token's groups claim entirely", () => {
    // The claim is baked in at login and outlives a group's deletion. Only the
    // ids resolved from the database decide anything; a caller that forgets to
    // pass them gets nothing, not the claim.
    expect(
      buildVisibilityFilter({ username: "eve", groups: ["g1", "g2"] }),
    ).toEqual({ _id: { $in: [] } });

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

  // The finding this pins: a full-access user used to short-circuit to null
  // here, and null means "no filter", so the list/search/news query became
  // Model.find({}) — which returns records whose group has been soft-deleted,
  // the very group canReadGroup 403s on the per-record route. Admins are the
  // principals who use the admin screen, so they were the only ones who could
  // see the two layers disagree.
  describe.each([
    ["an admin", { username: "carol", isAdmin: true }],
    ["the built-in admin username", { username: "admin" }],
    ["a FULL_RECORDS_ACCESS_USERS member", { username: "alice" }],
  ])("for %s", (_label, user) => {
    test("resolves the live groups instead of returning null", async () => {
      Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }, { _id: "g2" }]);

      await expect(resolveVisibilityFilter(user)).resolves.toEqual({
        group: { $in: ["g1", "g2"] },
      });
    });

    test("consults the database rather than assuming everything", async () => {
      Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }]);

      await resolveVisibilityFilter(user);

      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
        expect.objectContaining({ username: user.username }),
        { mode: "read" },
      );
    });

    test("excludes a soft-deleted group", async () => {
      // GroupsIAmIn filters `deleted`, so the deleted group simply is not in
      // the list it returns. The filter must be scoped to what came back and
      // to nothing else.
      Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }]);

      const filter = await resolveVisibilityFilter(user);

      expect(filter).toEqual({ group: { $in: ["g1"] } });
      expect(filter).not.toEqual({});
    });

    test("matches nothing when every group has been deleted", async () => {
      Group.GroupsIAmIn.mockResolvedValue([]);

      await expect(resolveVisibilityFilter(user)).resolves.toEqual({
        _id: { $in: [] },
      });
    });
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

describe("visibleGroupIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
  });

  // This is the function the four record models' iCanSee is fed from, so a
  // null here is what turned the admin screen's query into Model.find({}).
  // It must be a list for every principal, resolved live.
  test.each([
    ["an admin", { username: "carol", isAdmin: true }],
    ["the built-in admin username", { username: "admin" }],
    ["a FULL_RECORDS_ACCESS_USERS member", { username: "alice" }],
    ["an ordinary user", { username: "eve", groups: ["g1"] }],
  ])("returns the live group ids for %s, never null", async (_label, user) => {
    Group.GroupsIAmIn.mockResolvedValue([{ _id: "g1" }, { _id: "g2" }]);

    const ids = await visibleGroupIds(user);

    expect(ids).not.toBeNull();
    expect(ids.map(String)).toEqual(["g1", "g2"]);
    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(user, { mode: "read" });
  });

  test("returns an empty list, not null, when nothing is readable", async () => {
    Group.GroupsIAmIn.mockResolvedValue([]);

    await expect(visibleGroupIds({ username: "admin" })).resolves.toEqual([]);
  });

  test("fails closed for a missing user without calling GroupsIAmIn", async () => {
    await expect(visibleGroupIds(null)).resolves.toEqual([]);
    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
  });

  test("tolerates GroupsIAmIn returning a non-array", async () => {
    Group.GroupsIAmIn.mockResolvedValue(undefined);

    await expect(visibleGroupIds({ username: "eve" })).resolves.toEqual([]);
  });
});
