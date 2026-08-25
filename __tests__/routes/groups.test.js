/**
 * Tests for /routes/groups.js
 * Tests the groups API endpoints including:
 * - GET /groups (critical for pre-existing entity feature - fetches user's groups)
 * - POST /groups/new
 * - POST /groups/edit
 * - POST /groups/delete
 * - POST /groups/resurrect
 *
 * lib/utils/groupAccess is deliberately NOT mocked: the authorisation decision
 * is what these tests are about, so it runs for real against a mocked
 * Group.GroupsIAmIn. Note that canWriteGroup has no `user.isAdmin`
 * short-circuit — an admin's authority comes from GroupsIAmIn returning every
 * live group — so an admin test must mock GroupsIAmIn to return the group, not
 * an empty array.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const Group = require("../../models/Group");
const groupsRouter = require("../../routes/groups");

// A real (empty) datastore root. Renaming a group re-derives its safeName,
// which *is* a directory name under DATASTORE_ROOT, so /groups/edit inspects
// the filesystem before it will accept one.
const ORIGINAL_DATASTORE_ROOT = process.env.DATASTORE_ROOT;
let datastoreRoot;

beforeAll(() => {
  datastoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "komondor-groups-"));
  process.env.DATASTORE_ROOT = datastoreRoot;
});

afterAll(() => {
  if (ORIGINAL_DATASTORE_ROOT === undefined) {
    delete process.env.DATASTORE_ROOT;
  } else {
    process.env.DATASTORE_ROOT = ORIGINAL_DATASTORE_ROOT;
  }
  fs.rmSync(datastoreRoot, { recursive: true, force: true });
});

// Mock dependencies.
//
// The mock is a jest.fn(), not a plain object, because POST /groups/new does
// `new Group({...}).save()` — `new` on an object literal is a TypeError, so a
// non-constructible mock cannot be used to exercise that route at all. That is
// why the admin creation case below used to assert nothing.
jest.mock("../../models/Group", () => {
  const GroupMock = jest.fn();
  GroupMock.GroupsIAmIn = jest.fn();
  GroupMock.findById = jest.fn();
  return GroupMock;
});

// Create test app
const app = express();
app.use(express.json());

// Mock middleware - default user for most tests
let mockUser = {
  username: "testuser",
  groups: ["group-123"],
  isAdmin: false,
};

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  isAdmin: (req, res, next) => {
    if (req.user.isAdmin) {
      next();
    } else {
      res.status(403).json({ error: "Admin access required" });
    }
  },
}));

app.use("/", groupsRouter);

// The refusal paths log an [AUTHZ] line and GET /groups logs every group name.
// Both are wanted in production and are only noise here.
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /groups", () => {
  const mockGroupId1 = new mongoose.Types.ObjectId().toString();
  const mockGroupId2 = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock user
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
  });

  describe("successful retrieval", () => {
    test("should return all groups user belongs to", async () => {
      const mockGroups = [
        {
          _id: mockGroupId1,
          name: "bioinformatics",
          ldapGroups: ["CN=bioinformatics"],
        },
        { _id: mockGroupId2, name: "jjones", ldapGroups: ["CN=jjones-lab"] },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("groups");
      expect(response.body.groups).toHaveLength(2);
      expect(response.body.groups[0].name).toBe("bioinformatics");
      expect(response.body.groups[1].name).toBe("jjones");
    });

    test("should return single group when user belongs to one group", async () => {
      const mockGroups = [
        {
          _id: mockGroupId1,
          name: "bioinformatics",
          ldapGroups: ["CN=bioinformatics"],
        },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(1);
      expect(response.body.groups[0].name).toBe("bioinformatics");
    });

    test("should return empty array when user belongs to no groups", async () => {
      Group.GroupsIAmIn.mockResolvedValue([]);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body.groups).toEqual([]);
    });

    test("should return all groups for admin user", async () => {
      mockUser = {
        username: "adminuser",
        groups: [],
        isAdmin: true,
      };

      const mockGroups = [
        { _id: mockGroupId1, name: "bioinformatics" },
        { _id: mockGroupId2, name: "jjones" },
        { _id: "group-3", name: "research" },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(3);
    });

    test("should include group _id and name fields needed for pre-existing entity validation", async () => {
      const mockGroups = [
        {
          _id: mockGroupId1,
          name: "bioinformatics",
          ldapGroups: ["CN=bioinformatics"],
          safeName: "bioinformatics",
        },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body.groups[0]).toHaveProperty("_id");
      expect(response.body.groups[0]).toHaveProperty("name");
    });
  });

  describe("soft-deleted groups", () => {
    test("should hide soft-deleted groups by default", async () => {
      Group.GroupsIAmIn.mockResolvedValue([]);

      await request(app).get("/groups");

      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(expect.any(Object), {
        includeDeleted: false,
      });
    });

    test("should let an admin ask for deleted groups", async () => {
      // The admin screen tags deleted groups and is the only place one can be
      // found in order to resurrect it.
      mockUser = { username: "adminuser", groups: [], isAdmin: true };
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: mockGroupId1, name: "retired", deleted: true },
      ]);

      const response = await request(app).get("/groups?includeDeleted=true");

      expect(response.status).toBe(200);
      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(expect.any(Object), {
        includeDeleted: true,
      });
    });

    test("should refuse a non-admin asking for deleted groups", async () => {
      const response = await request(app).get("/groups?includeDeleted=true");

      expect(response.status).toBe(403);
      expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
    });

    test("should ignore a repeated includeDeleted parameter", async () => {
      // express parses a repeated query key into an array, which must not be
      // mistaken for the literal "true".
      Group.GroupsIAmIn.mockResolvedValue([]);

      const response = await request(app).get(
        "/groups?includeDeleted=true&includeDeleted=true",
      );

      expect(response.status).toBe(200);
      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(expect.any(Object), {
        includeDeleted: false,
      });
    });
  });

  describe("error handling", () => {
    test("should return 500 when database error occurs", async () => {
      Group.GroupsIAmIn.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/groups");

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("multi-group user support", () => {
    test("should return multiple groups for multi-group user", async () => {
      mockUser = {
        username: "multiuser",
        groups: ["group-1", "group-2", "group-3"],
        isAdmin: false,
      };

      const mockGroups = [
        { _id: "group-1", name: "bioinformatics" },
        { _id: "group-2", name: "jjones" },
        { _id: "group-3", name: "research" },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(3);
      expect(response.body.groups.map((g) => g.name)).toEqual([
        "bioinformatics",
        "jjones",
        "research",
      ]);
    });

    test("should be usable for project_group validation in CSV uploads", async () => {
      // This test verifies the endpoint returns data in the format needed
      // for validating project_group values in CSV uploads
      const mockGroups = [
        { _id: "group-1", name: "bioinformatics" },
        { _id: "group-2", name: "jjones" },
      ];

      Group.GroupsIAmIn.mockResolvedValue(mockGroups);

      const response = await request(app).get("/groups");

      expect(response.status).toBe(200);

      // Extract group names for validation (as komondor-power would do)
      const groupNames = response.body.groups.map((g) => g.name);
      expect(groupNames).toContain("bioinformatics");
      expect(groupNames).toContain("jjones");

      // Simulate validating a project_group value
      const projectGroupFromCsv = "bioinformatics";
      expect(groupNames.includes(projectGroupFromCsv)).toBe(true);

      const invalidProjectGroup = "unauthorized-group";
      expect(groupNames.includes(invalidProjectGroup)).toBe(false);
    });
  });
});

describe("POST /groups/new", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };
  });

  // Group.mockImplementation is set per test, and clearAllMocks (above) does
  // not undo an implementation. Reset it so a constructor stub cannot leak
  // into a later describe block.
  afterEach(() => {
    Group.mockReset();
  });

  test("should create new group when user is admin", async () => {
    const savedGroup = {
      _id: "new-group-id",
      name: "new-group",
      safeName: "new_group",
      ldapGroups: ["CN=new-group"],
    };
    const save = jest.fn().mockResolvedValue(savedGroup);
    Group.mockImplementation(() => ({ save }));

    // safeName and sendToEna are sent deliberately. safeName is derived by the
    // model's pre-validate hook and *is* a directory name under
    // DATASTORE_ROOT, so a caller who could set it directly would choose where
    // the group's files land. The assertion below is that neither reaches the
    // constructor.
    const response = await request(app)
      .post("/groups/new")
      .send({
        name: "new-group",
        ldapGroups: ["CN=new-group"],
        safeName: "../escaped",
        sendToEna: true,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ group: savedGroup });

    expect(Group).toHaveBeenCalledTimes(1);
    expect(Group).toHaveBeenCalledWith({
      name: "new-group",
      ldapGroups: ["CN=new-group"],
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("reports a failed save as a 500 rather than hanging", async () => {
    const save = jest.fn().mockRejectedValue(new Error("duplicate key"));
    Group.mockImplementation(() => ({ save }));

    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const response = await request(app)
      .post("/groups/new")
      .send({ name: "new-group", ldapGroups: ["CN=new-group"] });
    errorSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "duplicate key" });
  });

  test("should return 403 when non-admin tries to create group", async () => {
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };

    const response = await request(app).post("/groups/new").send({
      name: "new-group",
      ldapGroups: ["CN=new-group"],
    });

    expect(response.status).toBe(403);
  });

  test("should return 400 for a non-string name", async () => {
    const response = await request(app)
      .post("/groups/new")
      .send({ name: { $ne: null }, ldapGroups: ["CN=x"] });

    expect(response.status).toBe(400);
  });

  test("should return 400 when ldapGroups is not an array of strings", async () => {
    const response = await request(app)
      .post("/groups/new")
      .send({ name: "new-group", ldapGroups: "CN=x" });

    expect(response.status).toBe(400);
  });
});

describe("POST /groups/edit", () => {
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  /** A group document whose save() reports what it was given. */
  const buildGroup = (overrides = {}) => {
    const group = {
      _id: mockGroupId,
      name: "test-group",
      safeName: "test_group",
      ldapGroups: ["CN=test"],
      sendToEna: false,
      ...overrides,
    };
    group.save = jest.fn().mockResolvedValue(group);
    return group;
  };

  /** Puts a file in the group's datastore directory, as real data would. */
  const populateDatastore = (safeName = "test_group") => {
    const dir = path.join(datastoreRoot, safeName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "reads.fastq.gz"), "x");
    return dir;
  };

  afterEach(() => {
    fs.rmSync(path.join(datastoreRoot, "test_group"), {
      recursive: true,
      force: true,
    });
  });

  /** Makes GroupsIAmIn answer as though the caller is in mockGroupId. */
  const memberOfTheGroup = () =>
    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "test-group" },
    ]);

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
  });

  test("should return 400 when group ID is not provided", async () => {
    const response = await request(app).post("/groups/edit").send({
      name: "updated-name",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error");
  });

  test("should return 400 for a malformed group ID", async () => {
    const response = await request(app).post("/groups/edit").send({
      id: "not-an-id",
      name: "updated-name",
    });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });

  test("should return 400 for an object group ID without querying", async () => {
    // Group.findById({ $ne: null }) is not a cast failure: mongoose reads the
    // object as a query condition and returns an arbitrary group, which would
    // let this route edit a group the caller never named.
    const response = await request(app)
      .post("/groups/edit")
      .send({ id: { $ne: null }, name: "updated-name" });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });

  test("should allow admin to edit any group", async () => {
    // UPDATED: this used to mock GroupsIAmIn as [] and still expect 200,
    // because the route had its own `req.user.isAdmin ||` prelude. Authorisation
    // now goes through canWriteGroup, which has no isAdmin short-circuit by
    // design — that is what stops a soft-deleted group authorising an admin. An
    // admin never really receives [] unless the group is deleted or absent, so
    // the mock is corrected rather than the expectation.
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app).post("/groups/edit").send({
      id: mockGroupId,
      name: "updated-name",
      ldapGroups: ["CN=updated"],
    });

    expect(response.status).toBe(200);
    expect(mockGroup.save).toHaveBeenCalled();
    expect(mockGroup.ldapGroups).toEqual(["CN=updated"]);
  });

  test("should allow group member to edit the cosmetic fields", async () => {
    // UPDATED twice. It used to send `ldapGroups` as a plain member and expect
    // 200 — that is the privilege escalation closed by the ldapGroups test
    // below. It then sent `name`, which is not cosmetic either: name re-derives
    // safeName, a live directory under DATASTORE_ROOT. sendToEna is what is
    // actually left for a member to change.
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app).post("/groups/edit").send({
      id: mockGroupId,
      sendToEna: true,
    });

    expect(response.status).toBe(200);
    expect(mockGroup.sendToEna).toBe(true);
    // Untouched: they were not in the request.
    expect(mockGroup.name).toBe("test-group");
    expect(mockGroup.ldapGroups).toEqual(["CN=test"]);
  });

  test("should refuse a non-admin member renaming the group", async () => {
    // name is not a label. The pre-validate hook re-derives safeName from it
    // and the post-save hook mkdirs DATASTORE_ROOT/<safeName>, so a member
    // renaming a group forks its datastore and orphans everything already
    // filed under the old name. It is also the group identifier in the ENA
    // export.
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "renamed-group" });

    expect(response.status).toBe(403);
    expect(mockGroup.save).not.toHaveBeenCalled();
    expect(mockGroup.name).toBe("test-group");
  });

  test("should let a member re-send the unchanged name alongside another field", async () => {
    // Clients resend the whole group object; carrying the current name is not
    // a rename and must not cost a member their edit.
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "test-group", sendToEna: true });

    expect(response.status).toBe(200);
    expect(mockGroup.sendToEna).toBe(true);
  });

  test("should refuse an admin rename that would strand an existing datastore", async () => {
    // Nothing here moves the directory: File documents store paths relative to
    // DATASTORE_ROOT that begin with the group's safeName, so moving the tree
    // without rewriting every one of them is how the data gets lost. The
    // rename is refused instead.
    mockUser = { username: "adminuser", groups: [], isAdmin: true };
    populateDatastore("test_group");

    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "renamed-group" });

    expect(response.status).toBe(409);
    expect(mockGroup.save).not.toHaveBeenCalled();
    expect(mockGroup.name).toBe("test-group");
    // The tree is still where it was.
    expect(fs.existsSync(path.join(datastoreRoot, "test_group", "reads.fastq.gz"))).toBe(true);
  });

  test("should allow an admin rename when the datastore holds nothing yet", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };
    fs.mkdirSync(path.join(datastoreRoot, "test_group"), { recursive: true });

    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "renamed-group" });

    expect(response.status).toBe(200);
    expect(mockGroup.name).toBe("renamed-group");
  });

  test("should allow an admin rename that leaves safeName alone", async () => {
    // "test-group" and "test group" both slugify to test_group, so the
    // directory does not move and the data cannot be stranded.
    mockUser = { username: "adminuser", groups: [], isAdmin: true };
    populateDatastore("test_group");

    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "test group" });

    expect(response.status).toBe(200);
    expect(mockGroup.name).toBe("test group");
  });

  test("should return 400 for a 12-character id mongoose would cast to garbage", async () => {
    // ObjectId.isValid("project-1234") is true: mongoose reads the 12 bytes
    // raw. The other three route files carry a 24-hex test for exactly this;
    // without it the id silently becomes a different one.
    const response = await request(app)
      .post("/groups/edit")
      .send({ id: "project-1234", name: "updated-name" });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });

  test("should refuse a non-admin member changing ldapGroups", async () => {
    // ldapGroups decides who is in the group. A member who can rewrite it can
    // add their own directory DN to another group's pattern, or capture a
    // directory group outright, and take its data with it.
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, ldapGroups: ["CN=attacker-controlled"] });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/LDAP groups/);
    expect(mockGroup.save).not.toHaveBeenCalled();
    expect(mockGroup.ldapGroups).toEqual(["CN=test"]);
  });

  test("should refuse a non-admin member clearing ldapGroups", async () => {
    // An empty array is still a membership change: it removes everyone.
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, ldapGroups: [] });

    expect(response.status).toBe(403);
    expect(mockGroup.save).not.toHaveBeenCalled();
  });

  test("should reject a non-string entry in ldapGroups from an admin", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, ldapGroups: [{ $ne: null }] });

    expect(response.status).toBe(400);
    expect(mockGroup.save).not.toHaveBeenCalled();
  });

  test("should reject a non-boolean sendToEna", async () => {
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, sendToEna: "yes" });

    expect(response.status).toBe(400);
    expect(mockGroup.save).not.toHaveBeenCalled();
  });

  test("should reject a non-string name", async () => {
    const mockGroup = buildGroup();
    Group.findById.mockResolvedValue(mockGroup);
    memberOfTheGroup();

    const response = await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: { $ne: null } });

    expect(response.status).toBe(400);
    expect(mockGroup.save).not.toHaveBeenCalled();
  });

  test("should return 403 when user does not belong to group", async () => {
    const mockGroup = buildGroup();

    Group.findById.mockResolvedValue(mockGroup);
    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => "different-group" }, name: "other-group" },
    ]);

    const response = await request(app).post("/groups/edit").send({
      id: mockGroupId,
      name: "updated-name",
      ldapGroups: ["CN=updated"],
    });

    expect(response.status).toBe(403);
  });

  test("should ask for the write capability, not read", async () => {
    // In read mode a FULL_RECORDS_ACCESS_USERS user is handed every group,
    // which would let them edit groups they are not in.
    Group.findById.mockResolvedValue(buildGroup());
    memberOfTheGroup();

    await request(app)
      .post("/groups/edit")
      .send({ id: mockGroupId, name: "updated-name" });

    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      expect.objectContaining({ username: "testuser" }),
      { mode: "write" },
    );
  });

  test("should return 404 when group does not exist", async () => {
    // UPDATED: GroupsIAmIn now has to resolve the group for the caller to get
    // past authorisation at all — see the note on the admin test above.
    Group.findById.mockResolvedValue(null);
    memberOfTheGroup();

    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const response = await request(app).post("/groups/edit").send({
      id: mockGroupId,
      name: "updated-name",
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /groups/delete", () => {
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should return 403 when non-admin tries to delete group", async () => {
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };

    const response = await request(app).post("/groups/delete").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(403);
  });

  test("should soft-delete group when user is admin", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const mockGroup = {
      _id: mockGroupId,
      name: "test-group",
      deleted: false,
      save: jest.fn().mockResolvedValue({ deleted: true }),
    };

    Group.findById.mockResolvedValue(mockGroup);

    const response = await request(app).post("/groups/delete").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(200);
    expect(mockGroup.deleted).toBe(true);
    expect(mockGroup.save).toHaveBeenCalled();
  });

  test("should return 400 when group ID is not provided", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const response = await request(app).post("/groups/delete").send({});

    expect(response.status).toBe(400);
  });

  test("should return 404 when group does not exist", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    Group.findById.mockResolvedValue(null);

    const response = await request(app).post("/groups/delete").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(404);
  });

  test("should return 400 for an object group ID without querying", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };

    const response = await request(app)
      .post("/groups/delete")
      .send({ id: { $ne: null } });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });

  test("should return 400 for a 12-character id mongoose would cast to garbage", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };

    const response = await request(app)
      .post("/groups/delete")
      .send({ id: "project-1234" });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });
});

