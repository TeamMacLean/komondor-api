/**
 * Tests for routes/users.js
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../models/User", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../../models/Project", () => ({ find: jest.fn() }));
jest.mock("../../lib/ldap", () => ({ verifyUserExists: jest.fn() }));

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "testuser", groups: [] };
    next();
  },
  isAdmin: (req, res, next) => next(),
}));

const User = require("../../models/User");
const Project = require("../../models/Project");
const { verifyUserExists } = require("../../lib/ldap");
const usersRouter = require("../../routes/users");

const app = express();
app.use(express.json());
app.use("/", usersRouter);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /users", () => {
  test("returns all users", async () => {
    User.find.mockResolvedValue([{ username: "a" }]);

    const response = await request(app).get("/users");

    expect(response.status).toBe(200);
    expect(response.body.users).toEqual([{ username: "a" }]);
  });

  test("answers 500 when the lookup fails", async () => {
    User.find.mockRejectedValue(new Error("db down"));

    const response = await request(app).get("/users");

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});

describe("GET /user", () => {
  test("returns the user with their projects", async () => {
    // toObject() mirrors a real mongoose document; spreading the document
    // itself would leak internal fields instead of the user's data.
    User.findOne.mockResolvedValue({
      toObject: () => ({ username: "alice", email: "alice@example.org" }),
    });
    Project.find.mockResolvedValue([{ name: "proj" }]);

    const response = await request(app).get("/user").query({ username: "alice" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      username: "alice",
      email: "alice@example.org",
      projects: [{ name: "proj" }],
    });
  });

  test("does not leak mongoose internals into the response", async () => {
    User.findOne.mockResolvedValue({
      $__: { internal: true },
      _doc: { username: "alice" },
      toObject: () => ({ username: "alice" }),
    });
    Project.find.mockResolvedValue([]);

    const response = await request(app).get("/user").query({ username: "alice" });

    expect(response.body.user.$__).toBeUndefined();
    expect(response.body.user._doc).toBeUndefined();
  });

  test("still returns projects when the user has never logged in", async () => {
    User.findOne.mockResolvedValue(null);
    Project.find.mockResolvedValue([{ name: "proj" }]);

    const response = await request(app).get("/user").query({ username: "ghost" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      username: "ghost",
      projects: [{ name: "proj" }],
    });
  });

  test("rejects a missing username with a single response", async () => {
    const response = await request(app).get("/user");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/username/);
    expect(Project.find).not.toHaveBeenCalled();
  });

  test("rejects a repeated username parameter", async () => {
    const response = await request(app).get("/user?username=a&username=b");

    expect(response.status).toBe(400);
  });

  test("answers 500 when the lookup fails", async () => {
    User.findOne.mockRejectedValue(new Error("db down"));
    Project.find.mockResolvedValue([]);

    const response = await request(app).get("/user").query({ username: "alice" });

    expect(response.status).toBe(500);
  });
});

describe("POST /users/verify-ldap", () => {
  test("returns the LDAP lookup result", async () => {
    verifyUserExists.mockResolvedValue({
      exists: true,
      user: { username: "alice" },
    });

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "alice" });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
  });

  test("reports a user that does not exist", async () => {
    verifyUserExists.mockResolvedValue({ exists: false });

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "ghost" });

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(false);
  });

  test("rejects a missing username", async () => {
    const response = await request(app).post("/users/verify-ldap").send({});

    expect(response.status).toBe(400);
    expect(verifyUserExists).not.toHaveBeenCalled();
  });

  test("rejects a non-string username", async () => {
    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: { $ne: null } });

    expect(response.status).toBe(400);
    expect(verifyUserExists).not.toHaveBeenCalled();
  });

  test("answers 500 when LDAP fails", async () => {
    verifyUserExists.mockRejectedValue(new Error("ldap down"));

    const response = await request(app)
      .post("/users/verify-ldap")
      .send({ username: "alice" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("ldap down");
  });
});
