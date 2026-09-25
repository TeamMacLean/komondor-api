/**
 * Tests for /routes/samples.js
 * Tests the samples API endpoints including:
 * - GET /samples
 * - GET /sample?id=:id (critical for pre-existing entity feature)
 * - GET /samples/names/:projectId
 * - POST /samples/new (standard and TPlex)
 *
 * Several tests here previously asserted behaviour that has since been fixed:
 * a malformed id reaching the database as a cast error, an admin authorised by
 * a `user.isAdmin` short-circuit rather than by their group list, and a sample
 * whose group came from the request body. Those assertions are updated in place
 * rather than removed, and each says what changed.
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
const {
  sortAdditionalFiles: mockSortAdditionalFiles,
} = require("../../lib/sortAssociatedFiles");
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
  storageReadOnlyResponse: jest.fn((res, project) =>
    res.status(409).json({
      error:
        "This project's data storage is read-only; new data cannot be added to it.",
      detail: `Project storage is read-only (${project.storage.state})`,
      code: "PROJECT_STORAGE_READ_ONLY",
      projectId: String(project._id),
      storageState: project.storage.state,
    }),
  ),
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

/** Shapes a group id the way Group.find would hand it back. */
const asGroup = (id) => ({ _id: { toString: () => id }, name: `group-${id}` });

/**
 * Group.GroupsIAmIn is where both capabilities come from, so the mock has to
 * honour `mode`. A mock that returns the same list for "read" and "write"
 * cannot tell a cross-group reader from someone who may actually create
 * records, which is the distinction these routes now depend on.
 */
const grantGroups = ({ read = [], write = [] }) => {
  Group.GroupsIAmIn.mockImplementation(async (user, options) => {
    const mode = (options && options.mode) || "read";
    return (mode === "write" ? write : read).map(asGroup);
  });
};

/** Builds the populate/exec chain Sample.findById is used through. */
const findByIdChain = (exec) => {
  const chain = { exec };
  chain.populate = jest.fn(() => chain);
  return chain;
};

/** Makes Sample.findById resolve (or reject) at the end of its populate chain. */
const mockSampleFindById = (exec) => {
  Sample.findById = jest.fn(() => findByIdChain(exec));
};

/** Makes Sample.find resolve at the end of its select/exec chain. */
const mockSampleFind = (exec) => {
  Sample.find = jest.fn(() => ({ select: jest.fn(() => ({ exec })) }));
};

