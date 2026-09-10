/**
 * Tests for app.js — the request-level plumbing every route inherits:
 * token handling, the probes, the 404 handler and the terminal error handler.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret-for-app-tests";

// A real directory to point the mount checks at. Nothing is written to it —
// /ready only asks whether it can be read and written.
const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), "komondor-app-ready-"));
const readOnlyHpc = path.join(mountRoot, "read-only-hpc");
fs.mkdirSync(readOnlyHpc, { mode: 0o500 });

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const testUnlessRoot = isRoot ? test.skip : test;

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

// Registered once, because there is no way to unregister a probe. Tests that
// care about it move the result; everything else gets the passing default.
let probeResult = { ok: true, detail: "fine" };
app.registerReadinessCheck("test-probe", () => {
  if (probeResult instanceof Error) {
    throw probeResult;
  }
  return probeResult;
});

/** Puts /ready's dependencies in the state where every check passes. */
const makeEverythingReady = () => {
  mongoose.connection.readyState = 1;
  process.env.DATASTORE_ROOT = mountRoot;
  process.env.HPC_TRANSFER_DIRECTORY = mountRoot;
  // Read through lib/utils/uploadPath.js, which falls back to <cwd>/files.
  // Pinned so the probe is not answering questions about the checkout.
  process.env.UPLOAD_DIRECTORY = mountRoot;
  probeResult = { ok: true, detail: "fine" };
  app.setDraining(false);
};

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  makeEverythingReady();
});

afterEach(() => {
  jest.restoreAllMocks();
  // Left as it was found: mongoose's connection object is shared with any
  // other module this process has loaded.
  mongoose.connection.readyState = 0;
  app.setDraining(false);
});

afterAll(() => {
  fs.chmodSync(readOnlyHpc, 0o700);
  fs.rmSync(mountRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIRECTORY;
});

describe("liveness probe", () => {
  test("responds without authentication", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  test("stays 200 with the database down", async () => {
    // Liveness answers "is this process running", nothing else. Failing it on
    // a Mongo outage would have the supervisor restart a process whose restart
    // cannot bring Mongo back.
    mongoose.connection.readyState = 0;

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
  });

  test("stays 200 with a mount missing", async () => {
    process.env.DATASTORE_ROOT = path.join(mountRoot, "gone");

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
  });
});

describe("readiness probe", () => {
  test("answers 200 when every dependency is usable", async () => {
    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.failed).toEqual([]);
  });

  test("answers 503 while the database is not connected", async () => {
    // The bug this endpoint exists for: /health returned 200 during the window
    // between the socket opening and mongoose.connect() resolving, so a deploy
    // check passed moments before every route began answering 500.
    mongoose.connection.readyState = 0;

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toContain("mongodb");
  });

  test("names the connection state it saw", async () => {
    mongoose.connection.readyState = 2;

    const response = await request(app).get("/ready");

    const mongo = response.body.checks.find(
      (check) => check.name === "mongodb",
    );
    expect(mongo.detail).toBe("connecting");
  });

  test("answers 503 when the datastore mount is gone", async () => {
    process.env.DATASTORE_ROOT = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toEqual(["DATASTORE_ROOT"]);
  });

  test("does not hand out the configured paths", async () => {
    // Unauthenticated endpoint: which mount failed is useful, where it lives
    // is not something to publish.
    process.env.DATASTORE_ROOT = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(JSON.stringify(response.body)).not.toContain(mountRoot);
  });

  test("answers 503 when the HPC transfer directory is gone", async () => {
    process.env.HPC_TRANSFER_DIRECTORY = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toEqual(["HPC_TRANSFER_DIRECTORY"]);
  });

  testUnlessRoot("allows a readable, non-writable HPC inbox", async () => {
    process.env.HPC_TRANSFER_DIRECTORY = readOnlyHpc;

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.failed).toEqual([]);
  });

  test("answers 503 when the upload staging directory is gone", async () => {
    // Every local-filesystem ingest starts as a tus upload into this
    // directory. A broken one used to boot cleanly and report ready, so the
    // first symptom was an ingest failing after the client had been told its
    // upload was accepted.
    process.env.UPLOAD_DIRECTORY = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toEqual(["UPLOAD_DIRECTORY"]);
  });

  test("does not hand out the upload path either", async () => {
    process.env.UPLOAD_DIRECTORY = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(JSON.stringify(response.body)).not.toContain(mountRoot);
  });

  test("treats a probe that reports nothing as a failure", async () => {
    // A check whose module has stopped answering must not read as a pass.
    probeResult = undefined;

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toContain("test-probe");
  });

  test("names every failing check, not just the first", async () => {
    mongoose.connection.readyState = 0;
    process.env.DATASTORE_ROOT = path.join(mountRoot, "gone");

    const response = await request(app).get("/ready");

    expect(response.body.failed).toEqual(["mongodb", "DATASTORE_ROOT"]);
  });

  test("answers 503 while the process is draining", async () => {
    // Set at the top of shutdown, so a load balancer stops sending work before
    // the listener closes underneath a request.
    app.setDraining(true);

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toEqual(["draining"]);
  });

  test("consults a registered dependency probe", async () => {
    probeResult = { ok: false, detail: "worker not running" };

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toContain("test-probe");
  });

  test("treats a probe that throws as a failure, not a 500", async () => {
    probeResult = new Error("probe exploded");

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.failed).toContain("test-probe");
  });

  test("responds without authentication", async () => {
    const response = await request(app).get("/ready");

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.status).not.toBe(401);
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
