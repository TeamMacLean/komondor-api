# Dependent-record disposal proposal

**For George to execute after review. No cleanup has run.** This covers two empty
projects, five Saunders shells and the populated Xiao project. The
[Kamoun target ledger](KAMOUN_DELETE_TARGETS.md) governs physical disposal.

## Read-only baseline

Observed on v1333 as deeks, 17 October 2026, 06:41:46 UTC, production commit
`c6b9d77db069fa6dd808367086ff358302565b2f`, clean before and after.
[Raw export](evidence/2026-10-17/relations-20261017T064145Z.json),
[exact command and output hash](evidence/2026-10-17/relations-20261017T064145Z.command.json),
and [collector](evidence/2026-10-17/collect-readonly.cjs) are retained.
[dependent-records.json](dependent-records.json) lists every document and the
**exact deletion filter for every collection, per project**, including empty lists.
It is a proposal, not an executable deletion script.

| Entry | Project ID | Samples | Runs | Reads | AdditionalFiles | Files | IngestJobs | NewsItems |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `jjones-057` | `5fc012bda3efcb29338b7d6a` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ntalbot-052` | `5fc012bda3efcb29338b7d4d` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `skamoun-002` | `5fc012bda3efcb29338b7cf9` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `skamoun-003` | `5fc012bda3efcb29338b7cf5` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `skamoun-005` | `5fc012bda3efcb29338b7d5c` | 1 | 2 | 0 | 0 | 0 | 0 | 0 |
| `skamoun-013` | `5fc012bda3efcb29338b7d7a` | 4 | 4 | 8 | 1 | 9 | 0 | 0 |
| `skamoun-015` | `5fc012bda3efcb29338b7d0d` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `skamoun-016` | `5fc012bda3efcb29338b7cf8` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |

Each row also has one Project. Total: **48 documents**. All current shared-reference,
missing-File, outside-project File-path, cross-parent AdditionalFile, active-ingest
and active-Run blocker lists are empty. This observation expires when data or
writers change; it is not a future execution permit.

The collection closure is: Samples by project; Runs by those Samples; Reads by those
Runs; AdditionalFiles at project, sample **or** run level; Files referenced by those
records plus Files under the exact project path prefix (including orphan File records);
IngestJobs of every status by Run; NewsItems by project/sample/run `typeId`.
Checks also find outside Reads/AdditionalFiles sharing a File and outside Reads
pointing to an included Read as a sibling. Cross-parent AdditionalFiles block cleanup.
This procedure follows the current schemas; re-review if those change.

## Freeze and export before any deletion

1. George confirms the entry, Project ID and registered root. For Saunders, separately
   match the mixed-case data target to its sheet row. For Xiao, retain all nine Files
   with its eight Reads and one AdditionalFile. For empty projects, verify the real
   reads mount and freshly inventory the complete root: a missing mount, symlink,
   new file or unexpected directory is a stop condition.
2. Freeze writers using the [action plan](ACTION_PLAN.md). Drain ingest and MD5;
   stop every API instance, pause Power and freeze external jobs. Keep writers frozen
   through physical disposal and metadata cleanup. Do not trust an earlier empty snapshot.
3. Repeat the read-only collector from this checkout:
   `python3 docs/archive/batches/2026-10-16/evidence/2026-10-17/run-readonly.py relations`.
   It runs in memory over SSH and writes the export on the operator's workstation,
   outside the disposable roots. It does not write production files, documents or S3.
   Save a second copy with the database backup.
4. Compare fresh identity, paths, counts, **all IDs and full document contents** to the
   approved record; inspect all blocker lists. Any change or blocker stops cleanup
   until replacement exact filters and documents are reviewed. Capture the final
   export before the first deletion, not just this baseline.
5. Validate the export hashes and successful BSON decoding. Each raw snapshot contains
   BSON `{documents: [...]}` as base64, preserving ObjectIds and Dates. Readable JSON
   is for review, not lossless restore. With this checkout's BSON package, decode with
   `new (require('bson'))().deserialize(Buffer.from(snapshot.bsonBase64, 'base64'))`.
   Keep the entire raw export, command receipt, approved filters and decision in the
   batch evidence folder before deleting. A dump does not replace this scoped trace.

## Exact filters and deletion order

For each project separately, use its `collections.<collection>.filter` in
[dependent-records.json](dependent-records.json), reconciled with the fresh export.
Every filter is an explicit `_id: {$in: [...]}` list. JSON `{"$oid":"..."}` must
be decoded to a BSON ObjectId; it is **not** a literal MongoDB query object.
Preserve string IDs as strings if present. Skip zero-count collections. Never use
`{}`, a name prefix, group filter or broad parent filter for deletion.

Order: **IngestJobs → Reads → AdditionalFiles → Files → NewsItems → Runs → Samples
→ Projects**. Project comes last, after every dependent deletion count matches.
Do not assume model remove hooks or an ordinary project endpoint perform this cascade.
The proposed operation for each nonempty collection is raw MongoDB
`deleteMany(reviewedExactIdFilter)`. George reviews the materialized filter and expected
count immediately before running it. The collector contains no deletion operation.

Record collection, literal filter, expected count, actual count, operator and UTC time
for every operation. Read back all listed IDs and recheck the parent closure/references.
If a count differs or a connection fails, stop and inspect surviving documents; resume
from the journal after review, never by blindly rerunning or broadening filters.
Without a transaction these are separate destructive steps: keep services frozen until
the recorded outcome is consistent. Export recovery also needs separate review;
restoring metadata does not restore deleted bytes.

## Filesystem and retained audit trace

For the seven empty registered roots, remove only inspected empty directories,
bottom-up with `rmdir`. For Saunders this is separate from its approved mixed-case
data target. For Xiao use the target ledger; do not leave live metadata pointing to
removed bytes and do not mark it `aws`, because it has no archive copy.

Retain source decision, target inventory/hash, full pre-deletion document export,
exact filters, approval, each operation result and final absence checks in this batch's
evidence folder. KEEP decisions are unaffected. Reopen services only after reviewed
record cleanup and filesystem checks are complete. Record partial failure as partial,
never as successful disposal.
