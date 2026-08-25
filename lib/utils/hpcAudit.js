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

module.exports = { auditHpcAccess, AUDIT_PREFIX };
