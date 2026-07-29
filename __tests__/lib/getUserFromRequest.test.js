/**
 * Tests for lib/utils/getUserFromRequest.js and lib/utils/jwtSign.js — the
 * token round-trip that app.js uses to populate req.user.
 */

process.env.JWT_SECRET = "test-secret-for-token-tests";

const jwt = require("jsonwebtoken");
const getUserFromRequest = require("../../lib/utils/getUserFromRequest");
const sign = require("../../lib/utils/jwtSign");

const makeReq = (authorization) => ({
  headers: authorization === undefined ? {} : { authorization },
});

describe("jwtSign", () => {
  test("produces a token that verifies against the configured secret", async () => {
    const token = await sign({ username: "alice" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded.username).toBe("alice");
  });
});

describe("getUserFromRequest", () => {
  test("resolves the decoded payload for a valid bearer token", async () => {
    const token = await sign({ username: "alice", groups: ["g1"] });

    const user = await getUserFromRequest(makeReq(`Bearer ${token}`));

    expect(user.username).toBe("alice");
    expect(user.groups).toEqual(["g1"]);
  });

  test("accepts a lowercase scheme", async () => {
    const token = await sign({ username: "alice" });

    const user = await getUserFromRequest(makeReq(`bearer ${token}`));

    expect(user.username).toBe("alice");
  });

  test("resolves undefined when no Authorization header is present", async () => {
    await expect(getUserFromRequest(makeReq(undefined))).resolves.toBeUndefined();
  });

  test("resolves undefined for a non-bearer scheme", async () => {
    await expect(
      getUserFromRequest(makeReq("Basic dXNlcjpwYXNz")),
    ).resolves.toBeUndefined();
  });

  test("rejects with TokenExpiredError for an expired token", async () => {
    const token = jwt.sign({ username: "alice" }, process.env.JWT_SECRET, {
      expiresIn: "-1s",
    });

    await expect(
      getUserFromRequest(makeReq(`Bearer ${token}`)),
    ).rejects.toMatchObject({ name: "TokenExpiredError" });
  });

  test("rejects with JsonWebTokenError for a malformed token", async () => {
    await expect(
      getUserFromRequest(makeReq("Bearer garbage")),
    ).rejects.toMatchObject({ name: "JsonWebTokenError" });
  });

  test("rejects a token signed with a different secret", async () => {
    const token = jwt.sign({ username: "alice" }, "another-secret");

    await expect(
      getUserFromRequest(makeReq(`Bearer ${token}`)),
    ).rejects.toMatchObject({ name: "JsonWebTokenError" });
  });

  test("rejects a bearer header with no token", async () => {
    await expect(getUserFromRequest(makeReq("Bearer"))).rejects.toBeDefined();
  });
});
