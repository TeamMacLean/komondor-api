/**
 * Tests for /routes/projects.js
 * Tests the projects API endpoints including:
 * - GET /project?id=:id (critical for pre-existing entity feature)
 * - GET /projects
 * - GET /projects/names
 * - POST /projects/new (including email-failure resilience)
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const Project = require("../../models/Project");
const Group = require("../../models/Group");
const projectsRouter = require("../../routes/projects");

// Mock dependencies
jest.mock("../../models/Project");
jest.mock("../../models/Group", () => ({
  GroupsIAmIn: jest.fn(),
}));
jest.mock("../../lib/sortAssociatedFiles", () => ({
  sortAdditionalFiles: jest.fn().mockResolvedValue(true),
}));
const { sortAdditionalFiles: mockSortAdditionalFiles } = jest.requireMock(
  "../../lib/sortAssociatedFiles",
);
// jest.mock is hoisted by Jest, so we can't reference a `const` declared in module
// scope inside the factory. Instead we auto-mock the module and grab its default
// export via requireMock after the fact.
jest.mock("../../lib/utils/sendOverseerEmail");
const mockSendOverseerEmail = jest.requireMock(
  "../../lib/utils/sendOverseerEmail",
);
jest.mock("../../routes/_utils", () => ({
  handleError: jest.fn((res, error, status, message) => {
    res.status(status).json({
      error: message || error.message,
      detail: error instanceof Error ? error.message : undefined,
    });
  }),
  getActualFiles: jest.fn().mockResolvedValue([]),
  compareFilesToDirectory: jest.fn().mockResolvedValue({
    actualFiles: [],
    status: {
      status: "OK",
      message: "All files present",
      missing: [],
      extra: [],
      unresolved: [],
    },
  }),
}));

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
  // Mirrors the real guard rather than always authenticating, so a test can set
  // mockUser to null and exercise the unauthenticated path.
  isAuthenticated: (req, res, next) => {
    if (!mockUser) {
      return res.status(401).send({ error: "Authentication required" });
    }
    req.user = mockUser;
    next();
  },
}));

app.use("/", projectsRouter);

describe("GET /project?id=:id", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  const mockProject = {
    _id: mockProjectId,
    name: "Test Project",
    shortDesc: "A test project",
    longDesc: "A longer description of the test project",
    owner: "testuser",
    path: "/bioinformatics/test-project",
    group: {
      _id: mockGroupId,
      name: "bioinformatics",
      safeName: "bioinformatics",
    },
    samples: [],
    additionalFiles: [],
    nudgeable: true,
    doNotSendToEna: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock user
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
    // Set environment variable
    process.env.DATASTORE_ROOT = "/mnt/reads";
  });

  describe("successful retrieval", () => {
    test("should return project with group info when ID is valid and user has permission", async () => {
      // Mock Project.findById chain
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockProject),
            }),
          }),
        }),
      });

      // Mock user belongs to project's group
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("project");
      expect(response.body.project.name).toBe("Test Project");
      expect(response.body.project.group.name).toBe("bioinformatics");
      expect(response.body).toHaveProperty("actualAdditionalFiles");
    });

    test("should return project when user is admin regardless of group membership", async () => {
      mockUser = {
        username: "adminuser",
        groups: [],
        isAdmin: true,
      };

      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockProject),
            }),
          }),
        }),
      });

      // An admin's authority is expressed by GroupsIAmIn handing them every
      // group, not by a short-circuit in the caller — see lib/utils/groupAccess.
      // Resolving [] here would mean "this admin is in no live group", which
      // really should be a 403.
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
        { _id: { toString: () => "another-group" }, name: "another-group" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("project");
      expect(response.body.project.name).toBe("Test Project");
    });

    test("should include populated group with _id and name fields", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockProject),
            }),
          }),
        }),
      });

      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(response.body.project.group).toHaveProperty("_id");
      expect(response.body.project.group).toHaveProperty("name");
      expect(response.body.project.group.name).toBe("bioinformatics");
    });

    test("should include populated samples with their group info", async () => {
      const projectWithSamples = {
        ...mockProject,
        samples: [
          {
            _id: "sample-1",
            name: "Sample 1",
            group: { _id: "group-1", name: "bioinformatics" },
          },
          {
            _id: "sample-2",
            name: "Sample 2",
            group: { _id: "group-1", name: "bioinformatics" },
          },
        ],
      };

      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(projectWithSamples),
            }),
          }),
        }),
      });

      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(response.body.project.samples).toHaveLength(2);
      expect(response.body.project.samples[0].name).toBe("Sample 1");
      expect(response.body.project.samples[0].group.name).toBe(
        "bioinformatics",
      );
    });
  });

  describe("error handling", () => {
    test("should return 400 when project ID is not provided", async () => {
      const response = await request(app).get("/project");

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 400 when project ID is empty string", async () => {
      const response = await request(app).get("/project?id=");

      expect(response.status).toBe(400);
    });

    test("should return 404 when project does not exist", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(null),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 403 when user does not belong to project group", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({ ...mockProject, owner: "someone-else" }),
            }),
          }),
        }),
      });

      // User belongs to different group
      Group.GroupsIAmIn.mockResolvedValue([
        {
          _id: { toString: () => "different-group-id" },
          name: "other-group",
        },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toMatch(/permission/i);
    });

    test("should return 500 when database error occurs", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockRejectedValue(new Error("Database error")),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(500);
    });

    test("should reject a malformed ID with 400 before it reaches the database", async () => {
      // Previously this reached findById and surfaced the driver's CastError as
      // a 500. A malformed id is the client's mistake, so it is a 400, and the
      // query is never issued.
      Project.findById = jest.fn();

      const response = await request(app).get("/project?id=invalid-id-format");

      expect(response.status).toBe(400);
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test("should reject a 12-character non-hex id that ObjectId.isValid accepts", async () => {
      // mongoose.Types.ObjectId.isValid() answers TRUE for any 12-character
      // string and casts it from its raw bytes, so a guard built on isValid
      // alone let "project-1234" through and turned this boundary check into a
      // confusing 404. routes/samples.js and routes/runs.js already used the
      // 24-hex test; this pins that routes/projects.js agrees with them.
      Project.findById = jest.fn();

      const response = await request(app).get("/project?id=project-1234");

      expect(response.status).toBe(400);
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test("should reject an operator object in the id query parameter", async () => {
      // Express parses id[$ne]=null into { $ne: "null" }, and mongoose treats
      // findById({ $ne: ... }) as a real query — it would return whichever
      // project the database happened to hand back first.
      Project.findById = jest.fn();

      const response = await request(app).get("/project?id[$ne]=null");

      expect(response.status).toBe(400);
      expect(Project.findById).not.toHaveBeenCalled();
    });
  });

  describe("cross-group read access", () => {
    test("should allow a FULL_RECORDS_ACCESS user to read a project outside their groups", async () => {
      mockUser = {
        username: "enaadmin",
        groups: [],
        isAdmin: false,
      };

      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest
                .fn()
                .mockResolvedValue({ ...mockProject, owner: "someone-else" }),
            }),
          }),
        }),
      });

      // What the real GroupsIAmIn does for a full-access user: every group in
      // read mode, only their own membership (none) in write mode.
      Group.GroupsIAmIn.mockImplementation(async (user, options) =>
        options && options.mode === "write"
          ? []
          : [{ _id: { toString: () => mockGroupId }, name: "bioinformatics" }],
      );

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({ mode: "read" }),
      );
    });
  });

  describe("multi-group user access", () => {
    test("should allow access when user belongs to multiple groups including project group", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockProject),
            }),
          }),
        }),
      });

      // User belongs to multiple groups, one of which matches
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => "other-group" }, name: "other-group" },
        { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
        { _id: { toString: () => "third-group" }, name: "third-group" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("project");
    });

    test("should deny access when user belongs to multiple groups but none match project group", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({ ...mockProject, owner: "someone-else" }),
            }),
          }),
        }),
      });

      // User belongs to multiple groups, none of which match
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => "group-a" }, name: "group-a" },
        { _id: { toString: () => "group-b" }, name: "group-b" },
      ]);

      const response = await request(app).get(`/project?id=${mockProjectId}`);

      expect(response.status).toBe(403);
    });
  });
});

describe("GET /projects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
  });

  test("should return all projects visible to user sorted by creation date", async () => {
    const mockProjects = [
      { _id: "1", name: "Project A", createdAt: new Date("2024-01-01") },
      { _id: "2", name: "Project B", createdAt: new Date("2024-01-03") },
      { _id: "3", name: "Project C", createdAt: new Date("2024-01-02") },
    ];

    const populate = jest.fn().mockResolvedValue(mockProjects);
    Project.iCanSee = jest.fn().mockReturnValue({ populate });

    const response = await request(app).get("/projects");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("projects");
    // The cards render the group name, so the list must arrive populated.
    expect(populate).toHaveBeenCalledWith("group");
    // Should be sorted by createdAt descending
    expect(response.body.projects[0].name).toBe("Project B");
    expect(response.body.projects[1].name).toBe("Project C");
    expect(response.body.projects[2].name).toBe("Project A");
  });

  test("should return empty array when user has no visible projects", async () => {
    Project.iCanSee = jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app).get("/projects");

    expect(response.status).toBe(200);
    expect(response.body.projects).toEqual([]);
  });
});

describe("GET /projects/names", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
  });

  test("should refuse an unauthenticated caller", async () => {
    // Every project name in the database, including groups the caller has no
    // part in, used to be readable without a token at all.
    mockUser = null;
    Project.find = jest.fn();

    const response = await request(app).get("/projects/names");

    expect(response.status).toBe(401);
    expect(Project.find).not.toHaveBeenCalled();
  });

  test("should return all project names", async () => {
    const mockProjects = [
      { name: "Project A" },
      { name: "Project B" },
      { name: "Project C" },
    ];

    Project.find = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(mockProjects),
    });

    const response = await request(app).get("/projects/names");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("projectNames");
    expect(response.body.projectNames).toEqual([
      "Project A",
      "Project B",
      "Project C",
    ]);
  });

  test("should return empty array when no projects exist", async () => {
    Project.find = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app).get("/projects/names");

    expect(response.status).toBe(200);
    expect(response.body.projectNames).toEqual([]);
  });
});

describe("POST /projects/new", () => {
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  const validProjectBody = {
    name: "New Project",
    group: mockGroupId,
    shortDesc: "Short description",
    longDesc: "Long description",
    owner: "testuser",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendOverseerEmail.mockResolvedValue(true);
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
  });

  test("should create project when user has permission", async () => {
    const mockSavedProject = {
      _id: "new-project-id",
      name: "New Project",
      group: mockGroupId,
      save: jest.fn().mockResolvedValue(this),
    };

    Project.mockImplementation(() => mockSavedProject);

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    const response = await request(app)
      .post("/projects/new")
      .send(validProjectBody);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("project");
  });

  test("should call sendOverseerEmail after successful project creation", async () => {
    const mockSavedProject = {
      _id: "new-project-id",
      name: "New Project",
      group: mockGroupId,
    };
    mockSavedProject.save = jest.fn().mockResolvedValue(mockSavedProject);

    Project.mockImplementation(() => mockSavedProject);

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    await request(app).post("/projects/new").send(validProjectBody);

    expect(mockSendOverseerEmail).toHaveBeenCalledTimes(1);
    expect(mockSendOverseerEmail).toHaveBeenCalledWith({
      type: "Project",
      data: mockSavedProject,
    });
  });

  test("should still return 201 and keep the project when sendOverseerEmail throws", async () => {
    const mockSavedProject = {
      _id: "new-project-id",
      name: "New Project",
      group: mockGroupId,
    };
    mockSavedProject.save = jest.fn().mockResolvedValue(mockSavedProject);

    Project.mockImplementation(() => mockSavedProject);
    Project.deleteOne = jest.fn().mockResolvedValue({});

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    mockSendOverseerEmail.mockRejectedValue(
      new Error("SMTP connection refused"),
    );

    const response = await request(app)
      .post("/projects/new")
      .send(validProjectBody);

    // Project creation must succeed despite the email failure
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("project");

    // The project must NOT have been rolled back
    expect(Project.deleteOne).not.toHaveBeenCalled();
  });

  test("should log the email error but not propagate it when sendOverseerEmail throws", async () => {
    const mockSavedProject = {
      _id: "email-fail-project-id",
      name: "New Project",
      group: mockGroupId,
    };
    mockSavedProject.save = jest.fn().mockResolvedValue(mockSavedProject);

    Project.mockImplementation(() => mockSavedProject);

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    const emailError = new Error("SMTP timeout");
    mockSendOverseerEmail.mockRejectedValue(emailError);

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await request(app).post("/projects/new").send(validProjectBody);

    // The email error should be logged to the console
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("email-fail-project-id"),
      emailError,
    );

    consoleSpy.mockRestore();
  });

  test("should still roll back the project when save itself fails (not email)", async () => {
    // save() throwing means savedProject is never assigned, so no rollback needed —
    // but if save succeeds and a later non-email step fails, rollback should still occur.
    // This test verifies a DB error during save propagates as a 500.
    const mockBrokenProject = {
      _id: undefined,
      name: "New Project",
      group: mockGroupId,
      save: jest.fn().mockRejectedValue(new Error("DB write failed")),
    };

    Project.mockImplementation(() => mockBrokenProject);
    Project.deleteOne = jest.fn().mockResolvedValue({});

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    const response = await request(app)
      .post("/projects/new")
      .send(validProjectBody);

    expect(response.status).toBe(500);
    // savedProject was never set (save threw), so no rollback should be attempted
    expect(Project.deleteOne).not.toHaveBeenCalled();
  });

  test("should include underlying error detail in 500 responses for genuine failures", async () => {
    const dbError = new Error(
      'E11000 duplicate key error collection: komondor.projects index: name_1 dup key: { name: "New Project" }',
    );
    const mockBrokenProject = {
      _id: undefined,
      name: "New Project",
      group: mockGroupId,
      save: jest.fn().mockRejectedValue(dbError),
    };

    Project.mockImplementation(() => mockBrokenProject);
    Project.deleteOne = jest.fn().mockResolvedValue({});

    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);

    const response = await request(app)
      .post("/projects/new")
      .send(validProjectBody);

    expect(response.status).toBe(500);
    // The generic message is the top-level error
    expect(response.body.error).toBe("Failed to create new project.");
    // The real cause is surfaced in detail so API clients can display it
    expect(response.body.detail).toBe(dbError.message);
  });

  test("should return 400 when group ID is not provided", async () => {
    const response = await request(app).post("/projects/new").send({
      name: "New Project",
      shortDesc: "Short description",
      longDesc: "Long description",
      owner: "testuser",
    });

    expect(response.status).toBe(400);
  });

  test("should return 403 when user does not belong to target group", async () => {
    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => "different-group" }, name: "other-group" },
    ]);

    const response = await request(app)
      .post("/projects/new")
      .send(validProjectBody);

    expect(response.status).toBe(403);
  });
});

describe("PUT /project/toggle-nudgeable", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  /** The project as the authorisation lookup sees it: id and group only. */
  const givenProject = (project) => {
    Project.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(project),
    });
  };

  /** Groups the caller may write to, in the shape GroupsIAmIn returns. */
  const givenWritableGroups = (...ids) => {
    Group.GroupsIAmIn.mockResolvedValue(
      ids.map((id) => ({ _id: { toString: () => id }, name: id })),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
    Project.findByIdAndUpdate = jest
      .fn()
      .mockResolvedValue({ _id: mockProjectId, nudgeable: false });
  });

  test("should update the flag when the caller may write to the project's group", async () => {
    givenProject({ _id: mockProjectId, group: mockGroupId });
    givenWritableGroups(mockGroupId);

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId, nudgeable: false });

    expect(response.status).toBe(200);
    expect(Project.findByIdAndUpdate).toHaveBeenCalledWith(
      mockProjectId,
      { $set: { nudgeable: false } },
      expect.objectContaining({ new: true }),
    );
  });

  test("should refuse a project belonging to a group the caller is not in", async () => {
    // The defect: the target was named only by the request body, so any logged
    // in user could flip nudgeability on any project in any group.
    givenProject({ _id: mockProjectId, group: mockGroupId });
    givenWritableGroups("a-group-the-caller-is-in");

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId, nudgeable: true });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/permission/i);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("should refuse a FULL_RECORDS_ACCESS user, who may read the group but not write to it", async () => {
    mockUser = { username: "enaadmin", groups: [], isAdmin: false };

    givenProject({ _id: mockProjectId, group: mockGroupId });
    // What the real GroupsIAmIn does for a full-access user: every group in
    // read mode, only their own membership (none) in write mode.
    Group.GroupsIAmIn.mockImplementation(async (user, options) =>
      options && options.mode === "write"
        ? []
        : [{ _id: { toString: () => mockGroupId }, name: "bioinformatics" }],
    );

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId, nudgeable: true });

    expect(response.status).toBe(403);
    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({ mode: "write" }),
    );
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("should return 404 when the project does not exist", async () => {
    givenProject(null);
    givenWritableGroups(mockGroupId);

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId, nudgeable: true });

    expect(response.status).toBe(404);
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("should reject a non-boolean nudgeable", async () => {
    // "false" is truthy, so coercing it would set the opposite flag.
    Project.findById = jest.fn();

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId, nudgeable: "false" });

    expect(response.status).toBe(400);
    expect(Project.findById).not.toHaveBeenCalled();
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("should reject an operator object as the project id", async () => {
    Project.findById = jest.fn();

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: { $ne: null }, nudgeable: true });

    expect(response.status).toBe(400);
    expect(Project.findById).not.toHaveBeenCalled();
    expect(Project.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("should return 400 when nudgeable is not provided at all", async () => {
    Project.findById = jest.fn();

    const response = await request(app)
      .put("/project/toggle-nudgeable")
      .send({ _id: mockProjectId });

    expect(response.status).toBe(400);
    expect(Project.findById).not.toHaveBeenCalled();
  });
});

