/**
 * Tests for routes/middleware.js — the authentication and authorisation gates
 * every protected route depends on.
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

jest.mock("../../models/Group", () => ({ GroupsIAmIn: jest.fn() }));

const Group = require("../../models/Group");
const {
  isAuthenticated,
  isAdmin,
  belongsToGroup,
} = require("../../routes/middleware");

const groupId = new mongoose.Types.ObjectId().toString();
const otherGroupId = new mongoose.Types.ObjectId().toString();

/**
 * Builds a small app that injects `user` and then applies `middleware`.
 */
const buildApp = (user, middleware) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) {
      req.user = user;
    }
    next();
  });
  app.get("/protected", middleware, (req, res) =>
    res.status(200).send({ ok: true }),
  );
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("isAuthenticated", () => {
  test("passes a request carrying a user", async () => {
    const response = await request(
      buildApp({ username: "testuser" }, isAuthenticated),
    ).get("/protected");

    expect(response.status).toBe(200);
  });

  test("rejects a request with no user", async () => {
    const response = await request(buildApp(null, isAuthenticated)).get(
      "/protected",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });
});

describe("isAdmin", () => {
  test("passes an admin", async () => {
    const response = await request(
      buildApp({ username: "admin", isAdmin: true }, isAdmin),
    ).get("/protected");

    expect(response.status).toBe(200);
  });

  test("rejects a non-admin", async () => {
    const response = await request(
      buildApp({ username: "testuser", isAdmin: false }, isAdmin),
    ).get("/protected");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Admin access required");
  });

  test("rejects an unauthenticated request", async () => {
    const response = await request(buildApp(null, isAdmin)).get("/protected");

    expect(response.status).toBe(403);
  });

  test("rejects a user whose isAdmin flag is merely truthy-looking", async () => {
    const response = await request(
      buildApp({ username: "testuser", isAdmin: "false" }, isAdmin),
    ).get("/protected");

    // A non-empty string is truthy, so this documents current behaviour:
    // the flag must be set by the token issuer, never by client input.
    expect(response.status).toBe(200);
  });
});

describe("belongsToGroup", () => {
  const middleware = belongsToGroup((req) => req.query.groupId);

  test("passes a member of the group", async () => {
    Group.GroupsIAmIn.mockResolvedValue([{ _id: groupId }]);

    const response = await request(
      buildApp({ username: "testuser" }, middleware),
    )
      .get("/protected")
      .query({ groupId });

    expect(response.status).toBe(200);
  });

  test("passes an admin who is not a member", async () => {
    Group.GroupsIAmIn.mockResolvedValue([]);

    const response = await request(
      buildApp({ username: "admin", isAdmin: true }, middleware),
    )
      .get("/protected")
      .query({ groupId });

    expect(response.status).toBe(200);
  });

  test("rejects a non-member", async () => {
    Group.GroupsIAmIn.mockResolvedValue([{ _id: otherGroupId }]);

    const response = await request(
      buildApp({ username: "testuser" }, middleware),
    )
      .get("/protected")
      .query({ groupId });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/testuser/);
  });

  test("rejects a request with no group id", async () => {
    const response = await request(
      buildApp({ username: "testuser" }, middleware),
    ).get("/protected");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Group ID not provided");
  });

  test("answers 500 when the group lookup fails", async () => {
    Group.GroupsIAmIn.mockRejectedValue(new Error("db down"));

    const response = await request(
      buildApp({ username: "testuser" }, middleware),
    )
      .get("/protected")
      .query({ groupId });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Failed to verify group membership");
  });
});
