/**
 * Tests for /routes/samples.js
 * Tests the samples API endpoints including:
 * - GET /samples
 * - GET /sample?id=:id
 * - GET /samples/names/:projectId
 * - POST /samples/new (standard and TPlex)
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const Sample = require("../../models/Sample");
const Project = require("../../models/Project");
const samplesRouter = require("../../routes/samples");

// Mock dependencies
jest.mock("../../models/Sample");
jest.mock("../../models/Project");
jest.mock("../../lib/sortAssociatedFiles", () => ({
  sortAdditionalFiles: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../lib/utils/sendOverseerEmail", () =>
  jest.fn().mockResolvedValue(true),
);
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = {
      username: "testuser",
      groups: ["group1"],
    };
    next();
  },
}));

// Create test app
const app = express();
app.use(express.json());
app.use("/", samplesRouter);

describe("GET /samples/names/:projectId", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();

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

  test("should create ONE sample with TPlex CSV array stored as metadata", async () => {
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
      tplexCsv: JSON.stringify(tplexCsvData),
      save: jest.fn().mockResolvedValue(true),
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
    expect(response.body.sample._id).toBe("sample-1");
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        tplexCsv: JSON.stringify(tplexCsvData),
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
      tplexCsv: JSON.stringify(tplexCsvData),
      save: jest.fn().mockResolvedValue(true),
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
        tplexCsv: JSON.stringify(tplexCsvData),
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
      tplexCsv: JSON.stringify(tplexCsvData),
      save: jest.fn().mockResolvedValue(true),
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
      tplexCsv: JSON.stringify(tplexCsvData),
      save: jest.fn().mockResolvedValue(true),
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

  test("should store entire CSV array as stringified metadata", async () => {
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
      save: jest.fn().mockResolvedValue(true),
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
        tplexCsv: JSON.stringify(tplexCsvData),
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
      save: jest.fn().mockResolvedValue(true),
    };

    Sample.mockImplementation(() => mockSavedSample);

    const response = await request(app).post("/samples/new").send(sampleData);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("sample");
    expect(response.body.sample).toHaveProperty("_id");
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
