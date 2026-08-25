/**
 * Tests for Group.GroupsIAmIn.
 *
 * This static decides which groups a user belongs to, and every route's
 * permission check is built on it. Two branches matter most:
 *
 *  - the fall-through: a user with no admin flag, no group ids and no LDAP
 *    memberOf previously left the find criteria as `null`, and `Group.find(null)`
 *    is treated by mongoose as an empty filter — so that user received *every*
 *    group;
 *  - the read/write split: FULL_RECORDS_ACCESS_USERS is a cross-group *read*
 *    capability, but routes authorised writes with the same call, so it used to
 *    grant write access to every group.
 */

const mongoose = require("mongoose");
const Group = require("../../models/Group");

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;

const ALL_GROUPS = [
  { _id: "g1", name: "alpha" },
  { _id: "g2", name: "beta" },
];

// Every query must exclude soft-deleted groups unless asked not to.
const LIVE_ONLY = { deleted: { $ne: true } };

let findSpy;

beforeEach(() => {
  process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
  findSpy = jest.spyOn(Group, "find").mockResolvedValue(ALL_GROUPS);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (ORIGINAL === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL;
  }
  await mongoose.connection.close();
});

describe("Group.GroupsIAmIn", () => {
  test("throws when called with no user", async () => {
    await expect(Group.GroupsIAmIn(null)).rejects.toThrow(
      /User object is required/,
    );
  });

  test("returns every group for an admin", async () => {
    const groups = await Group.GroupsIAmIn({ username: "root", isAdmin: true });

    expect(findSpy).toHaveBeenCalledWith({ ...LIVE_ONLY });
    expect(groups).toEqual(ALL_GROUPS);
  });

  test("returns every group for an admin in write mode too", async () => {
    await Group.GroupsIAmIn({ username: "root", isAdmin: true }, { mode: "write" });

    expect(findSpy).toHaveBeenCalledWith({ ...LIVE_ONLY });
  });

  test("filters by group ids when the user has them", async () => {
    await Group.GroupsIAmIn({ username: "eve", groups: ["g1"] });

    expect(findSpy).toHaveBeenCalledWith({
      _id: { $in: ["g1"] },
      ...LIVE_ONLY,
    });
  });

  test("filters by LDAP memberOf when no group ids are present", async () => {
    await Group.GroupsIAmIn({
      username: "eve",
      memberOf: ["CN=bioinformatics", "CN=lab"],
    });

    expect(findSpy).toHaveBeenCalledWith({
      $or: [
        { ldapGroups: { $regex: /^CN=bioinformatics$/i } },
        { ldapGroups: { $regex: /^CN=lab$/i } }
      ],
      ...LIVE_ONLY,
    });
  });

  test("handles a plain-string memberOf (single-valued LDAP attribute)", async () => {
    // LDAP returns single-valued attributes as strings, not one-element
    // arrays, so a user in exactly one group arrives this way.
    await Group.GroupsIAmIn({
      username: "eve",
      memberOf: "CN=bioinformatics",
    });

    expect(findSpy).toHaveBeenCalledWith({
      $or: [{ ldapGroups: { $regex: /^CN=bioinformatics$/i } }],
      ...LIVE_ONLY,
    });
  });

  test("falls back to a lowercase memberof attribute", async () => {
    await Group.GroupsIAmIn({
      username: "eve",
      memberof: ["CN=lab"],
    });

    expect(findSpy).toHaveBeenCalledWith({
      $or: [{ ldapGroups: { $regex: /^CN=lab$/i } }],
      ...LIVE_ONLY,
    });
  });

  test("prefers group ids over memberOf when both are present", async () => {
    await Group.GroupsIAmIn({
      username: "eve",
      groups: ["g1"],
      memberOf: ["CN=lab"],
    });

    expect(findSpy).toHaveBeenCalledWith({
      _id: { $in: ["g1"] },
      ...LIVE_ONLY,
    });
  });

  describe("soft-deleted groups", () => {
    test("are excluded from a read", async () => {
      await Group.GroupsIAmIn({ username: "eve", groups: ["g1"] });

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: { $ne: true } }),
      );
    });

    test("are excluded from a write", async () => {
      await Group.GroupsIAmIn(
        { username: "eve", groups: ["g1"] },
        { mode: "write" },
      );

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: { $ne: true } }),
      );
    });

    test("are excluded for admins, who are not exempt", async () => {
      await Group.GroupsIAmIn({ username: "root", isAdmin: true });

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: { $ne: true } }),
      );
    });

    test("are included when includeDeleted is set", async () => {
      await Group.GroupsIAmIn(
        { username: "eve", groups: ["g1"] },
        { includeDeleted: true },
      );

      expect(findSpy).toHaveBeenCalledWith({ _id: { $in: ["g1"] } });
    });
  });

  describe("a user in FULL_RECORDS_ACCESS_USERS", () => {
    // The headline fix. This set is a cross-group *read* capability (the
    // accessions export); before the split it also handed the user every group
    // in the write checks that routes/projects.js, samples.js and runs.js built
    // on this static.
    test("reads across every group", async () => {
      await Group.GroupsIAmIn({ username: "alice" });

      expect(findSpy).toHaveBeenCalledWith({ ...LIVE_ONLY });
    });

    test("reads across every group when read mode is explicit", async () => {
      await Group.GroupsIAmIn({ username: "alice" }, { mode: "read" });

      expect(findSpy).toHaveBeenCalledWith({ ...LIVE_ONLY });
    });

    test("writes only in the groups they actually belong to", async () => {
      await Group.GroupsIAmIn(
        { username: "alice", groups: ["g1"] },
        { mode: "write" },
      );

      expect(findSpy).toHaveBeenCalledWith({
        _id: { $in: ["g1"] },
        ...LIVE_ONLY,
      });
    });

    test("writes nowhere when they belong to no group", async () => {
      await expect(
        Group.GroupsIAmIn({ username: "alice" }, { mode: "write" }),
      ).resolves.toEqual([]);

      expect(findSpy).not.toHaveBeenCalled();
    });

    test("still writes everywhere if they are also an admin", async () => {
      await Group.GroupsIAmIn(
        { username: "alice", isAdmin: true },
        { mode: "write" },
      );

      expect(findSpy).toHaveBeenCalledWith({ ...LIVE_ONLY });
    });
  });

  describe("an unrecognised mode", () => {
    // Falling back to "read" would silently restore the conflation, so an
    // unknown mode has to be an error rather than a default.
    test("throws", async () => {
      await expect(
        Group.GroupsIAmIn({ username: "alice" }, { mode: "reed" }),
      ).rejects.toThrow(/unknown mode/);
    });

    test("does not query the collection", async () => {
      await expect(
        Group.GroupsIAmIn({ username: "alice" }, { mode: "reed" }),
      ).rejects.toThrow();

      expect(findSpy).not.toHaveBeenCalled();
    });
  });

  describe("a user with no group information", () => {
    const noGroups = { username: "eve" };

    test("returns no groups", async () => {
      await expect(Group.GroupsIAmIn(noGroups)).resolves.toEqual([]);
    });

    test("does not query the collection at all", async () => {
      await Group.GroupsIAmIn(noGroups);

      expect(findSpy).not.toHaveBeenCalled();
    });

    test("does not query with a null filter, which would match everything", async () => {
      await Group.GroupsIAmIn(noGroups);

      expect(findSpy).not.toHaveBeenCalledWith(null);
    });

    test("treats empty arrays the same as absent ones", async () => {
      await expect(
        Group.GroupsIAmIn({ username: "eve", groups: [], memberOf: [] }),
      ).resolves.toEqual([]);
      expect(findSpy).not.toHaveBeenCalled();
    });
  });

  test("does not grant full access to a substring of the configured list", async () => {
    await Group.GroupsIAmIn({ username: "ali", groups: ["g1"] });

    expect(findSpy).toHaveBeenCalledWith({
      _id: { $in: ["g1"] },
      ...LIVE_ONLY,
    });
  });

  test("does not throw when FULL_RECORDS_ACCESS_USERS is unset", async () => {
    delete process.env.FULL_RECORDS_ACCESS_USERS;

    await expect(
      Group.GroupsIAmIn({ username: "eve", groups: ["g1"] }),
    ).resolves.toEqual(ALL_GROUPS);
  });

  test("propagates a database error", async () => {
    findSpy.mockRejectedValue(new Error("db down"));

    await expect(
      Group.GroupsIAmIn({ username: "eve", groups: ["g1"] }),
    ).rejects.toThrow("db down");
  });
});
