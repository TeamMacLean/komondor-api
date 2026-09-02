/**
 * Tests for routes/uploads.js — the tus upload mount.
 *
 * The mount used to be wired up with no authentication at all: an
 * unauthenticated probe got 412 "Tus-Resumable Required" from the protocol
 * handler, which is the tus server saying "malformed request", not "who are
 * you?". Anyone who could reach the port could write unbounded bytes to the
 * volume the datastore lives on. These tests run against a real tus server and
 * a real temporary upload directory, because what matters is whether bytes
 * reach the disk, not whether a mock was called.
 */

const request = require("supertest");
const express = require("express");
const fs = require("fs");
const os = require("os");
const _path = require("path");

const tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-uploads-"));
const uploadDir = _path.join(tmpRoot, "files");
const secretPath = _path.join(tmpRoot, "secret.txt");
fs.mkdirSync(uploadDir);

const ORIGINAL_ENV = {
  UPLOAD_DIRECTORY: process.env.UPLOAD_DIRECTORY,
  WEB_APP_URL: process.env.WEB_APP_URL,
};

// Both are read when the router is first required, so they are set before it.
process.env.UPLOAD_DIRECTORY = uploadDir;
process.env.WEB_APP_URL = "http://localhost:3000";

const { TUS_VERSION } = require("@tus/server");
const uploadRouter = require("../../routes/uploads");
const quota = require("../../lib/upload-quota");

const QUOTA_ENV = [
  "UPLOAD_MAX_BYTES",
  "UPLOAD_MAX_CONCURRENT_PER_USER",
  "UPLOAD_MAX_INFLIGHT_BYTES_PER_USER",
  "UPLOAD_MIN_FREE_BYTES",
];

// Set by each test; the real isAuthenticated is left in place, because it is
// half of what is under test here.
let currentUser = null;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (currentUser) {
    req.user = currentUser;
  }
  next();
});
app.use(uploadRouter);

/** Starts an upload as `username` and returns the raw response. */
const createUpload = (username, length = 4) => {
  currentUser = username ? { username } : null;

  return request(app)
    .post("/uploads")
    .set("Tus-Resumable", "1.0.0")
    .set("Upload-Length", String(length));
};

/** The upload id from a 201's Location header. */
const idFromLocation = (response) => response.headers.location.split("/").pop();

/** Every entry currently in the upload directory. */
const uploadDirEntries = () => fs.readdirSync(uploadDir);

