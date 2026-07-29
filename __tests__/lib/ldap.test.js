/**
 * Tests for lib/ldap.js
 *
 * The network-facing paths need a real directory server, so these cover the
 * filter escaping and the configuration guards — the parts that decide whether
 * a request is safe to send at all.
 */

jest.mock("ldapauth-fork", () => jest.fn());
jest.mock("ldapjs", () => ({ createClient: jest.fn() }));

const {
  escapeLdapFilterValue,
  authenticate,
  verifyUserExists,
} = require("../../lib/ldap");

const ORIGINAL = {
  LDAP_URL: process.env.LDAP_URL,
  LDAP_SEARCH_FILTER: process.env.LDAP_SEARCH_FILTER,
  LDAP_SEARCH_BASE: process.env.LDAP_SEARCH_BASE,
};

afterEach(() => {
  Object.entries(ORIGINAL).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  jest.restoreAllMocks();
});

describe("escapeLdapFilterValue", () => {
  test("leaves an ordinary username untouched", () => {
    expect(escapeLdapFilterValue("alice")).toBe("alice");
  });

  test("escapes the wildcard that would match every user", () => {
    expect(escapeLdapFilterValue("*")).toBe("\\2a");
  });

  test("escapes parentheses that would close the filter clause", () => {
    expect(escapeLdapFilterValue("(")).toBe("\\28");
    expect(escapeLdapFilterValue(")")).toBe("\\29");
  });

  test("escapes a backslash", () => {
    expect(escapeLdapFilterValue("\\")).toBe("\\5c");
  });

  test("escapes a NUL byte", () => {
    expect(escapeLdapFilterValue("\0")).toBe("\\00");
  });

  test("escapes a forward slash", () => {
    expect(escapeLdapFilterValue("/")).toBe("\\2f");
  });

  test("neutralises a filter injection payload", () => {
    // Unescaped, `admin)(uid=*` turns "(sAMAccountName={{username}})" into a
    // filter that matches every account.
    const escaped = escapeLdapFilterValue("admin)(uid=*");

    expect(escaped).toBe("admin\\29\\28uid=\\2a");
    expect(escaped).not.toContain("(");
    expect(escaped).not.toContain(")");
    expect(escaped).not.toContain("*");
  });

  test("coerces a non-string value", () => {
    expect(escapeLdapFilterValue(42)).toBe("42");
  });
});

describe("authenticate", () => {
  test("rejects a missing username without contacting LDAP", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(authenticate(undefined, "pw")).rejects.toThrow(
      /Username is required/,
    );
  });

  test("rejects when LDAP_URL is not configured", async () => {
    delete process.env.LDAP_URL;

    await expect(authenticate("alice", "pw")).rejects.toThrow(
      /LDAP is not configured/,
    );
  });
});

describe("verifyUserExists", () => {
  test("rejects a missing username", async () => {
    await expect(verifyUserExists(undefined)).rejects.toThrow(
      /Username is required/,
    );
  });

  test("rejects a non-string username", async () => {
    await expect(verifyUserExists({ $ne: null })).rejects.toThrow(
      /Username is required/,
    );
  });

  test("rejects when LDAP is not configured", async () => {
    delete process.env.LDAP_URL;
    delete process.env.LDAP_SEARCH_FILTER;
    delete process.env.LDAP_SEARCH_BASE;

    await expect(verifyUserExists("alice")).rejects.toThrow(
      /LDAP is not configured/,
    );
  });

  test("rejects when only the search filter is missing", async () => {
    process.env.LDAP_URL = "ldap://example.org";
    process.env.LDAP_SEARCH_BASE = "dc=example,dc=org";
    delete process.env.LDAP_SEARCH_FILTER;

    await expect(verifyUserExists("alice")).rejects.toThrow(
      /LDAP is not configured/,
    );
  });
});