/** Makes Sample.findOne resolve at the end of its populate chain. */
const mockSampleFindOne = (result) => {
  Sample.findOne = jest.fn(() => ({
    populate: jest.fn().mockResolvedValue(result),
  }));
};

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
    // Default: the user may both read and write the sample's group.
    grantGroups({ read: [mockGroupId], write: [mockGroupId] });
  });

  describe("successful retrieval", () => {
    test("should return sample with group info when ID is valid and user has permission", async () => {
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
      expect(response.body.sample.name).toBe("Test Sample");
      expect(response.body.sample.group.name).toBe("bioinformatics");
      expect(response.body.sample.project.name).toBe("Test Project");
      expect(response.body).toHaveProperty("actualAdditionalFiles");
    });

    test("should return sample when user is admin regardless of group membership", async () => {
      // UPDATED: this used to mock GroupsIAmIn as [] and rely on the route's
      // own `if (user.isAdmin) return true` short-circuit. That short-circuit is
      // gone — an admin's authority is expressed by GroupsIAmIn handing them
      // every group, so a soft-deleted group stops authorising them too. An
      // admin therefore never sees [] for a live group.
      mockUser = {
        username: "adminuser",
        groups: [],
        isAdmin: true,
      };

      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));
      grantGroups({ read: [mockGroupId], write: [mockGroupId] });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
    });

    test("should refuse the sample's owner when they cannot read its group", async () => {
      // UPDATED: this used to assert a 200. The check read
      // `if (!canAccess && !isOwner)`, so a caller in none of the sample's
      // groups still got the record whenever the `owner` string matched their
      // username — a read grant that removing them from the group could not
      // withdraw, on a field copied verbatim out of req.body until this branch.
      mockUser = {
        username: "testuser", // matches mockSample.owner
        groups: [],
        isAdmin: false,
      };

      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));
      grantGroups({ read: ["some_other_group_id"], write: [] });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/permission/i);
    });

    test("the authorisation decision never reads the sample's owner field", async () => {
      // A second angle on the removal above, shaped differently on purpose:
      // that test asserts the answer, this one asserts the *inputs* to the
      // answer. `owner` is not one of them, so any re-introduced clause is
      // caught by the read itself rather than by the status code — and the two
      // tests therefore fail independently.
      let ownerReads = 0;
      const sample = { ...mockSample };
      delete sample.owner;
      Object.defineProperty(sample, "owner", {
        enumerable: true,
        configurable: true,
        get() {
          ownerReads += 1;
          return "testuser"; // the caller, so a restored clause would match
        },
      });

      mockUser = { username: "testuser", groups: [], isAdmin: false };
      mockSampleFindById(jest.fn().mockResolvedValue(sample));
      grantGroups({ read: ["some_other_group_id"], write: [] });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(ownerReads).toBe(0);
      expect(response.status).toBe(403);
    });

    test("should include populated group with _id and name fields", async () => {
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body.sample.group).toHaveProperty("_id");
      expect(response.body.sample.group).toHaveProperty("name");
      expect(response.body.sample.group.name).toBe("bioinformatics");
    });

    test("should include populated project info", async () => {
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

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

      mockSampleFindById(jest.fn().mockResolvedValue(sampleWithRuns));

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
      mockSampleFindById(jest.fn().mockResolvedValue(null));

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 403 when user does not belong to sample group", async () => {
      mockSampleFindById(
        jest.fn().mockResolvedValue({ ...mockSample, owner: "someone-else" }),
      );

      // User belongs to different group
      grantGroups({
        read: ["different-group-id"],
        write: ["different-group-id"],
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toMatch(/permission/i);
    });

    test("should return 500 when database error occurs", async () => {
      mockSampleFindById(
        jest.fn().mockRejectedValue(new Error("Database error")),
      );

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(500);
    });

    test("should reject an invalid ObjectId format before it reaches the database", async () => {
      // UPDATED: this used to expect 500, i.e. the malformed value was handed
      // to mongoose and the cast error surfaced as a server fault. A malformed
      // id is a bad request, and refusing it at the boundary is what keeps a
      // non-string value out of the query in the first place.
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

      const response = await request(app).get("/sample?id=invalid-id-format");

      expect(response.status).toBe(400);
      expect(Sample.findById).not.toHaveBeenCalled();
    });

    test("should reject a query operator supplied as the sample ID", async () => {
      // REGRESSION: `?id[$ne]=` is parsed by express into { id: { $ne: "" } },
      // and mongoose 5 casting preserves the operator — findById would have
      // matched an arbitrary sample from any group and returned it populated.
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

      const response = await request(app).get("/sample?id[$ne]=");

      expect(response.status).toBe(400);
      expect(Sample.findById).not.toHaveBeenCalled();
    });
  });

  describe("multi-group user access", () => {
    test("should allow access when user belongs to multiple groups including sample group", async () => {
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

      // User belongs to multiple groups, one of which matches
      grantGroups({
        read: ["other-group", mockGroupId, "third-group"],
        write: ["other-group", mockGroupId, "third-group"],
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("sample");
    });

    test("should deny access when user belongs to multiple groups but none match sample group", async () => {
      mockSampleFindById(
        jest.fn().mockResolvedValue({ ...mockSample, owner: "someone-else" }),
      );

      // User belongs to multiple groups, none of which match
      grantGroups({
        read: ["group-a", "group-b"],
        write: ["group-a", "group-b"],
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(403);
    });
  });

  describe("pre-existing entity feature support", () => {
    test("should return sample with all fields needed for CSV validation", async () => {
      mockSampleFindById(jest.fn().mockResolvedValue(mockSample));

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
        owner: "someone-else",
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

      mockSampleFindById(jest.fn().mockResolvedValue(sampleWithDifferentGroup));

      // User belongs to sample's group only
      grantGroups({
        read: ["sample-specific-group"],
        write: ["sample-specific-group"],
      });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      // Should succeed because permission is checked against sample.group, not project.group
      expect(response.status).toBe(200);
      expect(response.body.sample.group.name).toBe("sample-group");
    });
  });

  describe("read and write capabilities are not the same thing", () => {
    test("a cross-group reader may view a sample they could not create", async () => {
      // FULL_RECORDS_ACCESS_USERS read every group but write only their own.
      mockUser = { username: "enaadmin", groups: [], isAdmin: false };

      mockSampleFindById(
        jest.fn().mockResolvedValue({ ...mockSample, owner: "someone-else" }),
      );
      grantGroups({ read: [mockGroupId], write: [] });

      const response = await request(app).get(`/sample?id=${mockSampleId}`);

      expect(response.status).toBe(200);
      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
        expect.objectContaining({ username: "enaadmin" }),
        { mode: "read" },
      );
    });
  });
});

describe("GET /samples", () => {
  // The list endpoint had no test at all, so the one line that scopes it —
  // `const groupIds = await visibleGroupIds(req.user)` — was unwatched:
  // replacing it with `null`, which means "no filter, every sample in every
  // group", kept the whole suite green.
  const ORIGINAL_FULL_ACCESS = process.env.FULL_RECORDS_ACCESS_USERS;

  /** Stubs Sample.iCanSee(...).populate().sort().exec(). */
  const mockICanSee = (samples) => {
    const chain = {
      populate: jest.fn(() => chain),
      sort: jest.fn(() => chain),
      exec: jest.fn().mockResolvedValue(samples),
    };
    Sample.iCanSee = jest.fn(() => chain);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { username: "testuser", groups: ["group-123"], isAdmin: false };
    // visibleGroupIds short-circuits to null for a full-access user, so the
    // list has to be empty for this to exercise the ordinary path.
    process.env.FULL_RECORDS_ACCESS_USERS = "[]";
  });

  afterEach(() => {
    if (ORIGINAL_FULL_ACCESS === undefined) {
      delete process.env.FULL_RECORDS_ACCESS_USERS;
    } else {
      process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL_FULL_ACCESS;
    }
  });

  test("should return the samples the caller may see, newest first", async () => {
    const samples = [{ _id: "1", name: "Sample A" }];
    const chain = mockICanSee(samples);
    grantGroups({ read: ["group-123"], write: [] });

    const response = await request(app).get("/samples");

    expect(response.status).toBe(200);
    expect(response.body.samples).toEqual(samples);
    // The cards render the group name, and the list is presented newest first.
    expect(chain.populate).toHaveBeenCalledWith("group");
    expect(chain.sort).toHaveBeenCalledWith("-createdAt");
  });

  test("should scope the query to the group ids resolved from the database", async () => {
    // Not the `groups` claim on the token: that is only as fresh as the token,
    // and a group soft-deleted since login must stop being visible here too.
    const liveGroupId = new mongoose.Types.ObjectId().toString();
    mockICanSee([]);
    grantGroups({ read: [liveGroupId], write: [] });

    const response = await request(app).get("/samples");

    expect(response.status).toBe(200);
    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(mockUser, { mode: "read" });
    const [user, groupIds] = Sample.iCanSee.mock.calls[0];
    expect(user).toBe(mockUser);
    expect(groupIds.map(String)).toEqual([liveGroupId]);
  });

  test("should pass an empty list, not null, for a caller in no live group", async () => {
    // [] means "belongs to nothing, match nothing"; null means "no filter at
    // all". They are opposites, and conflating them makes a groupless caller a
    // reader of every group.
    mockICanSee([]);
    grantGroups({ read: [], write: [] });

    const response = await request(app).get("/samples");

    expect(response.status).toBe(200);
    expect(Sample.iCanSee).toHaveBeenCalledWith(mockUser, []);
  });
});