beforeAll(() => {
  fs.writeFileSync(secretPath, "TOP SECRET");
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  Object.entries(ORIGINAL_ENV).forEach(([name, value]) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
});

beforeEach(() => {
  currentUser = null;
  quota.clearUploads();
  QUOTA_ENV.forEach((name) => delete process.env[name]);
  // See __tests__/lib/upload-quota.test.js: the 5 GiB free-space floor measures
  // the real disk, so leaving it at its default makes these tests depend on the
  // host's spare capacity. The test that wants a 507 raises it itself.
  process.env.UPLOAD_MIN_FREE_BYTES = "0";
  uploadDirEntries().forEach((entry) =>
    fs.rmSync(_path.join(uploadDir, entry), { force: true }),
  );
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("authentication on the upload mount", () => {
  test("refuses an unauthenticated upload with 401, not a tus protocol error", async () => {
    const response = await request(app)
      .post("/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Length", "10");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(uploadDirEntries()).toEqual([]);
  });

  test("answers 401 before the protocol check that used to answer 412", async () => {
    // A live probe of the old mount returned 412 Tus-Resumable Required, which
    // reads as "not authenticated" only to someone who already knows it wasn't.
    const response = await request(app).post("/uploads");

    expect(response.status).toBe(401);
  });

  test("refuses an unauthenticated attempt to resume an upload", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = null;
    const response = await request(app)
      .patch(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Offset", "0")
      .set("Content-Type", "application/offset+octet-stream")
      .send(Buffer.from("ACGT"));

    expect(response.status).toBe(401);
    expect(fs.statSync(_path.join(uploadDir, id)).size).toBe(0);
  });

  test("refuses an unauthenticated HEAD and an unauthenticated DELETE", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);
    currentUser = null;

    const head = await request(app)
      .head(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");
    const remove = await request(app)
      .delete(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");

    expect(head.status).toBe(401);
    expect(remove.status).toBe(401);
    expect(fs.existsSync(_path.join(uploadDir, id))).toBe(true);
  });

  test("refuses an upload admitted with no authenticated user", async () => {
    // admitUpload has its own `if (!username)` guard, documented as existing
    // so a future refactor that loses the mount's authentication fails closed.
    // Nothing watched it: delete it and the request is still refused, because
    // checkUploadAllowed happens to answer 401 for a missing username too —
    // same status, same message, so no response-level assertion can tell the
    // two apart.
    //
    // What distinguishes them is whether the quota layer is consulted at all.
    // The guard's whole point is that an unauthenticated admission is refused
    // *before* it reaches code that would otherwise reserve a slot and
    // register an upload under an undefined owner.
    const checkUploadAllowed = jest.spyOn(quota, "checkUploadAllowed");

    // A principal that passes isAuthenticated — req.user is set — but carries
    // no username. That is exactly the shape a refactor leaves behind, and the
    // only way to reach admitUpload without a username at all.
    currentUser = {};

    const response = await request(app)
      .post("/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Length", "4");

    expect(response.status).toBe(401);
    // The refusal came from the guard, not from the quota check downstream.
    expect(checkUploadAllowed).not.toHaveBeenCalled();
    // And nothing was staged under a nameless owner.
    expect(uploadDirEntries()).toEqual([]);
  });

  test("lets an authenticated user create an upload", async () => {
    const response = await createUpload("alice");

    expect(response.status).toBe(201);
    expect(response.headers.location).toMatch(
      /^\/\/[^/]+\/uploads\/[0-9a-f]{32}$/,
    );
    expect(uploadDirEntries()).toContain(idFromLocation(response));
  });

  test("passes an authenticated request through to the tus handler", async () => {
    currentUser = { username: "alice" };

    const response = await request(app)
      .head(`/uploads/${"f".repeat(32)}`)
      .set("Tus-Resumable", "1.0.0");

    // 404 rather than 401: the request reached tus, which knows no such upload.
    expect(response.status).toBe(404);
  });

  test("still answers the CORS preflight, which carries no credentials", async () => {
    const response = await request(app)
      .options("/uploads")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  test("advertises the maximum upload size the client is held to", async () => {
    process.env.UPLOAD_MAX_BYTES = "4096";

    const response = await request(app)
      .options("/uploads")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["tus-max-size"]).toBe("4096");
  });

  test("does not answer with a wildcard CORS origin", async () => {
    // Was origin: "*", which let any page on the internet drive an upload.
    const response = await createUpload("alice");

    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });
});

describe("upload ownership", () => {
  test("refuses another user's attempt to resume an upload", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "bob" };
    const response = await request(app)
      .patch(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Offset", "0")
      .set("Content-Type", "application/offset+octet-stream")
      .send(Buffer.from("ACGT"));

    expect(response.status).toBe(403);
    expect(JSON.parse(response.text)).toEqual({
      error: "User 'bob' does not have permission to access this upload",
    });
    expect(fs.statSync(_path.join(uploadDir, id)).size).toBe(0);
  });

  test("lets the owner resume their own upload", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "alice" };
    const response = await request(app)
      .patch(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Offset", "0")
      .set("Content-Type", "application/offset+octet-stream")
      .send(Buffer.from("ACGT"));

    expect(response.status).toBe(204);
    expect(fs.readFileSync(_path.join(uploadDir, id), "utf8")).toBe("ACGT");
  });

  test("refuses another user's HEAD, which would leak an upload's progress", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "bob" };
    const response = await request(app)
      .head(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");

    expect(response.status).toBe(403);
  });

  test("refuses another user's attempt to delete an upload", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "bob" };
    const response = await request(app)
      .delete(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");

    expect(response.status).toBe(403);
    expect(fs.existsSync(_path.join(uploadDir, id))).toBe(true);
  });

  test("lets the owner delete their own upload and frees the slot", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "alice" };
    const response = await request(app)
      .delete(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");

    expect(response.status).toBe(204);
    expect(fs.existsSync(_path.join(uploadDir, id))).toBe(false);
    expect(quota.getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
  });

  test("records the owner where it survives a restart", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    // The in-memory register is gone after a restart; the sidecar is not.
    quota.clearUploads();
    const stored = JSON.parse(
      fs.readFileSync(_path.join(uploadDir, `${id}.json`), "utf8"),
    );

    expect(stored.metadata.owner).toBe("alice");

    currentUser = { username: "alice" };
    const response = await request(app)
      .head(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0");

    expect(response.status).toBe(200);
  });

  test("refuses a URL-encoded traversal instead of unlinking the target", async () => {
    // The datastore joins the last path segment onto the upload directory, so
    // "..%2Fsecret.txt" would resolve outside it.
    currentUser = { username: "alice" };

    const response = await request(app)
      .delete("/uploads/..%2Fsecret.txt")
      .set("Tus-Resumable", "1.0.0");

    expect(response.status).toBe(404);
    expect(fs.existsSync(secretPath)).toBe(true);
  });
});

