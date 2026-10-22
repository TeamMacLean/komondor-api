# Production registration — 22 October 2026

**Completed:** 22 Projects were created and verified in production, and API,
Power and Nudge are back online. See [actual outcomes](OUTCOMES.md) and the
[deployment receipt](deployment-receipt.json). No existing record, file content,
filesystem ownership or archive/disposal state was changed by this operation.

## Scope and authority

George authorised proceeding through production registration in the archive chat:
“ok proceed maximally … including the prod db changes”. This supersedes the
earlier preview's implementation-only restriction for step 1. It does not authorise
deletion, owner contact, file moves, path corrections or a checksum sweep.

The fresh production preview selects **22 new Project records**, with 17 assigned
to `shrestha` and five to `winj`. One of the original 23 proposals is held because
the live check found a conflicting existing catalogue association. The five existing
Saunders `winj`/`kamouns` records remain unchanged.

- [Exact execution targets](execution-targets.json).
- [Pre-execution checks and restored-backup counts](execution-ready.json).
- Release: `4cd738e6c2d9d508b2248ff4298061e576109c19`.
- Previous production release: `c6b9d77db069fa6dd808367086ff358302565b2f`.
- Reviewed plan SHA-256: `1aa44aeacc5ae4c921b6498fa56e82a0a35a68bd897bcd1bdd2b9a11dddff99d`.
- Server evidence: `/storage/komondor-registration-20261022/`.
- Independent Mac copy: `/Users/deeks/.codex/artifacts/archive-registration-production-20261022/`.

The source plan and complete database backups remain in those private evidence
locations, outside Git. The source plan records the preallocated IDs, absent-before
states, real paths, filesystem observations and exact target bytes.

## Live discovery: hold `ntalbot-031`

`/mnt/reads/ntalbot/project_2178` contains 31 files / 18,228,463,024 bytes. Two
existing Runs store paths under it:

- `5fc012c3a3efcb29338b8388`, through Sample `5fc012bfa3efcb29338b8042`.
- `5fc012c3a3efcb29338b85c0`, through Sample `5fc012bfa3efcb29338b8094`.

Both Samples already belong to Project `5fc012bda3efcb29338b7cf7`, **Study of pmk1AS
mutant in presence and absence of an inhibitor**, whose owner and secondary owner
are `talbotn`. The named Project root also exists, containing eight different
raw-file paths / 23,621,445,468 bytes. The two legacy Runs have no Read or
AdditionalFile associations in the inspected database.

This is evidence of an existing scientific association, not a safe basis for a
second Project under `shrestha`. [The exact selected records](claim-inspection.json)
are retained. Registration refused the original whole batch before any database
write; the operator then prepared a new 22-target selection with this hold explicit.
Do not discard the 31 files, change ownership, repoint the existing Project away
from its other tree or merge/move directories as part of registration. Resolve the
two-root association in the later path/catalogue stage, preserving both sets of
records and their history. The original proposal remains retained as historical
evidence; this hold supersedes only its proposed new registration.

## Deployment and recovery checks

The production diff was reviewed against the actual running base. Besides the
registration implementation, the intervening runtime changes are the previously
reviewed diagnostic-kind fix, collision-free smoke receipt names and disabled
automatic schema maintenance in the archive CLI. The production BSON dependency
already matches the pinned `1.1.6`; no dependency upgrade is needed.

The fresh read-only check found all required unique Project indexes, no unfinished
ingest/Run/MD5 work and no unfinished Power entries/tracking. A production dump of
all 16 collections was copied to the Mac, digest-checked and restored into an
isolated local MongoDB. The restored database has 339 Projects and 9,152 Files;
all collection counts are recorded in `execution-ready.json`.

The [service controller](window.cjs) requires the `tsldata` account and an explicit
external-writer attestation. It stops Nudge and Power, rechecks unfinished work,
then stops the API. It records a 15-minute write window and attempts service
recovery after completion or a 20-minute fallback deadline. It restarts dependent
services only once the API is ready. Dirty/unreviewed code, or old API code with
new registrations present, blocks restart and writes an attention receipt.

[Seven fault-injection scenarios](test-window.cjs) pass: normal completion,
unfinished work, dirty checkout, a stop failure, wrong release after registration,
API restart failure, and deadline recovery. These are controller simulations;
they do not stand in for observing the real services after execution.

[The snapshot helper](snapshot.cjs) exports native BSON before-images of all
existing documents during the paused window. After registration it compares every
original document and index, excluding only the 22 preallocated new Project IDs,
and rechecks the target filesystem metadata against the plan. Full before-images
are kept privately outside Git; final receipts distinguish prepared from applied.

## Execution state

**Applied and verified.** The controlled window began at 20:15:02 UTC and services
were restored at 20:18:20 UTC: approximately 3 minutes 18 seconds. George started
the service controller as `tsldata` on v1333, recording the external-writer
attestation; the registration CLI ran as `deeks` through the authenticated SSH
connection. All 22 preallocated IDs have exactly one creation-history event.

- Projects increased from **339 to 361**. Every one of the **30,083 original
  documents**, all collection names in the snapshot and their index
  definitions matched before and after. No original document was overwritten.
- All 22 source trees' root identities and entry metadata matched the prepared
  plan after registration. No file move, deletion, ownership change or extra
  payload checksum sweep was performed; this metadata comparison is not a new
  content-integrity claim.
- Full paused-window BSON before-images were copied to the Mac, digest-checked,
  and every document decoded before insertion. All 22 result receipts and their
  BSON exports were independently copied and digest-checked before restart.
- API readiness passed. All 22 ordinary Project GETs and 22 admin history GETs
  passed; ordinary JSON omits provenance/history. Unauthenticated history access
  returned 401 and non-admin access returned 403. These read-only localhost checks
  used in-memory, 60-second server-signed test tokens; no login or token was saved.
- Production runs release `4cd738e` on `codex/register-archive-projects`.
  No merge to master or push to origin was made. The old production branch and
  previous commit remain available; do not restart that old API against the new
  registrations without a separately reviewed compatibility/reversal procedure.

After the services restarted and the application checks completed, a second
[read-only database comparison](post-restart-check.json) again found no changes
to original documents or indexes, with all 22 registrations present and a clean
production checkout.

Application evidence is in [application-checks.json](application-checks.json);
service recovery is in [restored.json](restored.json). The full execution bundle
and database snapshots remain in the private server/Mac evidence directories.
`ntalbot-031` remains a technical hold for the subsequent association/path stage.

See the [registration runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md) and
[batch index](../README.md). Earlier preview policies and counts remain historical;
this file records the production selection and its technical hold.
