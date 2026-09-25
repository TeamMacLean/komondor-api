const { getEnaAdmins, isEnaAdmin } = require("../../lib/utils/enaAdmins");

const original = process.env.ENA_ADMINS;
afterEach(() => {
  if (original === undefined) delete process.env.ENA_ADMINS;
  else process.env.ENA_ADMINS = original;
});

test.each([
  "['deeks', 'macleand', 'taz23vul', 'admin', 'kun24dup']",
  '["deeks", "macleand", "taz23vul", "admin", "kun24dup"]',
  "deeks, macleand, taz23vul, admin, kun24dup",
])("accepts deployed ENA_ADMINS format: %s", (value) => {
  process.env.ENA_ADMINS = value;
  const usernames = ["deeks", "macleand", "taz23vul", "admin", "kun24dup"];
  expect(getEnaAdmins()).toEqual(usernames);
  for (const username of usernames) expect(isEnaAdmin(username)).toBe(true);
  for (const fragment of ["s", "ee", "land", "min", "kun24", "deeks2"])
    expect(isEnaAdmin(fragment)).toBe(false);
});

test("fails closed for absent or empty configuration and invalid usernames", () => {
  delete process.env.ENA_ADMINS;
  expect(getEnaAdmins()).toEqual([]);
  expect(isEnaAdmin("deeks")).toBe(false);
  process.env.ENA_ADMINS = "  [ , '' , ]  ";
  expect(getEnaAdmins()).toEqual([]);
  for (const username of [undefined, null, "", {}, ["deeks"]])
    expect(isEnaAdmin(username)).toBe(false);
});

test("reads configuration changes without retaining a removed admin", () => {
  process.env.ENA_ADMINS = "deeks";
  expect(isEnaAdmin("deeks")).toBe(true);
  process.env.ENA_ADMINS = "macleand";
  expect(isEnaAdmin("deeks")).toBe(false);
  expect(isEnaAdmin("macleand")).toBe(true);
});