describe("POST /projects/new — nudgeable and boundary typing", () => {
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  const baseBody = {
    name: "New Project",
    group: mockGroupId,
    shortDesc: "Short description",
    longDesc: "Long description",
    owner: "testuser",
  };

  /** The caller may write to the target group, which carries `sendToEna`. */
  const givenWritableGroup = (sendToEna) => {
    Group.GroupsIAmIn.mockResolvedValue([
      {
        _id: { toString: () => mockGroupId },
        name: "bioinformatics",
        sendToEna,
      },
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendOverseerEmail.mockResolvedValue(true);
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };

    const savedProject = {
      _id: "new-project-id",
      name: "New Project",
      group: mockGroupId,
    };
    savedProject.save = jest.fn().mockResolvedValue(savedProject);
    Project.mockImplementation(() => savedProject);
  });

  test("should honour an explicit nudgeable: false from the client", async () => {
    givenWritableGroup(true);

    const response = await request(app)
      .post("/projects/new")
      .send({ ...baseBody, nudgeable: false });

    expect(response.status).toBe(201);
    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ nudgeable: false }),
    );
  });

  test("should honour an explicit nudgeable: true even when the group does not send to ENA", async () => {
    givenWritableGroup(false);

    const response = await request(app)
      .post("/projects/new")
      .send({ ...baseBody, nudgeable: true });

    expect(response.status).toBe(201);
    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ nudgeable: true }),
    );
  });

  test("should derive nudgeable from the group's sendToEna when the client sends nothing", async () => {
    givenWritableGroup(true);

    await request(app).post("/projects/new").send(baseBody);

    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ nudgeable: true }),
    );
  });

  test("should not nudge projects in a group that does not send to ENA", async () => {
    // This is what the hardcoded '2Blades' ObjectId used to stand for.
    givenWritableGroup(false);

    await request(app).post("/projects/new").send(baseBody);

    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ nudgeable: false }),
    );
  });

  test("should ignore a non-boolean nudgeable and fall back to the group", async () => {
    givenWritableGroup(true);
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, nudgeable: "false" });

    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ nudgeable: true }),
    );
    // Falling back is kinder than a 400, but it must not be silent.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("nudgeable"),
    );

    consoleSpy.mockRestore();
  });

  test("should ask for the write capability, not read", async () => {
    givenWritableGroup(true);

    await request(app).post("/projects/new").send(baseBody);

    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({ mode: "write" }),
    );
  });

  test("should refuse a FULL_RECORDS_ACCESS user creating a project outside their groups", async () => {
    mockUser = { username: "enaadmin", groups: [], isAdmin: false };

    Group.GroupsIAmIn.mockImplementation(async (user, options) =>
      options && options.mode === "write"
        ? []
        : [{ _id: { toString: () => mockGroupId }, name: "bioinformatics" }],
    );

    const response = await request(app).post("/projects/new").send(baseBody);

    expect(response.status).toBe(403);
    expect(Project).not.toHaveBeenCalled();
  });

  test("should reject an operator object as the group id", async () => {
    const response = await request(app)
      .post("/projects/new")
      .send({ ...baseBody, group: { $ne: null } });

    expect(response.status).toBe(400);
    expect(Group.GroupsIAmIn).not.toHaveBeenCalled();
    expect(Project).not.toHaveBeenCalled();
  });

  test("should drop non-string text fields rather than hand them to mongoose", async () => {
    givenWritableGroup(true);

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, name: { $gt: "" }, owner: { $ne: null } });

    // The Project model is mocked here, so this asserts what reaches mongoose;
    // in production the undefined value then fails required-field validation.
    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ name: undefined }),
    );
  });

  test("stamps the owner from the session, ignoring the body's claim", async () => {
    givenWritableGroup(true);

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, owner: "somebody-else" });

    // `owner` used to be copied out of req.body. It reaches per-record
    // permission fallbacks as a read grant, so a client naming any username
    // there was handing that person access to a record in a group they may
    // never have been in. It is now whoever is actually authenticated.
    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "testuser" }),
    );
  });

  test("stamps the owner from the session even when the body sends an operator", async () => {
    givenWritableGroup(true);

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, owner: { $ne: null } });

    expect(Project).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "testuser" }),
    );
  });

  test("should ignore a non-array additionalFiles", async () => {
    givenWritableGroup(true);

    const response = await request(app)
      .post("/projects/new")
      .send({ ...baseBody, additionalFiles: "not-an-array" });

    expect(response.status).toBe(201);
    expect(mockSortAdditionalFiles).not.toHaveBeenCalled();
  });

  test("should still sort a genuine additionalFiles array", async () => {
    givenWritableGroup(true);

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, additionalFiles: [{ id: "upload-1" }] });

    expect(mockSortAdditionalFiles).toHaveBeenCalledTimes(1);
  });

  test("passes the acting username through to the file claim", async () => {
    givenWritableGroup(true);

    await request(app)
      .post("/projects/new")
      .send({ ...baseBody, additionalFiles: [{ id: "upload-1" }] });

    // Claiming a staged upload is checked against the tus sidecar's recorded
    // owner. Without this argument every local-filesystem claim is refused as
    // belonging to 'undefined'.
    const [files, parentType, , , username] =
      mockSortAdditionalFiles.mock.calls[0];
    expect(files).toEqual([{ id: "upload-1" }]);
    expect(parentType).toBe("project");
    expect(username).toBe("testuser");
  });
});
