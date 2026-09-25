/**
 * Tests for lib/utils/groupAccess — the one place route handlers ask whether a
 * user may read from, or write to, a group.
 *
 * These run against the real Group.GroupsIAmIn with only `Group.find` faked, so
 * the read/write asymmetry is exercised end to end rather than asserted against
 * a mock of the very function under test.
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

const Group = require("../../models/Group");
const {
  groupsICanRead,
  groupsICanWrite,
  groupsICanCreate,
  canCreateInGroup,
  canReadGroup,
  canWriteGroup,
  requireGroupRead,
  requireGroupWrite,
} = require("../../lib/utils/groupAccess");

const ORIGINAL = process.env.FULL_RECORDS_ACCESS_USERS;
const ORIGINAL_ENA_ADMINS = process.env.ENA_ADMINS;

const GROUPS = [
  { _id: "g1", name: "alpha", deleted: false },
  { _id: "g2", name: "beta", deleted: false },
  { _id: "gone", name: "retired", deleted: true },
];

// "alice" holds the cross-group read capability and belongs to g1 only.
const ALICE = { username: "alice", groups: ["g1"] };
const ADMIN = { username: "root", isAdmin: true };
const EVE = { username: "eve", groups: ["g1"] };

/**
 * Just enough of mongo's query semantics to honour the two filters
 * GroupsIAmIn builds: the soft-delete exclusion and an _id list.
 */
const fakeFind = async (criteria) => {
  const filter = criteria || {};

  return GROUPS.filter((group) => {
    if (filter.deleted && filter.deleted.$ne === true && group.deleted) {
      return false;
    }
    if (filter._id && filter._id.$in) {
      return filter._id.$in.includes(group._id);
    }
    return true;
  });
};

/**
 * Builds a small app that injects `user` and then applies `middleware`.
 */
const buildApp = (user, middleware) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) {
      req.user = user;
    }
    next();
  });
  app.get("/protected", middleware, (req, res) =>
    res.status(200).send({ ok: true }),
  );
  return app;
};

const names = (groups) => groups.map((group) => group.name);

let findSpy;

beforeEach(() => {
  process.env.FULL_RECORDS_ACCESS_USERS = '["alice"]';
  process.env.ENA_ADMINS = "['deeks', 'macleand', 'taz23vul', 'admin', 'kun24dup']";
  findSpy = jest.spyOn(Group, "find").mockImplementation(fakeFind);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_ENA_ADMINS === undefined) {
    delete process.env.ENA_ADMINS;
  } else {
    process.env.ENA_ADMINS = ORIGINAL_ENA_ADMINS;
  }
});

afterAll(async () => {
  if (ORIGINAL === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL;
  }
  await mongoose.connection.close();
});

describe("a user in FULL_RECORDS_ACCESS_USERS", () => {
  // The headline fix: this set is a cross-group *read* capability, and used to
  // grant write access to every group because routes authorised writes with the
  // same lookup.
  test("reads every live group", async () => {
    expect(names(await groupsICanRead(ALICE))).toEqual(["alpha", "beta"]);
  });

  test("writes only in the groups they belong to", async () => {
    expect(names(await groupsICanWrite(ALICE))).toEqual(["alpha"]);
  });

  test("may read a group they are not a member of", async () => {
    await expect(canReadGroup(ALICE, "g2")).resolves.toBe(true);
  });

  test("may not write to a group they are not a member of", async () => {
    await expect(canWriteGroup(ALICE, "g2")).resolves.toBe(false);
  });

  test("may still write to their own group", async () => {
    await expect(canWriteGroup(ALICE, "g1")).resolves.toBe(true);
  });

  test("writes nothing at all when they belong to no group", async () => {
    await expect(groupsICanWrite({ username: "alice" })).resolves.toEqual([]);
  });
});

describe("an admin", () => {
  test("reads every live group", async () => {
    expect(names(await groupsICanRead(ADMIN))).toEqual(["alpha", "beta"]);
  });

  test("writes to every live group", async () => {
    expect(names(await groupsICanWrite(ADMIN))).toEqual(["alpha", "beta"]);
  });

  test("may write to a group they are not explicitly a member of", async () => {
    await expect(canWriteGroup(ADMIN, "g2")).resolves.toBe(true);
  });
});

describe("an ordinary member", () => {
  test("reads only their own group", async () => {
    expect(names(await groupsICanRead(EVE))).toEqual(["alpha"]);
  });

  test("is refused a group they are not in", async () => {
    await expect(canReadGroup(EVE, "g2")).resolves.toBe(false);
    await expect(canWriteGroup(EVE, "g2")).resolves.toBe(false);
  });
});