describe("GET /samples/names/:projectId", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    // Reset mock user and Group mock for these tests
    mockUser = {
      username: "testuser",
      groups: ["group-123"],
      isAdmin: false,
    };
    grantGroups({ read: [mockGroupId], write: [mockGroupId] });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: mockProjectId, group: mockGroupId });
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

    mockSampleFind(jest.fn().mockResolvedValue(mockSamples));

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

    mockSampleFind(jest.fn().mockResolvedValue(mockSamples));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual(["Sample A", "Sample B"]);
    expect(response.body.sampleNames).toHaveLength(2);
  });

  test("should return empty array when no samples exist for project", async () => {
    mockSampleFind(jest.fn().mockResolvedValue([]));

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

    mockSampleFind(jest.fn().mockResolvedValue(mockSamples));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toEqual([]);
  });

  test("should handle database errors gracefully", async () => {
    mockSampleFind(jest.fn().mockRejectedValue(new Error("Database error")));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(500);
  });

  test("should reject an invalid project ID format", async () => {
    // UPDATED: this used to expect 500 — the malformed id was passed to
    // mongoose and the cast error became a server fault. It is a bad request.
    mockSampleFind(jest.fn().mockResolvedValue([]));

    const response = await request(app).get("/samples/names/invalid-id");

    expect(response.status).toBe(400);
    expect(Sample.find).not.toHaveBeenCalled();
  });

  test("should return 404 when the project does not exist", async () => {
    Project.findById = jest.fn().mockResolvedValue(null);
    mockSampleFind(jest.fn().mockResolvedValue([]));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(404);
    expect(Sample.find).not.toHaveBeenCalled();
  });

  test("should refuse to list names from a project the caller cannot read", async () => {
    // This endpoint returns every sample name in the project, not only the
    // caller's own, so it leaked names across groups to any authenticated user.
    grantGroups({ read: ["another-group"], write: ["another-group"] });
    mockSampleFind(jest.fn().mockResolvedValue([{ _id: "1", name: "Secret" }]));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(403);
    expect(Sample.find).not.toHaveBeenCalled();
  });
});

