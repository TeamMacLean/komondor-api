# Register existing archive directories with retained history

This implements **step 1 only**: create the 23 missing Project records in the
22 October reconciliation preview. No production execution has occurred as part
of implementing it. It does not repair the three Jones File paths, create
Sample/Run/Read/AdditionalFile records, retire records, copy to S3 or delete files.
Those remain separate steps.

The reviewed [target file](archive/batches/2026-10-16/reconciliation-preview-2026-10-22/registration-targets.json)
contains 17 Talbot directories and Courville with owner `shrestha`, and five
additional Saunders directories with owner `winj`. The five already-registered
Saunders projects retain `winj`/`kamouns`; this tool does not update them.
Unix ownership and file contents stay unchanged. All new projects disable Nudge
and ENA submission, and identify the owner as an administrative custodian in their
description/provenance. No scientific owner, historical upload or old creation
date is invented.

## What is preserved

Each registration is one atomic MongoDB insertion containing:

- Its preallocated Project ID, real directory spelling and chosen owner.
- `registrationProvenance`: source entry/reference, decision-file digest, original
  source owner label, newly observed Unix UID/GID and root identity, observation
  time, exact root and the reviewed plan digest.
- `reconciliationHistory`: explicit **before: absent**, complete created values,
  registration time, acting operator/OS user, reason and decision authority.

The registration timestamp is the actual insertion attempt's time. Source
observations retain their own dates. UID/GID in `rootStat` are freshly observed;
`sourceUnixOwner` retains the label from the earlier source evidence and is not a
fresh directory-service lookup.

No existing document is changed, so there is no overwritten original Project to
export in this step. The pre-execution plan records that absence and its supporting
filesystem evidence. After each insert, the tool exports the full created document
as BSON (preserving native types), plus a readable JSON receipt. Later corrections
will require their own complete before-images and atomic history append; step 1
does not implement a general-purpose update/reversal tool.

## Preconditions

1. Independently review the target file and code. Deploy this API/model version
   before exposing newly registered records to application writers. Old Project
   hooks can lowercase/recompute their roots. Do not apply with an older API model
   and assume the registration is protected.
2. Use an explicitly configured `MONGODB_URI` and canonical `DATASTORE_ROOT`.
   The CLI loads the repository `.env` but will not derive a default URI from a
   port. Set `ARCHIVE_DATABASE` to the **reviewed database name**; the command checks
   it against the connection. Do not print credentials into the evidence log.
3. The projects collection must already have full unique indexes on `name`,
   `safeName` and `path`. This tool never creates indexes or implicitly maintains
   schemas. Missing indexes require a separate deployment decision.
4. Choose a new, private evidence directory outside both the checkout and datastore,
   and an independently retained backup location. Keep the normal database backup.

## Prepare a reviewable plan

Run from the reviewed API checkout. Set `ARCHIVE_WORK_DIR` to a fresh execution
directory under the approved `/storage` evidence location, and `ARCHIVE_ACTOR` to
the actual operator. The variable checks below deliberately stop if values have
not been supplied.

```bash
set -e
set -o pipefail
umask 077
: "${ARCHIVE_DATABASE:?Set the reviewed database name}"
: "${ARCHIVE_WORK_DIR:?Set a new evidence directory outside checkout/datastore}"
: "${ARCHIVE_ACTOR:?Set the acting operator}"

node scripts/register-archive-projects.js prepare \
  --targets docs/archive/batches/2026-10-16/reconciliation-preview-2026-10-22/registration-targets.json \
  --work-dir "$ARCHIVE_WORK_DIR" \
  --database "$ARCHIVE_DATABASE" \
  --actor "$ARCHIVE_ACTOR"
```

Preparation queries MongoDB and inventories filesystem metadata. It does **not**
read sequencing payloads for checksums, create a project, move bytes or send mail.
It refuses mismatched totals, symlinks/special entries, partial-transfer files,
missing users/groups, existing project claims and existing catalogue paths beneath
the candidate root. It preserves mixed case and dots in the directory name as
both `safeName` and `path`, with a provenance marker that prevents later normal
Project validation from regenerating them.

Review `plan.json`: all 23 roots, owners, group identities, file counts/bytes,
before-absent states and new IDs. Record the displayed `planSha256` externally as
`ARCHIVE_PLAN_SHA256`. Do not regenerate a digest from a changed plan and call it
the reviewed version. Preparation never overwrites an older plan.

## Retain the backup and open the approved execution window

Copy the exact `plan.json` into the independently retained evidence store. Its
embedded target bytes and operation IDs make it self-contained. Set
`ARCHIVE_BACKUP_PLAN` to an accessible copy of that retained plan outside the
working evidence directory, checkout and datastore. The tool checks byte equality
and refuses the same file/hard link. This check cannot establish independent
failure domains: the operator must actually retain the independent backup.

