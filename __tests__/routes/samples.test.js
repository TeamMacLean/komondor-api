/**
 * Tests for /routes/samples.js
 * Tests the samples API endpoints including:
 * - GET /samples
 * - GET /sample?id=:id (critical for pre-existing entity feature)
 * - GET /samples/names/:projectId
 * - POST /samples/new (standard and TPlex)
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const Sample = require("../../models/Sample");
const Project = require("../../models/Project");
const Group = require("../../models/Group");
const samplesRouter = require("../../routes/samples");

// Mock dependencies
jest.mock("../../models/Sample");
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

app.use("/", samplesRouter);

describe("GET /sample?id=:id", () => {
  const mockSampleId = new mongoose.Types.ObjectId().toString();
  const mockGroupId = new mongoose.Types.ObjectId().toString();
  const mockProjectId = new mongoose.Types.ObjectId().toString();

  const mockSample = {
    _id: mockSampleId,
    name: "Test Sample",
    scientificName: "Arabidopsis thaliana",
    commonName: "Thale cress",
    ncbi: "3702",
    conditions: "Standard lab conditions",
    owner: "testuser",
    path: "/bioinformatics/test-project/test-sample",
    project: {
      _id: mockProjectId,
      name: "Test Project",
      path: "/bioinformatics/test-project",
    },
    group: {
      _id: mockGroupId,
      name: "bioinformatics",
      safeName: "bioinformatics",
    },
    runs: [],
    additionalFiles: [],
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
    // Default Group mock
    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => mockGroupId }, name: "bioinformatics" },
    ]);
  });

  describe("successful retrieval", () => {
    test("should return sample with group info when ID is valid and user has permission", async () => {
      // Mock Sample.findById chain
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
      expect(response.body.sample.name).toBe("Test Sample");
      expect(response.body.sample.group.name).toBe("bioinformatics");
      expect(response.body.sample.project.name).toBe("Test Project");
      expect(response.body).toHaveProperty("actualAdditionalFiles");
    });

    test("should return sample when user is admin regardless of group membership", async () => {
      mockUser = {
        username: "adminuser",
        groups: [],
        isAdmin: true,
      };

      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      // Admin doesn't need GroupsIAmIn check - userCanAccessGroup returns true immediately
      Group.GroupsIAmIn.mockResolvedValue([]);

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
      expect(response.body.sample.name).toBe("Test Sample");
    });

    test("should include populated group with _id and name fields", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.sample.group).toHaveProperty("_id");
      expect(response.body.sample.group).toHaveProperty("name");
      expect(response.body.sample.group.name).toBe("bioinformatics");
    });

    test("should include populated project info", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.sample.project).toHaveProperty("_id");
      expect(response.body.sample.project).toHaveProperty("name");
      expect(response.body.sample.project.name).toBe("Test Project");
    });

    test("should include populated runs with their group info", async () => {
      const sampleWithRuns = {
        ...mockSample,
        runs: [
          {
            _id: "run-1",
            name: "Run 1",
            group: { _id: "group-1", name: "bioinformatics" },
          },
          {
            _id: "run-2",
            name: "Run 2",
            group: { _id: "group-1", name: "bioinformatics" },
          },
        ],
      };

      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(sampleWithRuns),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.sample.runs).toHaveLength(2);
      expect(response.body.sample.runs[0].name).toBe("Run 1");
      expect(response.body.sample.runs[0].group.name).toBe("bioinformatics");
    });
  });

  describe("error handling", () => {
    test("should return 400 when sample ID is not provided", async () => {
      const response = await request(app).get("/sample");

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 400 when sample ID is empty string", async () => {
      const response = await request(app).get("/sample?id=");

      expect(response.status).toBe(400);
    });

    test("should return 404 when sample does not exist", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 403 when user does not belong to sample group", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
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

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toMatch(/permission/i);
    });

    test("should return 500 when database error occurs", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockRejectedValue(new Error("Database error")),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(500);
    });

    test("should handle invalid ObjectId format gracefully", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest
                  .fn()
                  .mockRejectedValue(new Error("Cast to ObjectId failed")),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get("/sample?id=invalid-id-format");

      expect(response.status).toBe(500);
    });
  });

  describe("multi-group user access", () => {
    test("should allow access when user belongs to multiple groups including sample group", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
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

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
    });

    test("should deny access when user belongs to multiple groups but none match sample group", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      // User belongs to multiple groups, none of which match
      Group.GroupsIAmIn.mockResolvedValue([
        { _id: { toString: () => "group-a" }, name: "group-a" },
        { _id: { toString: () => "group-b" }, name: "group-b" },
      ]);

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(403);
    });
  });

  describe("pre-existing entity feature support", () => {
    test("should return sample with all fields needed for CSV validation", async () => {
      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockSample),
              }),
            }),
          }),
        }),
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      // These fields are critical for the pre-existing entity feature
      expect(response.body.sample).toHaveProperty("_id");
      expect(response.body.sample).toHaveProperty("name");
      expect(response.body.sample).toHaveProperty("group");
      expect(response.body.sample.group).toHaveProperty("_id");
      expect(response.body.sample.group).toHaveProperty("name");
      expect(response.body.sample).toHaveProperty("project");
      expect(response.body.sample.project).toHaveProperty("_id");
      expect(response.body.sample.project).toHaveProperty("name");
    });

    test("should validate permission against sample's own group (not project's group)", async () => {
      // Sample has different group than project (edge case)
      const sampleWithDifferentGroup = {
        ...mockSample,
        group: {
          _id: "sample-specific-group",
          name: "sample-group",
          safeName: "sample-group",
        },
        project: {
          ...mockSample.project,
          group: {
            _id: "project-group",
            name: "project-group",
          },
        },
      };

      Sample.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(sampleWithDifferentGroup),
              }),
            }),
          }),
        }),
      });

      // User belongs to sample's group
      Group.GroupsIAmIn.mockResolvedValue([
        {
          _id: { toString: () => "sample-specific-group" },
          name: "sample-group",
        },
      ]);

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      // Should succeed because permission is checked against sample.group, not project.group
      expect(response.status).toBe(200);
      expect(response.body.sample.group.name).toBe("sample-group");
    });
  });
});

describe("GET /samples/names/:projectId", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    // Reset mock user and Group mock for these tests
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
    Group.GroupsIAmIn.mockResolvedValue([
      { _id: { toString: () => "group-123" }, name: "Test Group" },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("should return unique sample names for a project", async () => {
    const mockSamples = [
      { _id: "1", name: "Sample A" },
      { _id: "2", name: "Sample B" },
      { _id: "3", name: "Sample A" }, // Duplicate
      { _id: "4", name: "Sample C" },
    ];

    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSamples),
      }),
    });

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("sampleNames");
    expect(response.body.sampleNames).toEqual([
      "Sample A",
      "Sample B",
      "Sample C",
    ]);
    expect(response.body.sampleNames).toHaveLength(3); // Should remove duplicates

    expect(Sample.find).toHaveBeenCalledWith({ project: mockProjectId });
  });

  test("should filter out null and empty names", async () => {
    const mockSamples = [
      { _id: "1", name: "Sample A" },
      { _id: "2", name: null },
      { _id: "3", name: "" },
      { _id: "4", name: "   " }, // Whitespace only
      { _id: "5", name: "Sample B" },
    ];

    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSamples),
      }),
    });

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual(["Sample A", "Sample B"]);
    expect(response.body.sampleNames).toHaveLength(2);
  });

  test("should return empty array when no samples exist for project", async () => {
    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    });

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual([]);
  });

  test("should return empty array when all samples have null names", async () => {
    const mockSamples = [
      { _id: "1", name: null },
      { _id: "2", name: "" },
      { _id: "3", name: undefined },
    ];

    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSamples),
      }),
    });

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual([]);
  });

  test("should handle database errors gracefully", async () => {
    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error("Database error")),
      }),
    });

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(500);
  });

  test("should handle invalid project ID format", async () => {
    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error("Invalid ObjectId format")),
      }),
    });

    const response = await request(app).get("/samples/names/invalid-id");

    expect(response.status).toBe(500);
  });
});

describe("POST /samples/new - TPlex Mode", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("should create ONE sample with TPlex CSV array stored as CSV text", async () => {
    const tplexCsvData = [
      {
        name: "TPlex Sample 1",
        scientificName: "Arabidopsis thaliana",
        commonName: "Thale cress",
        ncbi: "3702",
        conditions: "Standard lab conditions at 25C",
      },
      {
        name: "TPlex Sample 2",
        scientificName: "Solanum lycopersicum",
        commonName: "Tomato",
        ncbi: "4081",
        conditions: "Greenhouse conditions",
      },
    ];

    const mockSavedSample = {
      _id: "sample-1",
      name: "TPlex_Arabidopsis_thaliana",
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation(() => mockSavedSample);

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("sample");
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
    // Check that tplexCsv is stored as CSV text (not JSON)
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        tplexCsv: expect.stringContaining(
          "name,scientificName,commonName,ncbi,conditions",
        ),
      }),
    );
  });

  test("should generate name from first row's scientificName if name is missing in TPlex", async () => {
    const tplexCsvData = [
      {
        name: "",
        scientificName: "Arabidopsis thaliana",
        commonName: "Thale cress",
        ncbi: "3702",
        conditions: "Standard lab conditions",
      },
      {
        name: "",
        scientificName: "Solanum lycopersicum",
        commonName: "Tomato",
        ncbi: "4081",
        conditions: "Greenhouse",
      },
    ];

    const mockSavedSample = {
      _id: "sample-1",
      name: "TPlex_Arabidopsis_thaliana",
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation((data) => {
      expect(data.name).toMatch(/TPlex_Arabidopsis_thaliana/);
      return mockSavedSample;
    });

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/TPlex_Arabidopsis_thaliana/),
      }),
    );
  });

  test("should generate name from first row's commonName if scientificName is missing", async () => {
    const tplexCsvData = [
      {
        name: "",
        scientificName: "",
        commonName: "Tomato",
        ncbi: "4081",
        conditions: "Greenhouse",
      },
    ];

    const mockSavedSample = {
      _id: "sample-1",
      name: "TPlex_Tomato",
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation((data) => {
      expect(data.name).toMatch(/TPlex_Tomato/);
      return mockSavedSample;
    });

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
  });

  test("should generate fallback name with timestamp if no names available in TPlex", async () => {
    const tplexCsvData = [
      {
        name: "",
        scientificName: "",
        commonName: "",
        ncbi: "1234",
        conditions: "Test conditions",
      },
    ];

    const mockSavedSample = {
      _id: "sample-1",
      name: "TPlex_Sample_123456",
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation((data) => {
      expect(data.name).toMatch(/TPlex_Sample_\d+/);
      return mockSavedSample;
    });

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
  });

  test("should store entire CSV array as CSV text format", async () => {
    const tplexCsvData = [
      {
        name: "Sample 1",
        scientificName: "Species 1",
        commonName: "Common 1",
        ncbi: "1",
        conditions: "Conditions 1",
      },
      {
        name: "Sample 2",
        scientificName: "Species 2",
        commonName: "Common 2",
        ncbi: "2",
        conditions: "Conditions 2",
      },
    ];

    const mockSavedSample = {
      _id: "sample-1",
      name: "TPlex_Species_1",
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation(() => mockSavedSample);

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        scientificName: null,
        commonName: null,
        ncbi: null,
        conditions: null,
        // CSV format includes header row and data rows
        tplexCsv: expect.stringContaining(
          "Sample 1,Species 1,Common 1,1,Conditions 1",
        ),
      }),
    );
  });
});

describe("POST /samples/new - Standard Mode", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("should create a single sample with all required fields", async () => {
    const sampleData = {
      name: "Test Sample",
      project: "project-123",
      scientificName: "Arabidopsis thaliana",
      commonName: "Thale cress",
      ncbi: "3702",
      conditions: "Standard lab conditions at 25C for 2 weeks",
      owner: "testuser",
      group: "group-123",
    };

    const mockSavedSample = {
      _id: "sample-1",
      ...sampleData,
      save: jest.fn().mockResolvedValue(this),
    };

    Sample.mockImplementation(() => mockSavedSample);

    const response = await request(app).post("/samples/new").send(sampleData);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("sample");
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        name: sampleData.name,
        scientificName: sampleData.scientificName,
        tplexCsv: null,
      }),
    );
  });

  test("should handle validation errors", async () => {
    const mockSavedSample = {
      save: jest.fn().mockRejectedValue({
        name: "ValidationError",
        message: "Validation failed",
      }),
    };

    Sample.mockImplementation(() => mockSavedSample);

    const response = await request(app).post("/samples/new").send({
      project: "project-123",
      group: "group-123",
      owner: "testuser",
      // Missing required fields
    });

    expect(response.status).toBe(400);
  });
});

describe("Integration: Sample Names Endpoint", () => {
  test("should return only names from samples, not from other fields", async () => {
    const mockSamples = [
      {
        _id: "1",
        name: "Sample A",
        scientificName: "Arabidopsis thaliana",
        commonName: "Thale cress",
      },
      {
        _id: "2",
        name: "Sample B",
        scientificName: "Solanum lycopersicum",
        commonName: "Tomato",
      },
    ];

    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSamples),
      }),
    });

    const response = await request(app).get(
      `/samples/names/${new mongoose.Types.ObjectId()}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual(["Sample A", "Sample B"]);
    expect(response.body.sampleNames).not.toContain("Arabidopsis thaliana");
    expect(response.body.sampleNames).not.toContain("Tomato");
  });

  test("should work with very large number of samples", async () => {
    const mockSamples = Array.from({ length: 1000 }, (_, i) => ({
      _id: `sample-${i}`,
      name: `Sample ${i}`,
    }));

    Sample.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSamples),
      }),
    });

    const response = await request(app).get(
      `/samples/names/${new mongoose.Types.ObjectId()}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toHaveLength(1000);
  });
});