describe("POST /samples/new - TPlex Mode", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  const groupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    mockUser = {
      username: "testuser",
      groups: [groupId],
      isAdmin: false,
    };
    grantGroups({ read: [groupId], write: [groupId] });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: projectId, group: groupId });
    // Mock findOne for idempotency check (return null = no existing sample)
    mockSampleFindOne(null);
  });

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
      project: projectId,
      group: groupId,
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
      project: projectId,
      group: groupId,
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
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
  });

  test("should fall back to the row's own name column", async () => {
    const tplexCsvData = [
      {
        name: "Row Name",
        scientificName: "",
        commonName: "",
        ncbi: "1234",
        conditions: "Test conditions",
      },
    ];

    Sample.mockImplementation((data) => {
      expect(data.name).toBe("TPlex_Row_Name");
      return { _id: "sample-1", save: jest.fn().mockResolvedValue(this) };
    });

    const response = await request(app).post("/samples/new").send({
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
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
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledTimes(1); // Only one sample created
  });

  test("should not throw when a name column arrives as a number", async () => {
    // `.trim()` on a number used to throw a TypeError and surface as a 500.
    const tplexCsvData = [
      {
        name: 42,
        scientificName: 7,
        commonName: null,
        ncbi: "1",
        conditions: "x",
      },
    ];

    Sample.mockImplementation((data) => {
      expect(data.name).toMatch(/TPlex_Sample_\d+/);
      return { _id: "sample-1", save: jest.fn().mockResolvedValue(this) };
    });

    const response = await request(app).post("/samples/new").send({
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
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
      project: projectId,
      group: groupId,
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

  test("should quote and escape values containing commas and quotes", async () => {
    const tplexCsvData = [
      {
        scientificName: "Species 1",
        conditions: 'Grown at 25C, then "chilled"',
      },
    ];

    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app).post("/samples/new").send({
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        tplexCsv: expect.stringContaining(
          'Species 1,"Grown at 25C, then ""chilled"""',
        ),
      }),
    );
  });

  test("should neutralise values a spreadsheet would execute as a formula", async () => {
    const tplexCsvData = [
      {
        scientificName: "Species 1",
        "=evilHeader": "harmless",
        conditions: "=cmd|'/C calc'!A0",
        commonName: "@SUM(1+1)",
      },
    ];

    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app).post("/samples/new").send({
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);

    const stored = Sample.mock.calls[0][0].tplexCsv;
    // The payload survives as text, prefixed so the cell is not evaluated...
    expect(stored).toContain(`"'=cmd|'/C calc'!A0"`);
    expect(stored).toContain(`"'@SUM(1+1)"`);
    // ...and a header is just as executable as a value.
    expect(stored).toContain(`"'=evilHeader"`);
    // Nothing is left starting with a bare formula character.
    stored.split("\r\n").forEach((line) => {
      line.split(",").forEach((field) => {
        expect(field.startsWith("=")).toBe(false);
        expect(field.startsWith("@")).toBe(false);
      });
    });
  });

  test("should leave plain negative numbers alone", async () => {
    // "-80" is a storage temperature, not a formula. Escaping it as text would
    // break every consumer that reads the column as numeric.
    const tplexCsvData = [
      { scientificName: "Species 1", conditions: "-80", ncbi: "+4" },
    ];

    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app).post("/samples/new").send({
      project: projectId,
      group: groupId,
      owner: "testuser",
      tplexCsv: tplexCsvData,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({
        tplexCsv: expect.stringContaining("Species 1,-80,+4"),
      }),
    );
  });

  test("should reject TPlex rows that are not objects", async () => {
    const response = await request(app)
      .post("/samples/new")
      .send({
        project: projectId,
        group: groupId,
        owner: "testuser",
        tplexCsv: ["not-an-object"],
      });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });
});

describe("POST /samples/new - Standard Mode", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  const groupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    mockUser = {
      username: "testuser",
      groups: [groupId],
      isAdmin: false,
    };
    grantGroups({ read: [groupId], write: [groupId] });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: projectId, group: groupId });
    // Mock findOne for idempotency check (return null = no existing sample)
    mockSampleFindOne(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("refuses an archived project before idempotency or file work", async () => {
    const now = new Date();
    Project.findById.mockResolvedValue({
      _id: projectId,
      group: groupId,
      storage: {
        state: "aws",
        s3Uri: "s3://archive/data/group/project",
        s3VerifiedAt: now,
        hpcVerifiedAbsentAt: now,
        archivedAt: now,
      },
    });

    const response = await request(app).post("/samples/new").send({
      name: "Too late",
      project: projectId,
      scientificName: "Arabidopsis thaliana",
      commonName: "Thale cress",
      ncbi: "3702",
      conditions: "Archived",
      group: groupId,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "PROJECT_STORAGE_READ_ONLY",
      storageState: "aws",
    });
    expect(Sample.findOne).not.toHaveBeenCalled();
    expect(mockSortAdditionalFiles).not.toHaveBeenCalled();
  });

  test("should create a single sample with all required fields", async () => {
    const sampleData = {
      name: "Test Sample",
      project: projectId,
      scientificName: "Arabidopsis thaliana",
      commonName: "Thale cress",
      ncbi: "3702",
      conditions: "Standard lab conditions at 25C for 2 weeks",
      owner: "testuser",
      group: groupId,
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
      project: projectId,
      group: groupId,
      owner: "testuser",
      // Missing required fields
    });

    expect(response.status).toBe(400);
  });

  test("should store the group taken from the parent project", async () => {
    // The submitted group is only ever checked; the stored one is derived.
    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      scientificName: "Arabidopsis thaliana",
      commonName: "Thale cress",
      ncbi: "3702",
      conditions: "Standard",
      owner: "testuser",
      group: groupId,
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({ group: groupId, project: projectId }),
    );
  });

  test("should stamp the owner from the session, ignoring the body's claim", async () => {
    // `owner` used to be copied straight out of req.body, and GET /sample
    // grants read access on `sample.owner === req.user.username` — so naming
    // somebody else there handed them a sample in a group they may never have
    // been in.
    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "somebody-else",
    });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "testuser" }),
    );
  });

  test("should stamp the owner from the session even for an operator body", async () => {
    // The type guard on body.owner is gone because the value is no longer
    // used; this proves an operator object cannot reach the document.
    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));

    const response = await request(app)
      .post("/samples/new")
      .send({
        name: "Test Sample",
        project: projectId,
        group: groupId,
        owner: { $ne: null },
      });

    expect(response.status).toBe(201);
    expect(Sample).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "testuser" }),
    );
  });

  test("passes the acting username through to the file claim", async () => {
    // Claiming a staged upload is checked against the tus sidecar's recorded
    // owner. Without this argument every local-filesystem claim is refused as
    // belonging to 'undefined'.
    Sample.mockImplementation(() => ({
      _id: "sample-1",
      path: "/group/project/sample",
      save: jest.fn().mockResolvedValue(this),
    }));

    await request(app)
      .post("/samples/new")
      .send({
        name: "Test Sample",
        project: projectId,
        group: groupId,
        additionalFiles: [{ id: "upload-1" }],
      });

    const { sortAdditionalFiles } = require("../../lib/sortAssociatedFiles");
    const [files, parentType, , , username] = sortAdditionalFiles.mock.calls[0];
    expect(files).toEqual([{ id: "upload-1" }]);
    expect(parentType).toBe("sample");
    expect(username).toBe("testuser");
  });

  test("should return 404 when the parent project does not exist", async () => {
    Project.findById = jest.fn().mockResolvedValue(null);

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(404);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should return 400 when the group is missing", async () => {
    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      owner: "testuser",
    });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should return 400 when the project is missing", async () => {
    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });
});

