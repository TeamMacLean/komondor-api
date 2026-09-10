/**
 * Tests for routes/users.js
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../models/User", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../../models/Project", () => ({ find: jest.fn() }));
jest.mock("../../lib/ldap", () => ({ verifyUserExists: jest.fn() }));

// GET /user composes the caller's visibility filter, which now resolves live
// group membership from the database instead of trusting the token's `groups`
// claim. Stubbed to echo the claim back, so these tests keep describing the
// filter shape rather than the lookup (models/GroupsIAmIn.test.js covers that).
jest.mock("../../lib/utils/groupAccess", () => ({
  groupsICanRead: jest.fn(async (user) =>
    ((user && user.groups) || []).map((_id) => ({ _id })),
  ),
}));

let mockUser = { username: "testuser", groups: [] };

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  isAdmin: (req, res, next) => next(),
}));

const User = require("../../models/User");
const Project = require("../../models/Project");
const { groupsICanRead } = require("../../lib/utils/groupAccess");
const { verifyUserExists } = require("../../lib/ldap");
const usersRouter = require("../../routes/users");

const app = express();
app.use(express.json());
app.use("/", usersRouter);

const ORIGINAL_FULL_ACCESS = process.env.FULL_RECORDS_ACCESS_USERS;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockUser = { username: "testuser", groups: [] };
  delete process.env.FULL_RECORDS_ACCESS_USERS;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_FULL_ACCESS === undefined) {
    delete process.env.FULL_RECORDS_ACCESS_USERS;
  } else {
    process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL_FULL_ACCESS;
  }
});

describe("GET /users", () => {
  test("returns the users", async () => {
    User.find.mockResolvedValue([{ username: "a" }]);

    const response = await request(app).get("/users");

    expect(response.status).toBe(200);
    expect(response.body.users).toEqual([{ username: "a" }]);
  });

  test("does not return the whole user record", async () => {
    // The route answered User.find({}) to any authenticated caller, which
    // published every account's email address and — more useful to an attacker
    // — its isAdmin flag and group ids. It cannot simply be made admin-only:
    // komondor-power calls it as an ordinary user to validate project owners.
    User.find.mockResolvedValue([]);

    await request(app).get("/users");

    expect(User.find).toHaveBeenCalledWith({}, "_id username name");
  });

  test("projects to the fields both clients actually read", async () => {
    // komondor-power reads username; komondor-web's admin list reads _id,
    // username and name. Anything else is a leak with no consumer.
    User.find.mockResolvedValue([]);

    await request(app).get("/users");

    const projection = User.find.mock.calls[0][1];
    ["_id", "username", "name"].forEach((field) => {
      expect(projection).toContain(field);
    });
    ["isAdmin", "groups", "email", "lastLogin"].forEach((field) => {
      expect(projection).not.toContain(field);
    });
  });

  test("answers 500 when the lookup fails", async () => {
    User.find.mockRejectedValue(new Error("db down"));

    const response = await request(app).get("/users");

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});

describe("GET /user", () => {
  test("returns the user with their projects", async () => {
    // toObject() mirrors a real mongoose document; spreading the document
    // itself would leak internal fields instead of the user's data.
    User.findOne.mockResolvedValue({
      toObject: () => ({ username: "alice", email: "alice@example.org" }),
    });
    const populate = jest.fn().mockResolvedValue([{ name: "proj" }]);
    Project.find.mockReturnValue({ populate });

    const response = await request(app)
      .get("/user")
      .query({ username: "alice" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      username: "alice",
      email: "alice@example.org",
      projects: [{ name: "proj" }],
    });
    // The project cards render the group name, so it must arrive populated.
    expect(populate).toHaveBeenCalledWith("group");
  });

  test("does not leak mongoose internals into the response", async () => {
    User.findOne.mockResolvedValue({
      $__: { internal: true },
      _doc: { username: "alice" },
      toObject: () => ({ username: "alice" }),
    });
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app)
      .get("/user")
      .query({ username: "alice" });

    expect(response.body.user.$__).toBeUndefined();
    expect(response.body.user._doc).toBeUndefined();
  });

  test("still returns projects when the user has never logged in", async () => {
    User.findOne.mockResolvedValue(null);
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([{ name: "proj" }]),
    });

    const response = await request(app)
      .get("/user")
      .query({ username: "ghost" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      username: "ghost",
      projects: [{ name: "proj" }],
    });
  });

  test("rejects a missing username with a single response", async () => {
    const response = await request(app).get("/user");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/username/);
    expect(Project.find).not.toHaveBeenCalled();
  });

  test("rejects a repeated username parameter", async () => {
    const response = await request(app).get("/user?username=a&username=b");

    expect(response.status).toBe(400);
  });

  test("withholds the account fields nothing renders", async () => {
    User.findOne.mockResolvedValue({ toObject: () => ({ username: "alice" }) });
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    await request(app).get("/user").query({ username: "alice" });

    const projection = User.findOne.mock.calls[0][1];
    // The profile card renders these.
    ["_id", "username", "name", "email", "company"].forEach((field) => {
      expect(projection).toContain(field);
    });
    // These describe the account rather than the person, and nothing shows them.
    ["isAdmin", "groups", "lastLogin"].forEach((field) => {
      expect(projection).not.toContain(field);
    });
  });

  test("shows only the projects the caller is allowed to see", async () => {
    // GET /projects goes through Project.iCanSee, but this route did a bare
    // Project.find({ owner }) — so naming any owner listed their projects
    // whatever group they were in, straight past the visibility filter.
    mockUser = { username: "testuser", groups: ["group-1"] };
    User.findOne.mockResolvedValue(null);
    const populate = jest.fn().mockResolvedValue([]);
    Project.find.mockReturnValue({ populate });

    await request(app).get("/user").query({ username: "alice" });

    // Group membership alone. The visibility filter used to carry its own
    // `$or: [{ owner }, { group }]`; the owner clause was a read grant that
    // removing somebody from a group could not withdraw.
    expect(Project.find).toHaveBeenCalledWith({
      $and: [{ owner: "alice" }, { group: { $in: ["group-1"] } }],
    });
  });

  test("still scopes a caller who may read every record to a group list", async () => {
    // This asserted `Project.find({ owner: "alice" })` — no visibility conjunct
    // at all — because visibleGroupIds used to return null for a full-access
    // principal and null meant "no filter". That is the behaviour that let
    // those principals read records belonging to *soft-deleted* groups, which
    // the per-record routes refuse: `Model.find({})` does not exclude them and
    // GroupsIAmIn does. Their reach is now expressed the same way everyone
    // else's is — GroupsIAmIn hands them every live group — so the filter is
    // group-scoped rather than absent, and a retired group stays retired.
    process.env.FULL_RECORDS_ACCESS_USERS = '["enaadmin"]';
    mockUser = { username: "enaadmin", groups: [] };
    // What GroupsIAmIn really answers for this principal in read mode: every
    // live group, regardless of the (empty) `groups` claim on the token.
    groupsICanRead.mockResolvedValueOnce([
      { _id: "group-1" },
      { _id: "group-2" },
    ]);
    User.findOne.mockResolvedValue(null);
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    await request(app).get("/user").query({ username: "alice" });

    expect(Project.find).toHaveBeenCalledWith({
      $and: [{ owner: "alice" }, { group: { $in: ["group-1", "group-2"] } }],
    });
  });

  test("fails closed for a caller whose live membership is empty", async () => {
    // The conjunct is unconditional: there is no branch that drops it. The
    // route used to have one, guarding on `visibility === null`, and it was the
    // *unfiltered* branch — reintroducing a null anywhere upstream would have
    // served alice's projects to a caller with no membership at all rather than
    // serving nothing.
    mockUser = { username: "nobody", groups: [] };
    groupsICanRead.mockResolvedValueOnce([]);
    User.findOne.mockResolvedValue(null);
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    await request(app).get("/user").query({ username: "alice" });

    expect(Project.find).toHaveBeenCalledWith({
      $and: [{ owner: "alice" }, { _id: { $in: [] } }],
    });
  });

  test("answers 500 when the lookup fails", async () => {
    User.findOne.mockRejectedValue(new Error("db down"));
    Project.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app)
      .get("/user")
      .query({ username: "alice" });

    expect(response.status).toBe(500);
  });
});

describe("POST /users/verify-ldap", () => {
  test("returns the LDAP lookup result", async () => {
    verifyUserExists.mockResolvedValue({
      exists: true,
      user: { username: "alice" },
    });

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "alice" });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
  });

  test("reports a user that does not exist", async () => {
    verifyUserExists.mockResolvedValue({ exists: false });

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "ghost" });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(false);
  });

  test("rejects a missing username", async () => {
    const response = await request(app).post("/users/verify-ldap").send({});

    expect(response.status).toBe(400);
    expect(verifyUserExists).not.toHaveBeenCalled();
  });

  test("rejects a non-string username", async () => {
    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: { $ne: null } });

    expect(response.status).toBe(400);
    expect(verifyUserExists).not.toHaveBeenCalled();
  });

  test("answers 500 when LDAP fails", async () => {
    verifyUserExists.mockRejectedValue(new Error("ldap down"));

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "alice" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("ldap down");
  });
});
