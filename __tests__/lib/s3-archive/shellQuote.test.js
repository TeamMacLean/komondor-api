const { shellQuote } = require("../../../lib/s3-archive/shellQuote");

describe("shellQuote", () => {
  test.each([
    ["/data/group/project", "'/data/group/project'"],
    ["", "''"],
    ["group's project", "'group'\\''s project'"],
    ["$(touch /tmp/nope); *", "'$(touch /tmp/nope); *'"],
  ])("quotes %p as one POSIX shell argument", (input, expected) => {
    expect(shellQuote(input)).toBe(expected);
  });

  test.each(["line\nbreak", "carriage\rreturn", "nul\0byte", "delete\u007f"])(
    "refuses control characters in %p",
    (input) => {
      expect(() => shellQuote(input)).toThrow(/control characters/);
    },
  );

  test("refuses non-string values", () => {
    expect(() => shellQuote(undefined)).toThrow(/control characters/);
  });
});
