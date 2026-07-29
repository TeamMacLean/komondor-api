/**
 * Tests for lib/utils/getUserForToken.js — builds the JWT payload that every
 * later authorisation check reads.
 */

jest.mock("../../models/Group", () => ({ GroupsIAmIn: jest.fn() }));

const Group = require("../../models/Group");
const getUserForToken = require("../../lib/utils/getUserForToken");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  Group.GroupsIAmIn.mockResolvedValue([
    { id: "g1", safeName: "alpha" },
    { id: "g2", safeName: "beta" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getUserForToken", () => {
  test("maps the user's groups to their ids", async () => {
    const payload = await getUserForToken({ username: "alice" });

    expect(payload.groups).toEqual(["g1", "g2"]);
  });

  test("prefers the username over the LDAP uid", async () => {
    const payload = await getUserForToken({ username: "alice", uid: "a123" });

    expect(payload.username).toBe("alice");
  });

  test("falls back to the LDAP uid", async () => {
    const payload = await getUserForToken({ uid: "a123" });

    expect(payload.username).toBe("a123");
  });

  test("builds a full name from givenName and sn", async () => {
    const payload = await getUserForToken({
      username: "alice",
      givenName: "Alice",
      sn: "Smith",
    });

    expect(payload.name).toBe("Alice Smith");
  });

  test("falls back to displayName when the name parts are absent", async () => {
    const payload = await getUserForToken({
      username: "alice",
      displayName: "Alice S",
    });

    expect(payload.name).toBe("Alice S");
  });

  test("lowercases the LDAP mail attribute", async () => {
    const payload = await getUserForToken({
      username: "alice",
      mail: "Alice@Example.ORG",
    });

    expect(payload.email).toBe("alice@example.org");
  });

  test("prefers an explicit email over the mail attribute", async () => {
    const payload = await getUserForToken({
      username: "alice",
      email: "explicit@example.org",
      mail: "ldap@example.org",
    });

    expect(payload.email).toBe("explicit@example.org");
  });

  test("carries the admin flag for the built-in admin account", async () => {
    // The flag was computed and logged but never included in the payload, so
    // req.user.isAdmin was always undefined for LDAP logins.
    const payload = await getUserForToken({ username: "admin" });

    expect(payload.isAdmin).toBe(true);
  });

  test("does not mark an ordinary user as admin", async () => {
    const payload = await getUserForToken({ username: "alice" });

    expect(payload.isAdmin).toBe(false);
  });

  test("rejects when no user is supplied", async () => {
    await expect(getUserForToken(null)).rejects.toThrow(/user is required/i);
  });

  test("propagates a group lookup failure rather than issuing a token", async () => {
    Group.GroupsIAmIn.mockRejectedValue(new Error("db down"));

    await expect(getUserForToken({ username: "alice" })).rejects.toThrow(
      "db down",
    );
  });
});
