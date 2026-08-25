/**
 * Read-only LDAP + group-matching diagnostic.
 *
 * Run on a machine that can reach the LDAP server and (optionally) the
 * production Mongo instance — typically the prod box itself:
 *
 *   node scripts/ldap-diagnostic.js <username>
 *   node scripts/ldap-diagnostic.js <username> --no-db
 *
 * It answers, for one user, the questions that matter when someone loses
 * access:
 *
 *   1. Does the directory return a record for the username at all?
 *   2. Is memberOf present, and does it arrive as an array or a plain string?
 *      (LDAP returns single-valued attributes as strings — a user in exactly
 *      one group is the string case.)
 *   3. Does the explicit attribute list the app now requests return the same
 *      memberOf as the server's default set?
 *   4. Which Mongo groups would GroupsIAmIn resolve for those memberOf values
 *      — i.e. what would a freshly issued token contain? Values that only
 *      match case-insensitively are flagged, since exact-case matching (the
 *      pre-Aug-2026 behaviour) would have dropped them.
 *
 * Everything is read-only: an LDAP bind + search with the service account and
 * Mongo find()s. Nothing is written.
 */

require("dotenv").config();

const ldap = require("ldapjs");
const { escapeLdapFilterValue, USER_SEARCH_ATTRIBUTES } = require("../lib/ldap");

const args = process.argv.slice(2).filter((a) => a !== "--no-db");
const skipDb = process.argv.includes("--no-db");
const username = args[0];

if (!username) {
  console.error("Usage: node scripts/ldap-diagnostic.js <username> [--no-db]");
  process.exit(1);
}

const { LDAP_URL, LDAP_BIND_DN, LDAP_BIND_CREDENTIALS, LDAP_SEARCH_BASE, LDAP_SEARCH_FILTER } =
  process.env;

for (const name of ["LDAP_URL", "LDAP_BIND_DN", "LDAP_BIND_CREDENTIALS", "LDAP_SEARCH_BASE", "LDAP_SEARCH_FILTER"]) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

// A hung LDAP server or Mongo connection should fail the script, not hang it.
const watchdog = setTimeout(() => {
  console.error("\nTimed out after 30s — is the LDAP server / Mongo reachable from here?");
  process.exit(1);
}, 30000);
watchdog.unref();

const searchFilter = LDAP_SEARCH_FILTER.replace(
  "{{username}}",
  escapeLdapFilterValue(username),
);

/**
 * Binds as the service account and searches for the user.
 *
 * @param {string[]|undefined} attributes - Explicit attribute list, or
 *   undefined for the server's default set.
 * @returns {Promise<object|null>} The entry as ldapauth-fork sees it
 *   (entry.object), or null if no entry matched.
 */
function searchUser(attributes) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({ url: LDAP_URL });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      client.unbind(() => {});
      fn(value);
    };

    client.on("error", (err) => finish(reject, err));

    client.bind(LDAP_BIND_DN, LDAP_BIND_CREDENTIALS, (bindErr) => {
      if (bindErr) return finish(reject, bindErr);

      const options = { scope: "sub", filter: searchFilter };
      if (attributes) {
        options.attributes = attributes;
      }

      client.search(LDAP_SEARCH_BASE, options, (searchErr, res) => {
        if (searchErr) return finish(reject, searchErr);

        let found = null;
        res.on("searchEntry", (entry) => {
          found = entry.object;
        });
        res.on("error", (err) => finish(reject, err));
        res.on("end", () => finish(resolve, found));
      });
    });
  });
}

/**
 * Prints one search result, focusing on memberOf shape and values.
 */
