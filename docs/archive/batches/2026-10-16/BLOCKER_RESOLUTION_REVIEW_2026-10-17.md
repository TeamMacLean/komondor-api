# Blocker-resolution review — 17 October 2026

Review base: `0d497f5`. Revised implementation/evidence commit: `bfc8d83cfa52027249b01d1605606fd409971f40` on
`archive-batch-plan`. The commit containing this report adds the review/validation
record only; nothing is merged to master. Claude should independently review this
branch against the accepted blockers and the evidence linked below.

**Revised verdict: GREEN for the revised action plan and diagnostic correction.**
This is not permission to perform the proposed production writes. Any explicitly
held project remains excluded from execution pending its separately recorded decision.
Fresh live plans, writer freezes, archive verification and separate manual deletion
checkpoints are still required. No production writes or owner contact occurred.

## Requested items and commits

| Item | Commit(s) | Result |
|---|---|---|
| 1. Diagnostic kind | `47f6957` | `db-file-missing` and `recordKind` both retained; Read/AdditionalFile regression tests; 110 derived anomaly labels corrected without altering raw observations |
| 2. Per-project path resolution | `bfc8d83` | All 110 records reviewed; complete hashes and preserved-tree decisions; no File.path edits or raw/ moves |
| 3. Dependent records | `aca906d`, `e98b9d2`, snapshot limitation clarified in `b1006b9` | Eight projects including Xiao; 48 documents exported; exact collection ID filters/order; fresh frozen export required before George executes |
| 4. Kamoun targets | `cdc4df2` | Five sheet Saunders targets, Xiao, five pending supplementary targets; corrected exact totals and fresh canonical-inventory checkpoint |
| 5. Placeholders | `93a0160` | 17 Talbot payloads, exact generated-path checks and separate manual Courville procedure; missing group-administrator addresses explicitly assigned to George |
| 6. Housekeeping/pilots | `e33c3a3`, `e0b5e03` | LF CSV, cross-linked historical/current labels, three named pilots first; fresh plan required before each lock |
| 7. Batch locking | `8095765` | Requires all writers drained/stopped, Power paused and external writers frozen; permits later sequential locks with per-lock outcome records; no lock executed |

## Content evidence and limitations

Eight projects, 110 missing expected paths. Category a: **83**; documented
absence (b): **0**; compared ambiguity resolved (c): **27**;
unresolved c holds: **0**. The evidence covers 112 distinct physical
candidate files / 297,407,594,792 bytes. 77 records have a valid original
MD5; 51 have at least one physical candidate matching it and 26
have a validated gzip payload matching it. For the latter, compressed-byte hashes
remain different and are explicitly retained, not re-labelled as original matches. 33 have no
valid original MD5, so this audit does not claim historical checksum equality for them.

The initial same-name/stored-path search overlooked three `.fastq` files whose database
names ended in `.fastq.txt`. Their exact alternatives were separately hashed, with no
original MD5 available. The derived record explicitly supersedes the initial search
result and retains both raw outputs. Do not turn a failed name lookup into a loss claim.
All physical copies remain in place, including the duplicated LIB14323 candidate.

[PATH_RESOLUTIONS.md](PATH_RESOLUTIONS.md) explains every project's disposition and
lists record IDs; [path-resolutions.json](path-resolutions.json) contains every candidate
path, size, MD5 and SHA-256. Raw commands, outputs, source hashes and progress logs live
under [evidence/2026-10-17](evidence/2026-10-17/README.md). No archive manifest was created
by this review. The procedure requires later verification of missing-record anomalies
and physical file SHA-256 values in the actual sealed manifest, with its digest linked
to this audit record. External resolution prose is not automatically embedded by the CLI.

The original primary SSH job ended with exit 255 and returned no JSON. Its progress
log was not accepted as checksum evidence. A second disconnect left four complete project reports saved. The resumable
checker retained those reports and saved remaining comparisons individually; matching
whole-tree fingerprints and complete record coverage underpin the aggregate. Checkpoint outputs were saved only on the Mac.

The gzip diagnostic initially closed its descriptor before its final stability
check and failed without accepting any result. The corrected helper is covered by
four tests, including damaged gzip trailer and symlink refusal. The successful run
verified all 26 complete decoded payloads against their original MD5 values and
bound them to the same physical SHA-256 values as the primary run. This supports
preserving the gzip files unchanged; it does not certify historical gzip-byte identity.

## Other evidence

- [Exact dependent documents/filters](dependent-records.json) and
  [manual cleanup procedure](DEPENDENT_RECORD_CLEANUP.md). Full BSON snapshots are
  retained, including all nine Xiao File records. The refreshed reference checks
  include legacy string IDs and found no shared-reference/active-work blockers.
- [Kamoun target ledger](KAMOUN_DELETE_TARGETS.md): five Saunders sheet targets
  **628,557,119,322 bytes**, Xiao **161,447,455,740**, six sheet deletes together
  **790,004,575,062**. Five pending targets **172,949,558,341**; all ten Saunders
  **801,506,677,663**. Pending targets are not approved direct deletions.
- [Placeholder procedure](PLACEHOLDER_REGISTRATION.md) and
  [18 exact request bodies](placeholder-projects.json). POST may send an overseer
  notification; it has not been executed. Test notifications remain deeks@nbi.ac.uk.
- [Current action plan](ACTION_PLAN.md) and [192-row decision table](action-plan.csv).
  Original source file hashes and all entry IDs remain unchanged; 11 KEEP decisions
  and six sheet direct-delete decisions are preserved. No age cutoff was introduced.

## Validation

Node v24.11.1. Three full runs after adding the gzip diagnostic tests returned:
**2,084 passed; 2,083 passed / 1 failed; 2,084 passed**, across 73 suites each.
The failure was an HTTP parser error in `__tests__/routes/uploads.test.js`, outside
this change. Its isolated rerun passed all 39 tests, as did the subsequent full run.
This resembles the repository's documented intermittent HTTP transport failure;
its root cause was not established or fixed by this review. Retain this caveat rather
than claiming three entirely clean full runs.
Both standalone scripts passed the model-registration/autoIndex/autoCreate test;
smoke tests passed in all three runs. Archive suite: **9 suites / 167 tests**.
Integration-only suite against a local disposable database: **10 suites / 58 tests**,
including three real-database evidence tests. The 20 evidence unit tests and four gzip diagnostic tests are included
in the full suite. Eight additional Python tests validate resumable evidence aggregation.
`git diff --check` passed, and the action CSV contains LF only.
[Validation summary and log hashes](evidence/2026-10-17/validation-results.json);
[Git-readable result/failure excerpts](evidence/2026-10-17/VALIDATION_EXCERPTS.md).

The integration suite emitted an open-handle warning and then exited successfully.
An earlier targeted evidence test encountered leftover unique indexes in the scratch
DB while constructing deliberate legacy duplicates; explicit scratch reset fixed the
fixture isolation, and the targeted/full integration reruns passed. This was not a
production database error. The scratch MongoDB was stopped after testing.

## Execution prerequisites retained

Deploy the separately reviewed corrected release before real locks; production was
left at its existing clean commit. George supplies the two missing group-administrator
addresses and later executes the reviewed manual steps. The plan permits archive on
silence for the settled exports/discrepancy deadline but never deletion on silence.
No unresolved identity, missing original checksum or historical anomaly is silently
converted into a claim that the original dataset is complete.
