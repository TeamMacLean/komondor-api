/**
 * Tests for jwtSign.
 *
 * Tokens carry the user's groups as resolved at login, so a token must not
 * live forever: an expiry bounds how stale that snapshot can get before the
 * client is forced to re-authenticate.
 */

const jwt = require("jsonwebtoken");
const sign = require("../../lib/utils/jwtSign");

const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_EXPIRY = process.env.JWT_EXPIRES_IN;

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  delete process.env.JWT_EXPIRES_IN;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_SECRET;
  }
  if (ORIGINAL_EXPIRY === undefined) {
    delete process.env.JWT_EXPIRES_IN;
  } else {
    process.env.JWT_EXPIRES_IN = ORIGINAL_EXPIRY;
  }
});

describe("jwtSign", () => {
  test("signs a token carrying the payload", async () => {
    const token = await sign({ username: "eve", groups: ["g1"] });

    const decoded = jwt.verify(token, "test-secret");
    expect(decoded.username).toBe("eve");
    expect(decoded.groups).toEqual(["g1"]);
  });

  test("tokens expire after 7 days by default", async () => {
    const token = await sign({ username: "eve" });

    const decoded = jwt.verify(token, "test-secret");
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });

  test("JWT_EXPIRES_IN overrides the default expiry", async () => {
    process.env.JWT_EXPIRES_IN = "1h";

    const token = await sign({ username: "eve" });

    const decoded = jwt.verify(token, "test-secret");
    expect(decoded.exp - decoded.iat).toBe(60 * 60);
  });

  test("rejects instead of throwing when signing fails", async () => {
    delete process.env.JWT_SECRET;

    await expect(sign({ username: "eve" })).rejects.toThrow();
  });
});