describe("upload quotas", () => {
  test("refuses a file larger than the configured maximum with 413", async () => {
    process.env.UPLOAD_MAX_BYTES = "1000";

    const response = await createUpload("alice", 1001);

    expect(response.status).toBe(413);
    expect(uploadDirEntries()).toEqual([]);
  });

  test("refuses more concurrent uploads than a user may hold", async () => {
    await createUpload("alice");
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "1";

    const response = await createUpload("alice");

    expect(response.status).toBe(429);
    expect(JSON.parse(response.text).error).toContain(
      "already has 1 uploads in progress",
    );
  });

  test("does not hold one user's uploads against another", async () => {
    await createUpload("alice");
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "1";

    const response = await createUpload("bob");

    expect(response.status).toBe(201);
  });

  test("refuses more in-flight bytes than a user may hold", async () => {
    process.env.UPLOAD_MAX_INFLIGHT_BYTES_PER_USER = "10";

    const response = await createUpload("alice", 11);

    expect(response.status).toBe(429);
  });

  test("refuses a new upload when the volume is low on space", async () => {
    process.env.UPLOAD_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);

    const response = await createUpload("alice");

    expect(response.status).toBe(507);
    expect(uploadDirEntries()).toEqual([]);
  });

  test("holds the concurrency cap against POSTs that arrive together", async () => {
    // The quota check used to await the free-space probe before the route
    // registered anything, so a burst of simultaneous POSTs all read a usage
    // of zero and all got a 201. The cap was advisory in exactly the case it
    // exists for.
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "2";
    currentUser = { username: "alice" };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post("/uploads")
          .set("Tus-Resumable", "1.0.0")
          .set("Upload-Length", "4"),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(6);
    expect(quota.getUserUsage("alice").count).toBe(2);
  });

  test("holds the in-flight byte cap against POSTs that arrive together", async () => {
    process.env.UPLOAD_MAX_INFLIGHT_BYTES_PER_USER = "10";
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "100";
    currentUser = { username: "alice" };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post("/uploads")
          .set("Tus-Resumable", "1.0.0")
          .set("Upload-Length", "4"),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
    expect(quota.getUserUsage("alice").bytes).toBe(8);
  });

  test("frees the user's slot when an upload finishes", async () => {
    const created = await createUpload("alice", 4);
    const id = idFromLocation(created);

    currentUser = { username: "alice" };
    await request(app)
      .patch(`/uploads/${id}`)
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Offset", "0")
      .set("Content-Type", "application/offset+octet-stream")
      .send(Buffer.from("ACGT"));

    expect(quota.getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
  });
});

