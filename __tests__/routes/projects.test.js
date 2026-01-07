/**
 * Tests for /routes/projects.js
 * Tests the projects API endpoints including:
 * - GET /project?id=:id (critical for pre-existing entity feature)
 * - GET /projects
 * - GET /projects/names
 * - POST /projects/new
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
jest.mock("../../lib/utils/sendOverseerEmail", () =>
  jest.fn().mockResolvedValue(true),
);
jest.mock("../../routes/_utils", () => ({
  handleError: jest.fn((res, error, status, message) => {
    res.status(status).json({ error: message || error.message });
  }),
  getActualFiles: jest.fn().mockResolvedValue([]),
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
  isAuthenticated: (req, res, next) => {
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

      // Admin doesn't need GroupsIAmIn check - userCanAccessGroup returns true immediately
      Group.GroupsIAmIn.mockResolvedValue([]);

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
      expect(response.body.project.samples[0].group.name).toBe("bioinformatics");
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
              exec: jest.fn().mockResolvedValue(mockProject),
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

    test("should handle invalid ObjectId format gracefully", async () => {
      Project.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest
                .fn()
                .mockRejectedValue(new Error("Cast to ObjectId failed")),
            }),
          }),
        }),
      });

      const response = await request(app).get("/project?id=invalid-id-format");

      expect(response.status).toBe(500);
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
              exec: jest.fn().mockResolvedValue(mockProject),
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

    Project.iCanSee = jest.fn().mockResolvedValue(mockProjects);

    const response = await request(app).get("/projects");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("projects");
    // Should be sorted by createdAt descending
    expect(response.body.projects[0].name).toBe("Project B");
    expect(response.body.projects[1].name).toBe("Project C");
    expect(response.body.projects[2].name).toBe("Project A");
  });

  test("should return empty array when user has no visible projects", async () => {
    Project.iCanSee = jest.fn().mockResolvedValue([]);

    const response = await request(app).get("/projects");

    expect(response.status).toBe(200);
    expect(response.body.projects).toEqual([]);
  });
});

describe("GET /projects/names", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  beforeEach(() => {
    jest.clearAllMocks();
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

    const response = await request(app).post("/projects/new").send({
      name: "New Project",
      group: mockGroupId,
      shortDesc: "Short description",
      longDesc: "Long description",
      owner: "testuser",
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("project");
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

    const response = await request(app).post("/projects/new").send({
      name: "New Project",
      group: mockGroupId,
      shortDesc: "Short description",
      longDesc: "Long description",
      owner: "testuser",
    });

    expect(response.status).toBe(403);
  });
});
