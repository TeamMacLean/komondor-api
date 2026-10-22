# Retaining original values during registration and path corrections

George accepts the registration/path correction approach. This document specifies
how the implementation should retain originals. **Step 1 registration is now
implemented locally**, including atomic before-absent/after creation history and
full BSON result exports; see the [runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md).
Existing-record corrections and reversal below remain a design for later steps.
Nothing has been applied to production. It does not add a checksum sweep.

The current value should say where the file really is. Its history should preserve
what the database previously said, why it changed and the evidence for that change.
Keep the same existing record IDs and relationships. A corrected path is not a
new scientific file, a new upload or evidence that the historical upload succeeded.

## Two retained copies of the evidence

1. **Full original records in the execution evidence bundle.** Immediately before
   applying a reviewed operation, read/export the complete documents it will change
   as canonical MongoDB Extended JSON, preserving ObjectIds, dates, numeric types
   and the distinction between absent and null fields. Include the relevant
   Project/Sample/Run/Read/AdditionalFile associations as context, even when they
   are not changed. Write a new bundle for each execution, never overwrite one.
   Record its digest and verify a durable independent copy before mutation. A
   database backup is useful in addition; it does not replace this exact record list.
2. **A compact history on each changed record.** Add an administrative
   `reconciliationHistory` entry containing the batch/operation IDs, observation
   and execution timestamps, acting operator, decision authority, reason, evidence
   bundle reference/digest, and each changed field's old and new value. Explicitly
   record whether the field existed before. Append this entry atomically with the
   actual correction to the same MongoDB document. Do not rely on a console log or
   a later best-effort NewsItem to explain an earlier update.

The full bundle is operational evidence stored outside the checkout and covered
by backup; Git holds the compact review plan, source evidence and bundle references.
Do not silently commit a complete production database export to Git. The earlier
read-only inventories selected particular fields: they are useful evidence, **not
complete before-images** and cannot substitute for the fresh execution export.

History must be append-only through the migration tooling, excluded from ordinary
client updates, and available to administrators for inspection/export. This is
not a claim that database administrators cannot alter it. Independent retained
exports and digests provide another record of what happened. For step 1, the Project schema/write protection and administrator read endpoint
are implemented and tested. Equivalent protection for later correction types
still requires implementation and testing.

## How the different corrections are represented

| Situation | Operational change | What stays in the history |
|---|---|---|
| Three Jones filename discrepancies | Update the validated physical File path from the recorded `.fastq.txt` spelling to the observed `.fastq` location. | Exact old path, new path, record IDs, reason, dated observations and existing targeted checksum evidence. |
| 107 files already have the correct stored location | Correct application/archive path resolution; do not rewrite these File records merely to create history. | Existing stored path and the earlier derived `raw/` expectation remain in batch evidence. |
| Case-mismatched or unregistered project root | Preserve the existing physical tree; retain the former registered/display/safe-name values before any reviewed metadata correction or root override. | Original Project values, canonical observed root and the evidence supporting it. This design does not select a new root-field schema or authorize a rename. |
| New Project for an existing directory | Insert one administrative registration with its approved owner, real physical root and actual registration time. | Explicit `before: absent`, source entry ID/name, directory spelling, Unix UID/GID/owner, observation date, decision authority and created document/ID. |

For the three File corrections, preserve the uploaded `originalName` as historical
metadata; do not rename bytes or silently change Read/Run/Sample identities to
make names agree. Consumers need to use the validated physical location.
Any other field change must appear in the reviewed before/after diff.

New registration is retrospective cataloguing. Do not backdate `createdAt`, invent
an original scientific owner, or put Unix `root`/`tsldata` into that role. All ten
Saunders entries use `winj`: five already do, and five new registrations will.
The 17 Talbot directories and Courville use `shrestha`. Existing secondary owners
remain; no new secondary owner is inferred. The unchanged Unix ownership stays
separately in the evidence.

## Applying and resuming a correction

- Produce the full proposed before/after diff and operation IDs first. Before
  applying, recheck the records, associations and physical identities against the
  reviewed proposal. Stop on a new or changed conflicting record.
- Use the reviewed writer-quiescence procedure. Existing save hooks can recalculate
  paths, move files or send emails: the migration must not trigger those side effects.
- Apply each existing-record correction with an expected-value condition and the
  history append in the same single-document atomic update. A nonmatch is a hold,
  not permission to overwrite the newer value. Related documents require explicit
  ordering, a durable execution journal and recovery checks; this design does not
  assume multi-document transactions are available.
- Preallocate operation and new document IDs. Insert each new registration together
  with its creation provenance. On retry, verify the exact existing operation/result;
  refuse a path/name/ID collision instead of duplicating or adopting another record.
- Export/verify the resulting documents and record success per operation. A prepared
  bundle is not evidence that a correction actually ran. An interrupted execution
  is reconciled from the atomic record/history state before resuming.

## Reversing a correction

Reverse only the fields changed by that operation, and only while their current
values and history still match its recorded result. Retain both the correction
and reversal events. Stop for review if subsequent edits or archive state changes
would make reversal unsafe; do not restore a whole stale document over newer work.
For a new registration, do not promise automatic deletion on rollback after it has
acquired dependents or entered archival. Hold and review its disposition while
preserving its creation/audit record.

## Required proof before production execution

Scratch tests should prove original values and types survive, correction and history
are atomic, retries do not duplicate operations, changed records are refused, a
crash can be recovered, ordinary clients cannot edit history, and conditional
reversal cannot clobber later work. Also verify that registration sends no email,
moves no bytes and preserves existing record relationships and historical checksums.

No missing original checksum is filled and no historical mismatch is cleared.
The normal archive manifest supplies dated current integrity measurements; it
does not rewrite the past. Production execution remains a separate checkpoint.

See [ownership decisions](OWNERSHIP_AND_NEXT_STEPS.md), [policy](policy.json),
[exact location proposals](location-proposals.json) and [live preview](LIVE_PREVIEW.md).