describe("POST /upload/cancel", () => {
  test("refuses an unauthenticated caller", async () => {
    const response = await request(app).post("/upload/cancel").send({});

    expect(response.status).toBe(401);
  });

  test("keeps answering 200 when no upload is named", async () => {
    currentUser = { username: "alice" };

    const response = await request(app).post("/upload/cancel").send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({});
  });

  test("refuses an id that is not shaped like an upload id", async () => {
    currentUser = { username: "alice" };

    const response = await request(app)
      .post("/upload/cancel")
      .send({ uploadId: "../../etc/passwd" });

    expect(response.status).toBe(400);
    expect(fs.existsSync(secretPath)).toBe(true);
  });

  test("refuses to cancel an upload belonging to somebody else", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "bob" };
    const response = await request(app)
      .post("/upload/cancel")
      .send({ uploadId: id });

    expect(response.status).toBe(403);
    expect(fs.existsSync(_path.join(uploadDir, id))).toBe(true);
  });

  test("cancels the caller's own upload and frees the slot", async () => {
    const created = await createUpload("alice");
    const id = idFromLocation(created);

    currentUser = { username: "alice" };
    const response = await request(app)
      .post("/upload/cancel")
      .send({ uploadId: id });

    expect(response.status).toBe(200);
    expect(fs.existsSync(_path.join(uploadDir, id))).toBe(false);
    expect(quota.getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
  });

  test("reports an unknown upload as not found", async () => {
    currentUser = { username: "alice" };

    const response = await request(app)
      .post("/upload/cancel")
      .send({ uploadId: "e".repeat(32) });

    expect(response.status).toBe(404);
  });
});

describe("the tus mount inside the WHOLE application", () => {
  // Every test above builds its own express app around the upload router
  // alone. That topology is not production's: app.js mounts a global cors()
  // long before the upload routes, and cors() ANSWERS an OPTIONS preflight
  // and ends the request rather than passing it on. So the router's own
  // capability middleware never ran on a preflight, and no test here could
  // have noticed — an audit found it by driving the real application.
  //
  // This suite requires app.js itself so the mount order is the real one.
  let realApp;

  beforeAll(() => {
    jest.isolateModules(() => {
      realApp = require("../../app");
    });
  });

  test("answers an OPTIONS preflight with the tus capability headers", async () => {
    const response = await request(realApp)
      .options("/uploads")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,tus-resumable");

    expect(response.status).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    // The half that was missing: answered by the global cors() before the
    // upload router could contribute anything of its own.
    expect(response.headers["tus-max-size"]).toBeDefined();
    expect(response.headers["tus-version"]).toBe(TUS_VERSION.join(","));
    expect(response.headers["tus-extension"]).toBeDefined();
  });

  test("still refuses an unauthenticated upload through the real mount", async () => {
    // The preflight exemption must not have opened the actual request path.
    const response = await request(realApp)
      .post("/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Length", "4");

    expect(response.status).toBe(401);
  });

  test("still sets CORS headers on the 401 the mount's own guard returns", async () => {
    // A review caught this as a regression from the first attempt at the
    // fix above. routes/uploads.js guards the mount with
    // `router.use(TUS_ROUTE, requireUploadAuth, uploadApp)`, so an
    // unauthenticated request is answered 401 BEFORE reaching uploadApp's
    // own cors(). Skipping the global cors() for /uploads therefore stripped
    // the headers from every 401 — and a JWT expiring mid-upload would show
    // the browser an opaque CORS failure instead of "Authentication
    // required", which the web app cannot tell apart from the network dying.
    const response = await request(realApp)
      .post("/uploads")
      .set("Origin", "http://localhost:3000")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Length", "4");

    expect(response.status).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  test("routes a case-variant path the same way Express does", async () => {
    // Express routes case-insensitively by default, so /Uploads reaches the
    // tus mount. A case-sensitive predicate in app.js sent it down the other
    // branch — the exact bug this suite exists to catch, one capital letter
    // away from the path it does catch.
    const response = await request(realApp)
      .options("/Uploads")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["tus-max-size"]).toBeDefined();
  });

  test("keeps normal CORS on a route that is not the upload mount", async () => {
    // The skip is scoped to /uploads; everything else must still get the
    // global cors() answer it always had.
    const response = await request(realApp)
      .options("/news")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });
});