describe("POST /samples/new - ENA administrators", () => {
  const usernames = ["deeks", "macleand", "taz23vul", "admin", "kun24dup"];
  const projectId = new mongoose.Types.ObjectId().toString();
  const groupId = new mongoose.Types.ObjectId().toString();
  const otherGroupId = new mongoose.Types.ObjectId().toString();
  const sampleBody = {
    name: "Admin-created sample",
    project: projectId,
    group: groupId,
    owner: "somebody-else",
    scientificName: "Arabidopsis thaliana",
  };
  let previousEnaAdmins;

  beforeEach(() => {
    jest.clearAllMocks();
    previousEnaAdmins = process.env.ENA_ADMINS;
    process.env.ENA_ADMINS = "['deeks', 'macleand', 'taz23vul', 'admin', 'kun24dup']";
    mockUser = { username: "deeks", groups: [], isAdmin: false };
    grantGroups({ read: [otherGroupId, groupId], write: [] });
    Project.findById = jest.fn().mockResolvedValue({
      _id: projectId,
      group: groupId,
    });
    mockSampleFindOne(null);
    Sample.mockImplementation((data) => {
      const sample = { _id: "admin-sample-id", ...data };
      sample.save = jest.fn().mockResolvedValue(sample);
      return sample;
    });
  });

  afterEach(() => {
    if (previousEnaAdmins === undefined) delete process.env.ENA_ADMINS;
    else process.env.ENA_ADMINS = previousEnaAdmins;
    jest.clearAllMocks();
  });

  test.each(usernames)(
    "allows %s to create in a parent project's group without membership",
    async (username) => {
      mockUser = { username, groups: [], isAdmin: false };

      const response = await request(app).post("/samples/new").send(sampleBody);

      expect(response.status).toBe(201);
      expect(response.body.sample).toMatchObject({
        project: projectId,
        group: groupId,
        owner: username,
      });
      expect(Group.GroupsIAmIn).toHaveBeenCalledWith(mockUser, { mode: "read" });
    },
  );

  test("still refuses a group that does not own the parent project", async () => {
    const response = await request(app)
      .post("/samples/new")
      .send({ ...sampleBody, group: otherGroupId });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("still refuses creation in an archived project", async () => {
    const now = new Date();
    Project.findById.mockResolvedValue({
      _id: projectId,
      group: groupId,
      storage: {
        state: "aws",
        s3Uri: "s3://archive/data/group/project",
        s3VerifiedAt: now,
        hpcVerifiedAbsentAt: now,
        archivedAt: now,
      },
    });

    const response = await request(app).post("/samples/new").send(sampleBody);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PROJECT_STORAGE_READ_ONLY");
    expect(Sample.findOne).not.toHaveBeenCalled();
    expect(Sample).not.toHaveBeenCalled();
  });
});

describe("POST /samples/new - injection and authorisation", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  const groupId = new mongoose.Types.ObjectId().toString();
  const otherGroupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    mockUser = {
      username: "testuser",
      groups: [groupId],
      isAdmin: false,
    };
    grantGroups({ read: [groupId], write: [groupId] });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: projectId, group: groupId });
    mockSampleFindOne(null);
    Sample.mockImplementation(() => ({
      _id: "sample-1",
      save: jest.fn().mockResolvedValue(this),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should refuse a project of {"$ne": null} instead of running the query', async () => {
    // REGRESSION (Gate 1 item 3): mongoose 5 casting preserves operators, so
    // `Sample.findOne({ project: { $ne: null }, name })` matched the first
    // sample with that name in ANY group and the handler returned it populated,
    // before any ownership check ran.
    const response = await request(app)
      .post("/samples/new")
      .send({
        name: "Known Sample Name",
        project: { $ne: null },
        group: groupId,
        owner: "testuser",
      });

    expect(response.status).toBe(400);
    expect(Sample.findOne).not.toHaveBeenCalled();
    expect(Project.findById).not.toHaveBeenCalled();
    expect(Sample).not.toHaveBeenCalled();
  });

  test('should refuse a name of {"$ne": null}', async () => {
    const response = await request(app)
      .post("/samples/new")
      .send({
        name: { $ne: null },
        project: projectId,
        group: groupId,
        owner: "testuser",
      });

    expect(response.status).toBe(400);
    expect(Sample.findOne).not.toHaveBeenCalled();
  });

  test('should refuse a group of {"$ne": null}', async () => {
    const response = await request(app)
      .post("/samples/new")
      .send({
        name: "Test Sample",
        project: projectId,
        group: { $ne: null },
        owner: "testuser",
      });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should refuse a 12-character non-hex id that ObjectId.isValid accepts", async () => {
    // ObjectId.isValid("project-1234") is true — it casts the 12 bytes into an
    // id — so the hex test is what actually rejects a malformed value.
    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: "project-1234",
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(400);
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test("should refuse to attach a sample to another group's project", async () => {
    // The caller may write in their own group, and names it in the body, but
    // the parent project belongs to a group they are not in. The group is taken
    // from the project, so this is refused rather than silently accepted.
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: projectId, group: otherGroupId });

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(403);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should refuse a group that does not own the submitted project even when the caller can write both", async () => {
    // Same shape, but the caller is a member of both groups: the request is
    // still inconsistent, and answering it would store a group the project does
    // not belong to.
    grantGroups({
      read: [groupId, otherGroupId],
      write: [groupId, otherGroupId],
    });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: projectId, group: otherGroupId });

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(400);
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should refuse creation to a cross-group reader who cannot write", async () => {
    // FULL_RECORDS_ACCESS_USERS read every group; that must not let them create
    // records in a group they do not belong to.
    mockUser = { username: "enaadmin", groups: [], isAdmin: false };
    grantGroups({ read: [groupId], write: [] });

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "enaadmin",
    });

    expect(response.status).toBe(403);
    expect(Sample).not.toHaveBeenCalled();
    expect(Group.GroupsIAmIn).toHaveBeenCalledWith(
      expect.objectContaining({ username: "enaadmin" }),
      { mode: "write" },
    );
  });

  test("should return an existing sample the caller may read", async () => {
    mockSampleFindOne({
      _id: "existing-1",
      name: "Test Sample",
      group: groupId,
    });

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(200);
    expect(response.body.idempotent).toBe(true);
    expect(response.body.sample._id).toBe("existing-1");
    expect(Sample).not.toHaveBeenCalled();
  });

  test("should not return an existing sample from a group the caller cannot read", async () => {
    // The idempotency lookup used to return whatever it found, unconditionally.
    // A sample whose own group differs from its project's group must still be
    // authorised on its own group before it is handed back.
    mockSampleFindOne({
      _id: "existing-1",
      name: "Test Sample",
      group: otherGroupId,
      conditions: "secret",
    });

    const response = await request(app).post("/samples/new").send({
      name: "Test Sample",
      project: projectId,
      group: groupId,
      owner: "testuser",
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/permission/i);
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});

describe("Integration: Sample Names Endpoint", () => {
  const mockProjectId = new mongoose.Types.ObjectId().toString();
  const mockGroupId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    mockUser = {
      username: "testuser",
      groups: [mockGroupId],
      isAdmin: false,
    };
    grantGroups({ read: [mockGroupId], write: [mockGroupId] });
    Project.findById = jest
      .fn()
      .mockResolvedValue({ _id: mockProjectId, group: mockGroupId });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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

    mockSampleFind(jest.fn().mockResolvedValue(mockSamples));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

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

    mockSampleFind(jest.fn().mockResolvedValue(mockSamples));

    const response = await request(app).get(`/samples/names/${mockProjectId}`);

    expect(response.status).toBe(200);
    expect(response.body.sampleNames).toHaveLength(1000);
  });
});
