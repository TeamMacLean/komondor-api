/**
 * Audit trail for the shared HPC staging directory.
 *
 * HPC_TRANSFER_DIRECTORY is a single flat inbox shared by every group: nothing
 * in the schema records which group a staging subdirectory belongs to, so no
 * layer of the application can authorise access to one. That is a deliberate,
 * documented decision (see BREAKING_CHANGES.md entry 32), not an oversight —
 * imposing a naming convention would break the existing `scp` workflow, and
 * real uploads already arrive under names like "/WGS_Test/01.RawData" that
 * carry no group at all.
 *
 * When a risk is accepted rather than removed, the control that remains is
 * attribution. Every read of, and every claim against, the staging area emits
 * one line here naming the caller and the exact path, so a cross-group claim —
 * which both moves another group's data into the claimant's datastore *and*
 * unlinks it from the inbox — is detectable after the fact even though it
 * cannot be refused before it happens.
 *
 * Lines go to stdout deliberately. Production splits stderr and stdout into
 * separate files; these are a normal-operation audit trail, not errors, and
 * putting them in the error log would bury the things that are.
 */

/** Prefix chosen so an operator can grep one token for the whole trail. */
const AUDIT_PREFIX = "[HPC-AUDIT]";

/**
 * Records an access to the shared staging area.
 *
 * @param {object} details
 * @param {string} details.action - What happened: "list", "read", "md5" or "claim".
 * @param {object} details.user - The acting user; only the username is recorded.
 * @param {string} details.path - The resolved absolute path that was acted on.
 * @param {string} [details.outcome] - "ok" or a short refusal reason.
 * @param {string} [details.detail] - Anything else worth keeping, e.g. the run id.
 */
const auditHpcAccess = ({ action, user, path, outcome = "ok", detail }) => {
  const username = (user && user.username) || "unknown";

  console.log(
    [
      AUDIT_PREFIX,
      `action=${action}`,
      `user=${username}`,
      `path=${path}`,
      `outcome=${outcome}`,
      detail ? `detail=${detail}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
};

/**
 * Refuses a caller who belongs to no group at all.
 *
 * This is the only membership question the staging area can actually answer.
 * It cannot tell whether *this* group may read *that* directory — there is no
 * mapping to consult — but a principal with no group membership has no
 * legitimate reason to enumerate the inbox, and today `isAuthenticated` alone
 * lets one through. Narrow, but real, and it fails closed.
 *
 * Must be used after isAuthenticated.
 *
 * @returns {Function} Express middleware.
 */
const requireAnyGroupMembership = () =>
  async function requireAnyGroupMembershipMiddleware(req, res, next) {
    try {
      const { groupsICanRead } = require("./groupAccess");
      const groups = await groupsICanRead(req.user);

      if (!groups || groups.length === 0) {
        console.error(
          `${AUDIT_PREFIX} action=denied user=${
            (req.user && req.user.username) || "unknown"
          } reason=no-group-membership`,
        );
        return res.status(403).send({
          error: "You do not belong to any group",
        });
      }

      return next();
    } catch (error) {
      // Failing open here would hand the inbox to anyone the group lookup
      // happened to error on, so a lookup failure is a refusal.
      console.error(`${AUDIT_PREFIX} group lookup failed:`, error);
      return res
        .status(500)
        .send({ error: "Failed to verify group membership" });
    }
  };

module.exports = { auditHpcAccess, requireAnyGroupMembership, AUDIT_PREFIX };
