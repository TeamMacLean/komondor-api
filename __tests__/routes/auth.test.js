/**
 * Tests for routes/auth.js
 */

const request = require("supertest");
const express = require("express");

process.env.JWT_SECRET = "test-secret-for-auth-tests";

jest.mock("../../lib/ldap", () => ({
  authenticate: jest.fn(),
  verifyUserExists: jest.fn(),
}));

jest.mock("../../lib/utils/getUserForToken", () => jest.fn());

jest.mock("../../models/User", () => ({
  findOne: jest.fn(),
}));

const { authenticate } = require("../../lib/ldap");
const getUserForToken = require("../../lib/utils/getUserForToken");
const User = require("../../models/User");
const authRouter = require("../../routes/auth");

const app = express();
app.use(express.json());
app.use("/", authRouter);

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  process.env.NODE_ENV = "test";
  process.env.ADMIN_PASSWORD = "admin-secret";
  // The login handler updates the user record after responding.
  User.findOne.mockResolvedValue({ notifyLogin: jest.fn().mockResolvedValue() });
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_ENV;
  if (ORIGINAL_ADMIN_PASSWORD === undefined) {
    delete process.env.ADMIN_PASSWORD;
  } else {
    process.env.ADMIN_PASSWORD = ORIGINAL_ADMIN_PASSWORD;
  }
});

describe("POST /login", () => {
  describe("built-in admin", () => {
    test("issues a token for the correct admin password", async () => {
      const response = await request(app)
        .post("/login")
        .send({ username: "admin", password: "admin-secret" });

      expect(response.status).toBe(200);
      expect(typeof response.body.token).toBe("string");
      expect(authenticate).not.toHaveBeenCalled();
    });

    test("falls through to LDAP for the wrong admin password", async () => {
      authenticate.mockRejectedValue(new Error("bad creds"));

      const response = await request(app)
        .post("/login")
        .send({ username: "admin", password: "wrong" });

      expect(response.status).toBe(401);
      expect(authenticate).toHaveBeenCalled();
    });

    test("does not accept an unset ADMIN_PASSWORD", async () => {
      delete process.env.ADMIN_PASSWORD;
      authenticate.mockRejectedValue(new Error("bad creds"));

      const response = await request(app)
        .post("/login")
        .send({ username: "admin", password: "anything" });

      expect(response.status).toBe(401);
    });
  });

  describe("credential validation", () => {
    test("rejects a missing username", async () => {
      const response = await request(app)
        .post("/login")
        .send({ password: "x" });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Bad credentials");
    });

    test("rejects a missing password", async () => {
      const response = await request(app)
        .post("/login")
        .send({ username: "alice" });

      expect(response.status).toBe(401);
    });

    test("rejects an empty body", async () => {
      const response = await request(app).post("/login").send({});

      expect(response.status).toBe(401);
    });
  });

  describe("LDAP authentication", () => {
    test("issues a token on success", async () => {
      authenticate.mockResolvedValue({ uid: "alice" });
      getUserForToken.mockResolvedValue({
        username: "alice",
        groups: ["g1"],
        isAdmin: false,
      });

      const response = await request(app)
        .post("/login")
        .send({ username: "alice", password: "pw" });

      expect(response.status).toBe(200);
      expect(typeof response.body.token).toBe("string");
    });

    test("answers 401 when LDAP rejects the credentials", async () => {
      authenticate.mockRejectedValue(new Error("invalid credentials"));

      const response = await request(app)
        .post("/login")
        .send({ username: "alice", password: "wrong" });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Bad credentials");
    });

    test("answers 401 rather than hanging when the token lookup fails", async () => {
      // getUserForToken used to be called without a .catch, so a rejection
      // left the request without any response at all.
      authenticate.mockResolvedValue({ uid: "alice" });
      getUserForToken.mockRejectedValue(new Error("group lookup failed"));

      const response = await request(app)
        .post("/login")
        .send({ username: "alice", password: "pw" });

      expect(response.status).toBe(401);
    });
  });

  describe("development mode users", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    test("accepts the built-in dev admin", async () => {
      const response = await request(app)
        .post("/login")
        .send({ username: "testadmin", password: "testpass" });

      expect(response.status).toBe(200);
      expect(typeof response.body.token).toBe("string");
      expect(authenticate).not.toHaveBeenCalled();
    });

    test("accepts the built-in dev user", async () => {
      const response = await request(app)
        .post("/login")
        .send({ username: "testuser", password: "testpass" });

      expect(response.status).toBe(200);
    });

    test("falls back to LDAP for an unknown dev user", async () => {
      authenticate.mockRejectedValue(new Error("no such user"));

      const response = await request(app)
        .post("/login")
        .send({ username: "someone", password: "pw" });

      expect(response.status).toBe(401);
      expect(authenticate).toHaveBeenCalled();
    });
  });

  describe("dev users are rejected outside development", () => {
    test("does not accept testadmin in production", async () => {
      process.env.NODE_ENV = "production";
      authenticate.mockRejectedValue(new Error("no such user"));

      const response = await request(app)
        .post("/login")
        .send({ username: "testadmin", password: "testpass" });

      expect(response.status).toBe(401);
      expect(authenticate).toHaveBeenCalled();
    });
  });
});

describe("GET /me", () => {
  test("returns the decoded user for a valid token", async () => {
    const login = await request(app)
      .post("/login")
      .send({ username: "admin", password: "admin-secret" });

    const response = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe("admin");
  });

  test("answers 200 with no user when no token is supplied", async () => {
    const response = await request(app).get("/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toBeUndefined();
  });

  test("answers 401 for a malformed token", async () => {
    // This used to answer 500, which reads as an API outage rather than a
    // signal to re-authenticate.
    const response = await request(app)
      .get("/me")
      .set("Authorization", "Bearer garbage");

    expect(response.status).toBe(401);
  });
});

describe("logout", () => {
  test("GET /logout answers 200", async () => {
    await request(app).get("/logout").expect(200);
  });
});
