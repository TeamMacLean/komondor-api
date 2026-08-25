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
 * Every field is emitted as a JSON string literal, and that is load-bearing
 * rather than cosmetic. Interpolating the path raw made the trail forgeable by
 * the very people it exists to attribute: HPC_TRANSFER_DIRECTORY is writable by
 * unprivileged users by design, so a file named with an embedded
 * "\n[HPC-AUDIT] ..." emitted a second, perfectly-formed record attributing a
 * cross-group claim to a colleague — or truncated the forger's own genuine
 * line. JSON.stringify escapes newlines, carriage returns and every other C0
 * control, and quotes the value, so one record is always exactly one line and a
 * reader can always tell where a value ends.
 *
 * safePath.cleanDirectoryName and safePath.safeBasename now refuse a control
 * character outright, so a name of that shape should no longer reach here at
 * all. The escaping stays regardless: not every value on a line comes through
 * one of those cleaners — `path` is sometimes a raw req.originalUrl, `detail`
 * is sometimes an error message — and a trail whose integrity depends on a
 * guard in another module is one refactor away from being forgeable again.
 *
 * Every line — including a refusal — goes to stdout deliberately. Production
 * splits stderr and stdout into separate files; these are a normal-operation
 * audit trail, not errors, and putting them in the error log would bury the
 * things that are, as well as splitting the trail across two files so that
 * grepping one token no longer returns all of it.
 */

/** Prefix chosen so an operator can grep one token for the whole trail. */
const AUDIT_PREFIX = "[HPC-AUDIT]";

/**
 * Renders one field as `key="value"`, with the value JSON-escaped.
 *
 * String() first so a non-string that reached here (an object path, a number)
 * still becomes a quoted scalar rather than a nested JSON structure a line
 * parser would have to understand.
 *
 * @param {string} key - The field name; developer-supplied, never user input.
 * @param {*} value - The field value, possibly attacker-controlled.
 * @returns {string} The escaped `key="value"` pair.
 */
const auditField = (key, value) => `${key}=${JSON.stringify(String(value))}`;

/**
 * Records an access to the shared staging area.
 *
 * @param {object} details
 * @param {string} details.action - What happened: "list", "read", "md5" or
 *   "claim" for an access; "denied" when the request was refused before it got
 *   as far as a path; "admin-no-groups" when an admin was let past the
 *   membership check because the system holds no live group.
 * @param {object} details.user - The acting user; only the username is recorded.
 * @param {string} details.path - The resolved absolute path that was acted on,
 *   or the request target when the access was refused before one was resolved.
 * @param {string} [details.outcome] - "ok" or a short refusal reason. The
 *   vocabulary is per-action, and is recorded here so an operator writing a
 *   grep knows what to expect:
 *     - "list", "read", "md5": "ok", or a refusal reason from the route.
 *     - "claim": "ok", "ok-reconciled" (the bytes were already at the
 *       destination and the move was adopted rather than repeated), "failed",
 *       and "refused-outside-transfer-directory".
 *     - "denied": "no-group-membership" or "group-lookup-failed".
 *     - "admin-no-groups": "allowed-empty-group-collection".
 * @param {string} [details.detail] - Anything else worth keeping, e.g. the run id.
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

      // Array.isArray, not a truthiness test: the guard exists to fail closed,
      // and `!groups || groups.length === 0` admitted every truthy non-array —
      // a bare object, a string, a Mongoose query that was never awaited — as
      // though it were a populated membership list.
      if (!Array.isArray(groups) || groups.length === 0) {
        // An admin's readable set is *every* non-deleted group, so an empty
        // list from an admin means the system holds no live group at all — a
        // fresh install, or a deployment where every group was soft-deleted —
        // not that the admin belongs to nothing. Refusing them there locks the
        // only person who can create a group out of the endpoints they need to
        // diagnose why there are none, and it is unrecoverable through the API.
        // So an admin passes, and because passing without a membership check is
        // exactly the situation this module exists to cover, the passage is
        // recorded instead. `=== true` rather than a truthiness test: isAdmin is
        // a real boolean everywhere it is set (models/User.js, getUserForToken),
        // so anything else reaching here is a shape change and fails closed.
        if (req.user && req.user.isAdmin === true) {
          auditHpcAccess({
            action: "admin-no-groups",
            user: req.user,
            path: (req && req.originalUrl) || "-",
            outcome: "allowed-empty-group-collection",
          });
          return next();
        }

        // Through auditHpcAccess, not a bare console.error: a refusal is part
        // of the trail an operator greps, and the module's whole promise is
        // that one token on stdout returns all of it.
        auditHpcAccess({
          action: "denied",
          user: req.user,
          path: (req && req.originalUrl) || "-",
          outcome: "no-group-membership",
        });
        return res.status(403).send({
          error: "You do not belong to any group",
        });
      }

      return next();
    } catch (error) {
      // Failing open here would hand the inbox to anyone the group lookup
      // happened to error on, so a lookup failure is a refusal.
      //
      // Emitted twice on purpose, and they are not duplicates: the refusal is a
      // trail record and belongs on stdout with the rest of the trail, while
      // the exception itself is a genuine error and belongs in the error log
      // with a stack. The audit line carries no stack, so the two do not say
      // the same thing.
      auditHpcAccess({
        action: "denied",
        user: req.user,
        path: (req && req.originalUrl) || "-",
        outcome: "group-lookup-failed",
        detail: (error && error.message) || "unknown error",
      });
      console.error(`${AUDIT_PREFIX} group lookup failed:`, error);
      return res
        .status(500)
        .send({ error: "Failed to verify group membership" });
    }
  };

module.exports = { auditHpcAccess, requireAnyGroupMembership, AUDIT_PREFIX };