describe("record creation", () => {
  test.each(["deeks", "macleand", "taz23vul", "admin", "kun24dup"])(
    "%s can list and create in every live group without membership",
    async (username) => {
      const user = { username, isAdmin: false, groups: [] };
      expect(names(await groupsICanRead(user))).toEqual(["alpha", "beta"]);
      expect(names(await groupsICanCreate(user))).toEqual(["alpha", "beta"]);
      await expect(canCreateInGroup(user, "g2")).resolves.toBe(true);
      await expect(canCreateInGroup(user, "gone")).resolves.toBe(false);
      await expect(canCreateInGroup(user, "missing")).resolves.toBe(false);
      // Creation does not grant arbitrary group edits or rewrite membership.
      await expect(canWriteGroup(user, "g2")).resolves.toBe(false);
      expect(user.groups).toEqual([]);
      expect(user.isAdmin).toBe(false);
    },
  );

  test.each([ALICE, EVE])("members create only in their own groups: %j", async (user) => {
    await expect(canCreateInGroup(user, "g1")).resolves.toBe(true);
    await expect(canCreateInGroup(user, "g2")).resolves.toBe(false);
  });

  test("a full admin retains creation access without ENA_ADMINS", async () => {
    delete process.env.ENA_ADMINS;
    await expect(canCreateInGroup(ADMIN, "g2")).resolves.toBe(true);
    await expect(canCreateInGroup(ADMIN, "gone")).resolves.toBe(false);
  });

  test("removing ENA access takes effect for an existing user object", async () => {
    const user = { username: "deeks", groups: ["g1"] };
    await expect(canCreateInGroup(user, "g2")).resolves.toBe(true);
    process.env.ENA_ADMINS = "[]";
    await expect(canCreateInGroup(user, "g2")).resolves.toBe(false);
    await expect(canCreateInGroup(user, "g1")).resolves.toBe(true);
  });

  test("does not stamp the ENA admin's cross-group access into a login token", async () => {
    const getUserForToken = require("../../lib/utils/getUserForToken");
    jest.spyOn(console, "log").mockImplementation(() => {});
    findSpy.mockImplementation(async (criteria) =>
      (await fakeFind(criteria)).map((group) => ({ ...group, id: group._id })),
    );
    const token = await getUserForToken({ username: "deeks", groups: ["g1"] });
    expect(token.groups).toEqual(["g1"]);
    expect(token.isAdmin).toBe(false);
  });

  test("missing user or group is refused without a query", async () => {
    await expect(groupsICanCreate(null)).resolves.toEqual([]);
    await expect(canCreateInGroup(null, "g1")).resolves.toBe(false);
    await expect(canCreateInGroup(ADMIN, null)).resolves.toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("propagates database errors rather than granting creation access", async () => {
    findSpy.mockRejectedValue(new Error("db down"));
    await expect(canCreateInGroup({ username: "deeks" }, "g1")).rejects.toThrow("db down");
  });
});

describe("a soft-deleted group", () => {
  test("authorises no read, even for an admin", async () => {
    await expect(canReadGroup(ADMIN, "gone")).resolves.toBe(false);
  });

  test("authorises no write, even for an admin", async () => {
    await expect(canWriteGroup(ADMIN, "gone")).resolves.toBe(false);
  });

  test("authorises no read for a full-access user", async () => {
    await expect(canReadGroup(ALICE, "gone")).resolves.toBe(false);
  });
});

describe("missing arguments", () => {
  test("no user is refused without querying", async () => {
    await expect(canReadGroup(null, "g1")).resolves.toBe(false);
    await expect(canWriteGroup(undefined, "g1")).resolves.toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("no group id is refused without querying", async () => {
    await expect(canReadGroup(ADMIN, null)).resolves.toBe(false);
    await expect(canWriteGroup(ADMIN, undefined)).resolves.toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("requireGroupRead", () => {
  const middleware = requireGroupRead((req) => req.query.groupId);

  test("passes a full-access user reading another group", async () => {
    const response = await request(buildApp(ALICE, middleware))
      .get("/protected")
      .query({ groupId: "g2" });

    expect(response.status).toBe(200);
  });

  test("rejects a member of another group", async () => {
    const response = await request(buildApp(EVE, middleware))
      .get("/protected")
      .query({ groupId: "g2" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      "User 'eve' does not have permission to view this resource",
    );
  });

  test("rejects a soft-deleted group", async () => {
    const response = await request(buildApp(ADMIN, middleware))
      .get("/protected")
      .query({ groupId: "gone" });

    expect(response.status).toBe(403);
  });
});

describe("requireGroupWrite", () => {
  const middleware = requireGroupWrite((req) => req.query.groupId);

  test("passes a member of the group", async () => {
    const response = await request(buildApp(EVE, middleware))
      .get("/protected")
      .query({ groupId: "g1" });

    expect(response.status).toBe(200);
  });

  test("passes an admin", async () => {
    const response = await request(buildApp(ADMIN, middleware))
      .get("/protected")
      .query({ groupId: "g2" });

    expect(response.status).toBe(200);
  });

  test("rejects a full-access user writing outside their groups", async () => {
    const response = await request(buildApp(ALICE, middleware))
      .get("/protected")
      .query({ groupId: "g2" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      "User 'alice' does not have permission to modify this resource",
    );
  });

  test("still passes the same full-access user inside their own group", async () => {
    const response = await request(buildApp(ALICE, middleware))
      .get("/protected")
      .query({ groupId: "g1" });

    expect(response.status).toBe(200);
  });

  test("rejects a request with no group id", async () => {
    const response = await request(buildApp(EVE, middleware)).get("/protected");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Group ID not provided");
  });

  test("rejects an unauthenticated request", async () => {
    const response = await request(buildApp(null, middleware))
      .get("/protected")
      .query({ groupId: "g1" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  test("answers 500 when the group lookup fails", async () => {
    findSpy.mockRejectedValue(new Error("db down"));

    const response = await request(buildApp(EVE, middleware))
      .get("/protected")
      .query({ groupId: "g1" });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Failed to verify group membership");
  });

  test("awaits an async getGroupId", async () => {
    const asyncMiddleware = requireGroupWrite(async (req) => req.query.groupId);

    const response = await request(buildApp(EVE, asyncMiddleware))
      .get("/protected")
      .query({ groupId: "g1" });

    expect(response.status).toBe(200);
  });
});
