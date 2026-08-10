/**
 * Tests for Group.GroupsIAmIn.
 *
 * This static decides which groups a user belongs to, and every route's
 * permission check is built on it. The branch of interest is the fall-through:
 * a user with no admin flag, no group ids and no LDAP memberOf previously left
 * the find criteria as `null`, and `Group.find(null)` is treated by mongoose as
 * an empty filter — so that user received *every* group.
 */

const mongoose = require("mongoose");
const Group = require("../../models/Group");

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;

const ALL_GROUPS = [
  { _id: "g1", name: "alpha" },
  { _id: "g2", name: "beta" },
];

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

    expect(findSpy).toHaveBeenCalledWith({});
    expect(groups).toEqual(ALL_GROUPS);
  });

  test("returns every group for a configured full-access user", async () => {
    await Group.GroupsIAmIn({ username: "alice" });

    expect(findSpy).toHaveBeenCalledWith({});
  });

  test("filters by group ids when the user has them", async () => {
    await Group.GroupsIAmIn({ username: "eve", groups: ["g1"] });

    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: ["g1"] } });
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
    });
  });

  test("prefers group ids over memberOf when both are present", async () => {
    await Group.GroupsIAmIn({
      username: "eve",
      groups: ["g1"],
      memberOf: ["CN=lab"],
    });

    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: ["g1"] } });
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

    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: ["g1"] } });
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
