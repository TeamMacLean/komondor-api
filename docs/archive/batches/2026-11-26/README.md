# Manual HPC keep-date batch — 26 November 2026

Prepared and tested locally; **not executed in production by this preparation**.
George requested one operator-run mongosh batch and a separate read-back command.
The [retention decision](../../HPC_RETENTION.md#keep-dates-to-set-george) defines
the scope: Sara's Gargy through **26 November 2027**, and Joe Win's eleven
Kamoun KEEP Projects through **26 November 2031**, all at 23:59:59.999 UTC.
These are fixed dates, not dates recalculated whenever the command runs.

Gulnara's destination follows normal five-year archive eligibility. Neither it
nor its four source Projects is written by this batch. Source exclusions remain
until the reassignment is verified and release reviewed. No file, S3 operation,
email, service change or archive finalization is performed.

## Operator procedure

Run as `deeks` in the API repository on **v1333**. Fetch the reviewed branch,
then extract `keep-dates.mongosh.js` from its exact reviewed commit into a
fresh temporary file. This avoids changing the production checkout or requiring
an application deployment. Retain the shell variable pointing to that file for
the second command. Use the exact commit supplied with the reviewed commands,
not an unreviewed future branch head.

The operator commands use:

```javascript
load(process.env.KOMONDOR_KEEP_SCRIPT);
komondorKeepDates("apply");
```

Then, in a separate mongosh invocation on
`mongodb://localhost:28015/komondor?directConnection=true`:

```javascript
load(process.env.KOMONDOR_KEEP_SCRIPT);
komondorKeepDates("verify");
```

Expected final read-back: `ok: true`, `verified: 12`, `expected: 12`, with the
agreed dates/requesters, BSON type `date`, and matching latest history. Review
the project names, paths and URLs in the output. Paste it back into the working
chat. Any refusal or mismatch needs inspection before further writes.

`preview` is also available and writes nothing. Loading the file alone only
defines the function. A failed apply can have completed some Projects: this is
12 separately atomic updates, not a single database transaction. The stop
receipt records known successes; a timed-out last write may also have succeeded.
Do not automatically undo, force past a refusal or blindly retry.

## Safeguards and evidence

- Production execution requires v1333, local MongoDB port 28015, database
  `komondor`, and OS account `deeks` or `tsldata`.
- All twelve IDs, canonical paths, live storage/retirement state and retention
  values are checked before the first write. The eleven Joe paths/IDs match
  the original KEEP selection. Missing targets, invalid date types, different
  existing dates or metadata, and non-array history containers cause refusal.
- Exact already-applied records are adopted only with matching latest audit
  evidence. A repeat does not add another history entry.
- Full before-images for the twelve targets and five Gulnara Projects are saved
  as private Extended JSON under `~/.komondor-keep-20261126-*` before writes.
  The receipt prints the exact directory. Preserve it after completion.
- Each update matches the entire observed document, then atomically sets only
  `preserveOnHpcUntil`, `hpcPreservationRequestedBy`, `hpcPreservationReason`,
  `updatedAt`, and appends the schema-compatible `hpcPreservationHistory` event.
  `by` records the actual OS operator; the receipt records George's authorization.
  It does not impersonate an application login or invoke ordinary save hooks.
- All non-retention fields are compared after each update; all five Gulnara
  documents must remain unchanged. History is preserved, including valid older
  entries lacking newer metadata. This is not a repair of historical audit data.
- The read-back command queries raw stored BSON, verifies all twelve values and
  their latest audit entries, and shows the untouched-by-this-command Gulnara
  records. It does not establish filesystem presence or a fresh S3 verification.

This narrow, operator-authorized raw-database operation follows the retention
endpoint's audit shape and adds whole-document concurrency checks. The normal
project-page API remains the routine route for later individual changes.
`storage.*` and `archiveMigration.*` are never written.

## Validation

Run locally with installed `mongod` and `mongosh`:

```sh
python3 docs/archive/batches/2026-11-26/test-keep-dates.py
```

The runner starts a fresh loopback-only MongoDB with a temporary data directory,
uses an isolated database, tests the actual mongosh script and cleans up its own
process/data. It never connects to the application database. Fifteen scenarios
passed on MongoDB 7.0.2 / mongosh 2.4.2: preview, success, repeat, missing/wrong
identity, retirement markers, malformed storage/date/history, conflicting
retention, missing Gulnara destination, absent audit, legacy audit preservation,
and concurrent edit followed by inspected partial adoption. BSON Int32, Long,
Double and Decimal128 values survive unchanged. Private backup permissions are
also checked.

MongoDB references: [script loading](https://www.mongodb.com/docs/mongodb-shell/write-scripts/),
[connection URI inspection](https://www.mongodb.com/docs/manual/reference/method/mongo.geturi/),
and [Extended JSON backup serialization](https://www.mongodb.com/docs/mongodb-shell/reference/ejson/stringify/).
