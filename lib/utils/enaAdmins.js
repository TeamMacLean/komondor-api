/**
 * Parse ENA_ADMINS using the same formats as komondor-web: JSON arrays,
 * single-quoted arrays, or comma-separated usernames. Match whole usernames.
 * Read at request time so this capability is never stamped into JWT membership.
 * @returns {string[]} Configured ENA administrators.
 */
const getEnaAdmins = () => {
  const raw = process.env.ENA_ADMINS;
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }

  return raw
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
};

/** @param {string} username @returns {boolean} Exact ENA admin membership. */
const isEnaAdmin = (username) =>
  typeof username === "string" && !!username && getEnaAdmins().includes(username);

module.exports = { getEnaAdmins, isEnaAdmin };
