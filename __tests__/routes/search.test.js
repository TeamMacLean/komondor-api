/**
 * Tests for routes/search.js
 *
 * The searches are pushed into MongoDB, so the models are mocked at the
 * `iCanSee` boundary and the resulting query chain is asserted.
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../models/Project", () => ({ iCanSee: jest.fn() }));
jest.mock("../../models/Sample", () => ({ iCanSee: jest.fn() }));
jest.mock("../../models/Run", () => ({ iCanSee: jest.fn() }));

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "testuser", groups: ["g1"] };
    next();
  },
  isAdmin: (req, res, next) => next(),
}));

const Project = require("../../models/Project");
const Sample = require("../../models/Sample");
const Run = require("../../models/Run");
const searchRouter = require("../../routes/search");

const app = express();
app.use(express.json());
app.use("/", searchRouter);

/**
 * Builds a stub of the mongoose query chain used by searchByName, capturing
 * the regex the route applied.
 */
const makeQueryChain = (result, capture = {}) => {
  const chain = {
    where: jest.fn((field) => {
      capture.field = field;
      return chain;
    }),
    regex: jest.fn((re) => {
      capture.regex = re;
      return chain;
    }),
    populate: jest.fn((path) => {
      capture.populate = path;
      return chain;
    }),
    exec: jest.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  Project.iCanSee.mockReturnValue(makeQueryChain([]));
  Sample.iCanSee.mockReturnValue(makeQueryChain([]));
  Run.iCanSee.mockReturnValue(makeQueryChain([]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /search", () => {
  test("returns grouped results for all three entity types", async () => {
    Project.iCanSee.mockReturnValue(makeQueryChain([{ name: "proj" }]));
    Sample.iCanSee.mockReturnValue(makeQueryChain([{ name: "samp" }]));
    Run.iCanSee.mockReturnValue(makeQueryChain([{ name: "run" }]));

    const response = await request(app).get("/search").query({ query: "a" });

    expect(response.status).toBe(200);
    expect(response.body.results.projects).toEqual([{ name: "proj" }]);
    expect(response.body.results.samples).toEqual([{ name: "samp" }]);
    expect(response.body.results.runs).toEqual([{ name: "run" }]);
  });

  test("returns an empty array when no query is supplied", async () => {
    const response = await request(app).get("/search");

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(Project.iCanSee).not.toHaveBeenCalled();
  });

  test("returns an empty array for a whitespace-only query", async () => {
    const response = await request(app).get("/search").query({ query: "   " });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
  });

  test("scopes the search to the requesting user", async () => {
    await request(app).get("/search").query({ query: "a" });

    expect(Project.iCanSee).toHaveBeenCalledWith(
      expect.objectContaining({ username: "testuser" }),
    );
  });

  test("answers 500 when the combined search fails", async () => {
    Project.iCanSee.mockReturnValue(makeQueryChain(new Error("db down")));

    const response = await request(app).get("/search").query({ query: "a" });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("db down");
  });
});

describe("search matching", () => {
  test("matches case-insensitively", async () => {
    // The previous implementation compared a lowercased name against the raw
    // query, so any uppercase character made the search return nothing.
    const capture = {};
    Project.iCanSee.mockReturnValue(makeQueryChain([], capture));

    await request(app).get("/search/project").query({ query: "ABC" });

    expect(capture.regex.flags).toContain("i");
    expect("some-abc-name").toMatch(capture.regex);
  });

  test("matches a substring rather than the whole name", async () => {
    const capture = {};
    Project.iCanSee.mockReturnValue(makeQueryChain([], capture));

    await request(app).get("/search/project").query({ query: "bc" });

    expect("abcdef").toMatch(capture.regex);
  });

  test("escapes regex metacharacters in the query", async () => {
    const capture = {};
    Project.iCanSee.mockReturnValue(makeQueryChain([], capture));

    const response = await request(app)
      .get("/search/project")
      .query({ query: "a(b" });

    expect(response.status).toBe(200);
    // Matched literally, not as a regex group.
    expect("xxa(byy").toMatch(capture.regex);
    expect("ab").not.toMatch(capture.regex);
  });

  test("does not fail on a query of only metacharacters", async () => {
    const response = await request(app)
      .get("/search/project")
      .query({ query: "((((" });

    expect(response.status).toBe(200);
  });

  test("filters in the database rather than loading every record", async () => {
    const capture = {};
    Project.iCanSee.mockReturnValue(makeQueryChain([], capture));

    await request(app).get("/search/project").query({ query: "abc" });

    expect(capture.field).toBe("name");
    expect(capture.regex).toBeInstanceOf(RegExp);
  });

  test("ignores an over-long query", async () => {
    const response = await request(app)
      .get("/search/project")
      .query({ query: "a".repeat(201) });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(Project.iCanSee).not.toHaveBeenCalled();
  });

  test("uses the first value when the query parameter is repeated", async () => {
    const response = await request(app).get("/search/project?query=ab&query=cd");

    expect(response.status).toBe(200);
    expect(Project.iCanSee).toHaveBeenCalled();
  });
});

describe.each([
  ["/search/project", () => Project],
  ["/search/sample", () => Sample],
  ["/search/run", () => Run],
])("GET %s", (path, getModel) => {
  test("returns matching results", async () => {
    getModel().iCanSee.mockReturnValue(makeQueryChain([{ name: "hit" }]));

    const response = await request(app).get(path).query({ query: "hit" });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ name: "hit" }]);
  });

  test("returns an empty array with no query", async () => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
  });

  test("answers 200 with an empty result set and an error detail on failure", async () => {
    // Existing consumers rely on 200 here; the error field makes the failure
    // visible rather than indistinguishable from "no matches".
    getModel().iCanSee.mockReturnValue(makeQueryChain(new Error("db down")));

    const response = await request(app).get(path).query({ query: "hit" });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(response.body.error).toBe("db down");
  });
});