Use the established quiescence procedure: stop **all** API instances, drain
ingest/MD5 work including embedded AdditionalFile operations, pause Power, and
freeze external writers. Keep writers stopped throughout registration. Create a
quiescence JSON receipt outside the checkout, with these fields filled from the
actual window (the booleans are attestations, not actions the CLI performs):

```json
{
  "actor": "ACTUAL_OPERATOR",
  "planSha256": "REVIEWED_PLAN_DIGEST",
  "recordedAt": "ACTUAL_UTC_WINDOW_START",
  "expiresAt": "UTC_TIME_WITHIN_ONE_HOUR_OF_START",
  "allApiInstancesStopped": true,
  "powerPaused": true,
  "externalWritersFrozen": true,
  "backupIndependentlyRetained": true,
  "apiReadyUrls": ["ACTUAL_DIRECT_API_READINESS_URL_FOR_EACH_INSTANCE"]
}
```

Set `ARCHIVE_QUIESCENCE_RECEIPT` to its path. The tool requires an unexpired receipt,
checks each listed API endpoint refuses connections, and rejects unfinished ingest
or Run/MD5 work. It cannot discover unlisted API instances or external writers;
the operator's all-instance/external-writer attestation is required. A network
timeout is not accepted as proof of shutdown.

## Apply only in that window

```bash
: "${ARCHIVE_BACKUP_PLAN:?Set the verified backup-plan path}"
: "${ARCHIVE_PLAN_SHA256:?Set the externally recorded reviewed digest}"
: "${ARCHIVE_QUIESCENCE_RECEIPT:?Set the live window receipt path}"

node scripts/register-archive-projects.js apply \
  --work-dir "$ARCHIVE_WORK_DIR" \
  --database "$ARCHIVE_DATABASE" \
  --actor "$ARCHIVE_ACTOR" \
  --backup-plan "$ARCHIVE_BACKUP_PLAN" \
  --plan-sha256 "$ARCHIVE_PLAN_SHA256" \
  --quiescence-receipt "$ARCHIVE_QUIESCENCE_RECEIPT" \
  --execute \
  2>&1 | tee "$ARCHIVE_WORK_DIR/apply-$(date -u +%Y%m%dT%H%M%SZ).log"
```

The tool binds the plan to the database/collection identity, datastore and a digest
of its relevant source files. It rechecks the entire batch before any insert and
again checks each root/claim before its insert. The inventory is metadata evidence,
not content-integrity proof; normal archival later performs the necessary hashes.
No ordinary save hooks, email or filesystem-create/move functions are invoked.

Success produces one `result-ENTRY-RUN.json` and BSON export per project and a
`completed-RUN.json`. Archive the whole execution directory after completion and
verify it is backed up. Check the live application's owner, path, no-Nudge and ENA
settings after restarting the reviewed release. New projects remain HPC records;
registration does not claim their contents are archived or scientifically catalogued.

## Interruptions and reversal

On interruption, keep the original plan/IDs. Restore the identical plan from the
backup if necessary. Its embedded targets permit recovery even if the convenience
`targets.json` is lost. Renew the quiescence receipt after re-establishing the
window, then rerun the same apply command as the same actor and operating-system
account.

An inserted row already contains its creation history even if the process died
before exporting its receipt. Resume verifies the exact stored result, issues a
new receipt and continues without adding a second Project or history event.
`failed-RUN.json` records failures during execution; lack of a per-entry receipt
does not prove no insert occurred. Missing prepare evidence requires investigation,
not deleting partially created rows or making a fresh plan over them.

Later edits, newly attached dependents, changed directories or changed code/DB
identity stop resume. The CLI never rolls back by overwriting or deleting a Project.
A later reversal/retirement needs review of dependents and storage state and must
retain this history. Keep the writer window controlled while resolving a partial
batch; restore services deliberately according to the established runbook.

## Reading the history

Administrators can use authenticated
`GET /project/reconciliation-history?id=PROJECT_ID`; other users receive 403.
Ordinary Project JSON omits the operational provenance/history. For CLI export:

```bash
node scripts/register-archive-projects.js inspect \
  --project-id "$ARCHIVE_PROJECT_ID" --database "$ARCHIVE_DATABASE"
```

Normal API/model writes cannot replace the provenance/history, change the pinned
identity or delete a registered Project. Description and storage-lifecycle updates
remain possible. Raw database administrator access is still powerful; this is
application/tool protection backed by retained evidence, not tamper-proof storage.

See the [original-value design](archive/batches/2026-10-16/reconciliation-preview-2026-10-22/ORIGINAL_VALUES_AND_CORRECTIONS.md)
and the [batch plan](archive/batches/2026-10-16/README.md). Step 2 path corrections,
classification, retirement and archive pilots remain separate work.
