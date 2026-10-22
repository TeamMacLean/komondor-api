# Archive database reconciliation with retained history

The 22 October production plan is **applied and verified**. See the
[execution record](archive/batches/2026-10-16/reconciliation-production-2026-10-22/README.md)
and [per-entry outcomes](archive/batches/2026-10-16/reconciliation-production-2026-10-22/OUTCOMES.md).
The procedure below documents the controls; do not rerun preparation or application
as a routine follow-up to the already completed batch.

This is the database continuation of the 22 completed Project registrations.
George authorised completing the remaining production database steps on 22 October
2026. No owner contact, bulk checksum sweep, physical move, S3 transfer or deletion
is included. The source decisions and KEEP entries remain unchanged.

## Behaviour

- Archive overlay, MD5 verification, directory comparisons and copied web locations
  use the stored physical File path. A derived `raw/` path is retained as an archive
  discrepancy, never used silently as a fallback. Invalid, cross-project and symlink
  paths are refused. Upload `originalName` and historical checksum fields survive.
- Three evidenced Jones filenames are corrected. Six Project roots and their
  uniquely matched descendant directories retain the actual case/punctuation.
  No directory is renamed. Corrected identities are protected from normal model
  saves, updates, bulk writes and deletion.
- Existing uncatalogued regular files are represented as File + AdditionalFile,
  attached to an evidenced Run/Sample or the Project. Scientific classification
  remains explicitly provisional. No new Reads, pairing, Samples or scientific
  metadata are invented; file bytes stay in their original locations.
- Previously collected byte observations are stored separately from upload
  verification, only when the recorded file identity still matches. They retain
  their original observation date and evidence reference. No legacy `MD5`,
  `destinationMd5` or mismatch is filled/cleared, and no new audit sweep runs.
- The two confirmed-empty Projects and their dependent records are retired,
  preserving IDs and all original fields. Normal model queries and writes exclude
  retired records; administrators can inspect them using the endpoint below.
  Nudge is disabled and ENA submission is disabled on the retired Projects.
- The six direct-disposal decisions remain pending manual deletion. Their physical
  data and records are retained. Retiring empty projects is not an S3 storage state.
- `archiveReconciliations` retains per-entry dispositions, file inventories,
  unclassified/association holds and unregistered empty directories. Symbolic
  links are recorded as links without following them or inventing regular Files.

The subsequent, explicitly approved [Project 2178 consolidation](archive/batches/2026-10-16/project-2178-consolidation-2026-10-22/README.md)
is also applied and verified. It moved the intact numeric directory into
`legacy_project_2178` beneath its existing named Project, preserving `talbotn`,
all original values and both decision entries. The last known association hold
is resolved. The Project now contains 39 catalogued files and must be archived
once, covering entries `ntalbot-026` and `ntalbot-031`. This separate approval
covered that one move; the database-only procedure above did not move files.

## Prepare and review

The administrative CLI is `scripts/reconcile-archive-database.js`. It requires an
explicit `MONGODB_URI`, canonical `DATASTORE_ROOT`, database name, actor and private
work directory outside the checkout/datastore. Never print the URI into evidence.

```bash
node scripts/reconcile-archive-database.js prepare \
  --input "$RECONCILIATION_INPUT" --work-dir "$RECONCILIATION_WORK" \
  --database "$RECONCILIATION_DATABASE" --actor "$RECONCILIATION_ACTOR"
```

Preparation reads production and inventories metadata; it makes no database writes.
Review the exact proposed operations and reported digest. The plan retains complete
BSON before-images of changed documents, preallocated new IDs, changed fields,
physical observations, database-context digests and implementation identity. Keep
full database backups and plans outside Git. Git holds compact review receipts.

Test the implementation on a disposable database, then restore an independently
retained production backup into an isolated local database. Retain the exact plan
independently. Existing records may have acquired new data since preparation:
changed documents, associations, indexes or trees must stop execution.

## Apply in the controlled window

Stop every API instance, pause Power and Nudge, drain accepted ingest/MD5 work and
freeze external writers. Pause Web for its matching file-location build deployment.
The operator records the freeze; the service controller has bounded automatic
recovery. Retain an independent complete before-image snapshot before mutation.

```bash
node scripts/reconcile-archive-database.js apply \
  --work-dir "$RECONCILIATION_WORK" --database "$RECONCILIATION_DATABASE" \
  --actor "$RECONCILIATION_ACTOR" --backup-plan "$RECONCILIATION_BACKUP_PLAN" \
  --plan-sha256 "$RECONCILIATION_PLAN_SHA256" \
  --quiescence-receipt "$RECONCILIATION_QUIESCENCE" --execute
```

Each correction and history append is one conditional MongoDB update. Each new
record carries creation history in its initial insert. The tool invokes no model
save hooks. An interrupted attempt resumes only from its original sealed plan and
execution timestamp, accepting an exact already-applied result or exact original;
anything else stops. Do not generate a fresh plan over partially applied records.
The plan and atomic document state are the recovery journal; a missing completion
receipt is not evidence that no database write occurred.

Compare all results with the reviewed operations, and verify every unaffected
record and every original index against the backup. Recheck physical inventories.
Restart API first, verify readiness, then Web/Power/Nudge and read-only acceptance
checks. Do not return to the old API model after creating corrected identities.

## Audit access and recovery

`GET /admin/reconciliation-record?collection=files&id=<ObjectId>` requires an
administrator and accepts only the documented collection allowlist. It includes
retired records, original metadata and the appended history. Ordinary JSON omits
operational history; catalogued files expose a provisional classification label.
BSON evidence retains native types and absent/null distinctions.

`reverseCorrection` in the migration library is a recovery primitive, not a casual
rollback command. It requires the same frozen/backup window, an exact expected
result and a separately reviewed operation. It reverses only that operation's
fields, preserves the correction and reversal events, and refuses any later edit.
New catalogue records are never deleted by this helper. If they must be withdrawn,
review retirement while retaining their history and references. Do not restore an
old whole database over unrelated later work.

The batch evidence and actual execution status are recorded in
[the production reconciliation record](archive/batches/2026-10-16/reconciliation-production-2026-10-22/README.md).
