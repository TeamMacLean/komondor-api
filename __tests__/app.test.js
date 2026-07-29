/**
 * Tests for app.js — the request-level plumbing every route inherits:
 * token handling, the 404 handler and the terminal error handler.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret-for-app-tests";

// The route modules pull in mongoose models at import time; the app-level
// behaviour under test never reaches them.
jest.mock("../lib/ldap", () => ({
  authenticate: jest.fn(),
  verifyUserExists: jest.fn(),
  escapeLdapFilterValue: (v) => v,
}));

const app = require("../app");

const sign = (payload, options) =>
  jwt.sign(payload, process.env.JWT_SECRET, options);

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("health check", () => {
  test("responds without authentication", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("token handling", () => {
  test("allows an anonymous request through to the route", async () => {
    // No Authorization header at all: req.user stays unset and the route's own
    // isAuthenticated gate decides.
    const response = await request(app).get("/projects");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  test("answers 401 for an expired token", async () => {
    // Previously the rejection reached next(err) with no error handler
    // registered, so a stale token surfaced as a 500 and looked like an outage.
    const token = sign({ username: "alice" }, { expiresIn: "-1s" });

    const response = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/Invalid or expired/);
  });

  test("answers 401 for a malformed token", async () => {
    const response = await request(app)
      .get("/projects")
      .set("Authorization", "Bearer not-a-real-token");

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/Invalid or expired/);
  });

  test("answers 401 for a token signed with the wrong secret", async () => {
    const token = jwt.sign({ username: "alice" }, "some-other-secret");

    const response = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  test("ignores a non-bearer Authorization header", async () => {
    const response = await request(app)
      .get("/projects")
      .set("Authorization", "Basic dXNlcjpwYXNz");

    // Treated as anonymous rather than as an error.
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  test("returns JSON, never an HTML error page", async () => {
    const token = sign({ username: "alice" }, { expiresIn: "-1s" });

    const response = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${token}`);

    expect(response.headers["content-type"]).toMatch(/json/);
  });
});

describe("404 handling", () => {
  test("answers 404 with JSON for an unknown path", async () => {
    const response = await request(app).get("/no-such-endpoint");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body.error).toBe("Not found");
  });

  test("names the method and path in the detail", async () => {
    const response = await request(app).post("/no-such-endpoint");

    expect(response.status).toBe(404);
    expect(response.body.detail).toContain("POST");
    expect(response.body.detail).toContain("/no-such-endpoint");
  });
});

describe("malformed request bodies", () => {
  test("answers 400 with JSON rather than an HTML parse error", async () => {
    const response = await request(app)
      .post("/accessions/new")
      .set("Content-Type", "application/json")
      .send("{ this is not json ");

    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body.error).toBeDefined();
    expect(response.body.requestId).toBeDefined();
  });
});