describe("POST /groups/resurrect", () => {
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should return 403 when non-admin tries to resurrect group", async () => {
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };

    const response = await request(app).post("/groups/resurrect").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(403);
  });

  test("should restore soft-deleted group when user is admin", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const mockGroup = {
      _id: mockGroupId,
      name: "test-group",
      deleted: true,
      save: jest.fn().mockResolvedValue({ deleted: false }),
    };

    Group.findById.mockResolvedValue(mockGroup);

    const response = await request(app).post("/groups/resurrect").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(200);
    expect(mockGroup.deleted).toBe(false);
    expect(mockGroup.save).toHaveBeenCalled();
  });

  test("should return 400 when group ID is not provided", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    const response = await request(app).post("/groups/resurrect").send({});

    expect(response.status).toBe(400);
  });

  test("should return 404 when group does not exist", async () => {
    mockUser = {
      username: "adminuser",
      groups: [],
      isAdmin: true,
    };

    Group.findById.mockResolvedValue(null);

    const response = await request(app).post("/groups/resurrect").send({
      id: mockGroupId,
    });

    expect(response.status).toBe(404);
  });

  test("should look the group up directly, not through GroupsIAmIn", async () => {
    // GroupsIAmIn is where the soft-delete filter lives, so a route whose whole
    // job is to undo a soft-delete cannot use it to find its target.
    mockUser = { username: "adminuser", groups: [], isAdmin: true };

    const mockGroup = {
      _id: mockGroupId,
      deleted: true,
      save: jest.fn().mockResolvedValue({}),
    };
    Group.findById.mockResolvedValue(mockGroup);

    const response = await request(app)
      .post("/groups/resurrect")
      .send({ id: mockGroupId });

    expect(response.status).toBe(200);
    expect(Group.findById).toHaveBeenCalledWith(mockGroupId);
    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
  });

  test("should return 400 for an object group ID without querying", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };

    const response = await request(app)
      .post("/groups/resurrect")
      .send({ id: { $ne: null } });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });

  test("should return 400 for a 12-character id mongoose would cast to garbage", async () => {
    mockUser = { username: "adminuser", groups: [], isAdmin: true };

    const response = await request(app)
      .post("/groups/resurrect")
      .send({ id: "project-1234" });

    expect(response.status).toBe(400);
    expect(Group.findById).not.toHaveBeenCalled();
  });
});
