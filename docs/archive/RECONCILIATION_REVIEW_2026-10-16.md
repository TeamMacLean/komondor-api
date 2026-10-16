# Archive reconciliation review — 16 October 2026

**The reconciliation and requested checks are complete. The full-suite gate is
not unconditionally green. No merge, push or production deployment was made.**
Three full Jest runs completed: two passed, one had a bare HTTP parser error
in an unrelated route test. A separate attempt terminated in Node/V8 before
completion. Both failures are retained below rather than hidden by retries.

## Git scope

- Review branch: `codex/archive-reconciliation`, based on local master
  `f1a477e07cf1f5f5bec6d174cd98f8c6b7eb4960`.
- Fetched `origin/master`: `bc4fad89861e7eeed0aaeed7286978347adce1dd`.
  Local master already contained 12 unpushed deployment/documentation commits,
  including the source register, File-model fix and populated-file test.
- Imported line: `origin/s3-archival` at
  `cd4b6cc35b9864f611bed4168c6c203b9b300023`.
- Only the requested verifier, its two test files, candidate Markdown/CSV and
  `docs/hpc-verification-2026-10-16/` were imported from that branch. No merge or
  cherry-pick brought in other archive code or `S3_*` documents.
- Master’s `lib/s3-archive/` files are unchanged. Runbook/deployment changes
  were made on top of master. The earlier batch register is inherited from
  master and updated here, not left in an uncommitted attachment directory.

## Code findings and fixes

1. The verifier uses master’s `validateProjectRoot`, `collectProjectDatabase`
   and `overlayDatabase` exports, plus `collectHardBlockers`. Its real-Mongo
   integration test resolves both Read.file and AdditionalFile.file through
   those helpers. The inspected production preflight/inventory hashes exactly
   matched this branch’s master-derived modules.
2. Local master already required File in the mover (`c6b9d77`) and disabled
   automatic collection/index creation at connection time (`5b8bda4`). Both
   standalone scripts now explicitly disable autoIndex/autoCreate before
   model loading as well. Model-registration tests pass for both scripts.
   Integration compares database documents, collections and indexes before
   and after populated-file planning and shortlist verification.
3. The receipt collision was reproduced with a fixed `Date.now()` and the
   original exclusive timestamp filename: the second upload failed EEXIST.
   Upload and restore receipt names now include a UUID, retaining exclusive
   creation. The regression verifies two uploads and two restore verifications
   in the same millisecond preserve all four receipts without reuploading data.
4. The imported verifier could report OK despite serious anomalies, omit
   active-work blockers and truncate missing/untracked path details at 20.
   Those reports now expose blockers/anomalies and retain full detail. It
   remains a metadata inspection, not checksum verification or an archive gate.
5. The verifier rejects ambiguous argument combinations, malformed row shapes,
   blank source paths and duplicate matching database paths. Group inspection
   refuses symlinked group roots. Optional JSON output must be a new file
   outside the datastore; tests verify existing reports/source bytes survive.

## Independent production review

The reviewed verifier was executed in memory over SSH as `deeks`, against the
production master modules, from 20:30:26 to 20:31:11 UTC. It read metadata for
281 registered projects across the four groups and inventoried the unregistered
directories. Production Git state remained clean at `c6b9d77`. No Mongo changes,
HPC writes, S3 requests, service changes or owner notifications were performed.

See the [findings](../HPC_ARCHIVE_CANDIDATES_2026-10-16.md),
[decision table](batches/2026-10-16/README.md) and
[provenance with evidence hashes](../hpc-verification-2026-10-16/independent-review/provenance.json).
Key corrections to the imported claims:

- All 192 supplied entries remain in scope. The 156 unaudited entries have
  awaiting-decision status. Ten years is tentative, not an applied filter.
- Kamoun retains 19 archive requests, six direct-disposal requests and 11 KEEP
  decisions. Both operator KEEP clarifications are unchanged.
- Seventeen of the 19 archive requests have serious preflight anomalies.
  Missing destination MD5 records cannot be converted into READY labels.
- Eight projects have missing expected paths, including six Jones projects.
  All 29 missing paths in the two highlighted projects have same-basename
  candidates elsewhere; one has two candidates. No byte-equivalence claim is
  made because this review did not hash payload contents.
- The 18 Talbot numbered directories, Courville, the Jones case mismatch and
  ten mixed-case Saunders directories were independently observed. The latter
  total **801,506,677,663 bytes**, not the imported estimate of about 30 GB.
  Five additional Saunders directories remain outside the original list.
- Production observations override earlier technical assumptions and size
  estimates. They do not create owner approval or change KEEP decisions.

The original four source files and imported production JSON are preserved
byte-for-byte. Every original row, path, owner field and decision is accounted
for exactly once in the register. Its CSV and readable table agree. Contacts
are recorded where available, with no guessed addresses or assumed current
responsibility. Separate owner questions and technical follow-up are included.

## Validation

Runtime: Node `v24.11.1`. Integration used a dedicated local MongoDB 7.0.2
process, loopback port 55458, database `komondor_archive_reconciliation_test`,
with a new scratch dbpath. It did not use production or the normal local DB.

| Check | Result |
| --- | --- |
| Full run 1, `npm test -- --runInBand` | PASS: 71 suites, 2,058 tests; smoke and both model-registration cases pass |
| Additional interrupted attempt | SIGSEGV before completion; Node/V8 garbage-collector crash; not counted as a completed run |
| Full run 2, `npm test -- --runInBand` | 70 suites pass, one fails; 2,057 tests pass, one fails; smoke and both model-registration cases pass |
| Full run 3, `npm test -- --runInBand` | PASS: 71 suites, 2,058 tests; smoke and both model-registration cases pass |
| `npm run test:archive` | PASS: nine suites, 165 tests |
| `npm run test:integration` | PASS: nine suites, 55 tests, including populated Read/AdditionalFile and read-only verifier checks |
| `git diff --check` | PASS |
| Register/source reconciliation | PASS: 192 rows, source hashes, unchanged decisions/KEEP overrides, evidence links and original report bytes |

Full run 2 failed in `__tests__/routes/runs.test.js`, under the reingest
replacement-payload test “refuses a resubmission that actually changes the
delivered file's content”, with **`Parse Error: Expected HTTP/, RTSP/ or ICE/`**.
There was no failed application assertion. The repository already documents
intermittent HTTP transport failures in `__tests__/setup/httpAgent.js`, but this
exact message is not in CI’s retry allowlist and its root cause is not resolved
by this review. No tests, assertions or CI failure rules were weakened.

The extra interrupted attempt’s macOS crash report places the fault in
`v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers` during
garbage collection. Three existing reports from 15 October show the same top
frame, predating this reconciliation. That is supporting evidence of an
existing runtime issue, not proof that the current failure can be ignored.

All three **completed** full runs passed the smoke suite and model-registration
tests for both scripts. This does not make the overall three-run gate green.
Archive-specific and scratch-Mongo checks pass; the full-suite instability
remains explicit for the reviewer before any merge/push decision.

Logs and machine-readable run results are retained on the operator Mac at:
`/Users/deeks/.codex/artifacts/archive-reconciliation-20261016/`.
The committed [validation evidence](evidence/reconciliation-20261016/README.md)
includes all completed/full-attempt summaries and compressed logs.
