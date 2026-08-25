/**
 * Logs reads of, and claims against, the shared HPC staging directory.
 *
 * Nothing records which group owns a staging subdirectory, so the API cannot
 * refuse a claim on another group's files — it can only say who took what.
 * Mostly this answers "where did group B's file go?" after someone mistypes a
 * directory name. See BREAKING_CHANGES.md entry 32.
 */

const AUDIT_PREFIX = "[HPC-AUDIT]";

/** JSON-quoted so a newline in a filename cannot split one record into two. */
const auditField = (key, value) => `${key}=${JSON.stringify(String(value))}`;

/**
 * Records an access to the staging area, on stdout.
 *
 * @param {object} details
 * @param {string} details.action - "list", "read", "md5" or "claim".
 * @param {object} details.user - The acting user; only the username is kept.
 * @param {string} details.path - The resolved absolute path.
 * @param {string} [details.outcome] - "ok", or a short refusal reason.
 * @param {string} [details.detail] - Anything else worth keeping, e.g. a run id.
 */
const auditHpcAccess = ({ action, user, path, outcome = "ok", detail }) => {
  const username = (user && user.username) || "unknown";

  console.log(
    [
      AUDIT_PREFIX,
      auditField("action", action),
      auditField("user", username),
      auditField("path", path),
      auditField("outcome", outcome),
      detail === undefined || detail === null
        ? null
        : auditField("detail", detail),
    ]
      .filter(Boolean)
      .join(" "),
  );
};

/**
 * Refuses a caller with no group membership and no elevated access.
 *
 * Reads req.user.groups, the claim the JWT already carries, rather than
 * querying live membership (removed in 366f656 as disproportionate for this
 * threat model): LDAP can hand back a user with `groups: []` — misconfigured,
 * or never assigned to one — and nothing else distinguishes that caller from
 * a properly-provisioned one. Must be used after isAuthenticated.
 *
 * @returns {Function} Express middleware.
 */
const requireHpcGroupAccess = (req, res, next) => {
  // Lazy require: matches the convention in routes/middleware.js's own
  // hasFullRecordsAccess, and keeps this module free of a load-order
  // dependency on lib/utils/fullAccessUsers.js.
  const { hasFullRecordsAccess } = require("./fullAccessUsers");
  const user = req.user;

  if (hasFullRecordsAccess(user)) {
    return next();
  }

  if (Array.isArray(user && user.groups) && user.groups.length > 0) {
    return next();
  }

  auditHpcAccess({
    action: "denied",
    user,
    path: (req && req.originalUrl) || "-",
    outcome: "no-group-membership",
  });
  return res.status(403).send({ error: "You do not belong to any group" });
};

module.exports = { auditHpcAccess, requireHpcGroupAccess, AUDIT_PREFIX };