function report(label, record) {
  console.log(`\n=== ${label} ===`);
  if (!record) {
    console.log("NO ENTRY FOUND for filter:", searchFilter);
    return;
  }

  console.log("dn:", record.dn);
  const attributeNames = Object.keys(record).filter((k) => k !== "dn" && k !== "controls");
  console.log("attributes returned:", attributeNames.join(", ") || "(none)");

  const rawMemberOf = record.memberOf != null ? record.memberOf : record.memberof;
  if (rawMemberOf == null) {
    console.log("memberOf: MISSING — group resolution would find nothing for this user");
    return;
  }

  const values = Array.isArray(rawMemberOf) ? rawMemberOf : [rawMemberOf];
  console.log(
    `memberOf: ${Array.isArray(rawMemberOf) ? "array" : "PLAIN STRING (single group)"}, ${values.length} value(s):`,
  );
  values.forEach((v) => console.log(`  - ${v}`));
}

/**
 * Replicates GroupsIAmIn's matching against the groups collection and shows
 * which memberOf values resolve to which groups.
 */
async function compareWithMongo(record) {
  const rawMemberOf = record.memberOf != null ? record.memberOf : record.memberof;
  const memberOf = rawMemberOf == null ? [] : Array.isArray(rawMemberOf) ? rawMemberOf : [rawMemberOf];

  const mongoose = require("mongoose");
  const mongoosePort = process.env.MONGODB_PORT || 27017;
  await mongoose.connect(`mongodb://localhost:${mongoosePort}/komondor`, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const groups = await mongoose.connection
    .collection("groups")
    .find({}, { projection: { name: 1, safeName: 1, ldapGroups: 1, deleted: 1 } })
    .toArray();

  console.log(`\n=== Mongo group matching (${groups.length} groups in collection) ===`);

  const resolved = [];
  for (const value of memberOf) {
    const matches = [];
    for (const group of groups) {
      for (const ldapString of group.ldapGroups || []) {
        if (ldapString.toLowerCase() === value.toLowerCase()) {
          matches.push({ group, exact: ldapString === value });
        }
      }
    }

    if (matches.length === 0) {
      console.log(`  UNMATCHED: ${value}`);
    } else {
      for (const { group, exact } of matches) {
        const flags = [
          group.deleted ? "DELETED" : null,
          exact ? null : "case-insensitive only — exact-case matching would have missed this",
        ]
          .filter(Boolean)
          .join("; ");
        console.log(`  ${value}\n    -> ${group.name}${flags ? `  [${flags}]` : ""}`);
        resolved.push(group);
      }
    }
  }

  // Soft-deleted groups are excluded, matching Group.GroupsIAmIn.
  //
  // This memberOf-based prediction is now accurate for FULL_RECORDS_ACCESS_USERS
  // too. getUserForToken stamps the token in WRITE mode, in which a full-access
  // user falls through to their real membership; in the old read-mode call they
  // were stamped with every group in the collection and this line under-reported
  // for them.
  const usable = [...new Set(resolved.filter((g) => !g.deleted).map((g) => g.safeName || g.name))];
  console.log(
    `\nA fresh login would resolve ${usable.length} group(s): [${usable.join(", ")}]`,
  );
  if (usable.length === 0 && memberOf.length > 0) {
    console.log(
      "None of the user's memberOf values match any group's ldapGroups — compare the strings above against the groups collection.",
    );
  }

  await mongoose.connection.close();
}

(async () => {
  console.log(`Diagnosing LDAP lookup for "${username}"`);
  console.log("server:", LDAP_URL);
  console.log("filter:", searchFilter);

  const withDefaults = await searchUser(undefined);
  report("Server default attributes (no attribute list requested)", withDefaults);

  const withExplicit = await searchUser(USER_SEARCH_ATTRIBUTES);
  report("Explicit attribute list (what the app requests at login)", withExplicit);

  const record = withExplicit || withDefaults;
  if (record && !skipDb) {
    await compareWithMongo(record);
  } else if (skipDb) {
    console.log("\nSkipping Mongo comparison (--no-db)");
  }

  process.exit(0);
})().catch((err) => {
  console.error("\nDiagnostic failed:", err);
  process.exit(1);
});
