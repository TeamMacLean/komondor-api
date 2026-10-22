# Project 2178 consolidation — 22 October 2026

**Applied to production and independently verified.** The final known database
association hold is resolved. API, Web, Power and Nudge are online. The full
AWS-backed read-only archive plan also passed at **23:04 BST on 22 October**,
with 39 files, zero missing or untracked files and zero serious anomalies.
This is database reconciliation and archive preparation, not an S3 transfer or
permission to delete either dataset.

George approved the proposed consolidation of both datasets under their existing
Project, retaining the owner and original values. That approval covers the single
intact directory move below, superseding the earlier database-only restriction
for this operation. No other candidate directory was moved.

## Exact result

- Project `5fc012bda3efcb29338b7cf7`, **Study of pmk1AS mutant in presence and absence
  of an inhibitor**, keeps its identity, owner and secondary owner `talbotn`.
- `/mnt/reads/ntalbot/project_2178` was renamed, on the same filesystem, to
  `/mnt/reads/ntalbot/study_of_pmk1as_mutant_in_presence_and_absence_of_an_inhibitor/legacy_project_2178`.
  This moved all **31 files / 18,228,463,024 bytes** intact beneath the existing
  Project. There was no copy/remove fallback. Filesystem ownership is unchanged.
- The named tree's existing **eight files / 23,621,445,468 bytes** remain in place.
  The combined Project contains **39 catalogued files / 41,849,908,492 bytes**.
- **69 atomic database operations:** 31 new Files, 31 new AdditionalFiles and seven
  corrections (one Project audit/history update, two Samples, two Runs, two batch
  ledger rows). Existing IDs and scientific metadata are retained. The Project
  still has three Samples, three Runs and no scientific Read records. Catalogue
  classification remains provisional; no pairing or Read metadata was invented.
- **Eight dated current checksum observations** were attached only where the saved
  file identity still matched. No payload checksum sweep ran and no historical
  upload checksum was invented or overwritten.
- `ntalbot-031` is now `consolidated-under-existing-project`, covered by
  `ntalbot-026`. The ledger retains its previous root, inventory and original hold,
  alongside `holdResolved` and appended before-image history. Archive the existing
  Project once, including the child directory; do not archive these two source
  decision entries as separate Projects.

The original two Sample paths and two Run paths survive in `reconciliationHistory`
and full BSON before-images. New records retain creation history and previous
physical paths. Both decision entries remain in the [current 197-entry outcomes](../reconciliation-production-2026-10-22/OUTCOMES.md).

## Evidence and validation

Plan SHA-256: `f6cd487d3bcdac65d6ff1eaa98d87376d91b2acd8c5e99bce0d2e712eb3cf19b`.
Executed tool identity: `54aacfc2168e39fa070e943f2ce2aae8da960a778f31a6f672fa9fbdbe7bac85`.
API release remains `27b98035dccf1b33e2f449be972e2003b4114b24`; Web remains
`e9e183cc6968da46a4b0eada76471b750745a771`. No application release changed here.

- [Nine operation/recovery tests](operation-tests.log) exercise the real MongoDB
  and filesystem path: successful application, idempotent repeat, crashes after
  rename and partial writes, later edits, destination collision, changed source,
  unrelated database changes, missing freeze/backup, and altered moved files.
- [Nine service-controller fault scenarios](window-tests.log) passed locally and
  on v1333, including timeout and partial-consolidation recovery. A partially
  applied state prevents service recovery until the sealed operation is resumed.
- All **56,395 documents from 17 collections**, with original indexes, were
  independently backed up and restored. The exact 69 planned results passed
  [scratch replay](restore-replay.json), including populated File references,
  unchanged unrelated documents/indexes and zero serious archive-overlay anomalies.
- The server [verified all 69 results](applied-verified.json). Their returned BSON
  was [independently decoded and compared on the Mac](independent-verification.json)
  before services restarted. Every moved descendant retained its inode, size,
  timestamps, permissions and ownership; the original named-tree descendants
  were also unchanged. This metadata comparison is not a new content-hash proof.
- [Post-restart checks](live-check.json): 15 HTTP/API requests, all 39 visible file
  locations, all prior histories retained, zero untracked files and zero serious
  structural archive anomalies. All original indexes and all unplanned database
  documents passed comparison again.

Services paused at **21:37:00.938 UTC** and [returned](restored.json) at
**21:39:36.255 UTC**: approximately **2 minutes 35 seconds**. The controller checked
that the consolidation was complete and safe before restoring services.

The database now contains **56,457 retained documents**, including 361 Projects
(359 active), 22,235 Files, 13,851 AdditionalFiles and 8,387 unchanged Reads.
Across the reconciliation and this follow-up there are 13,083 new File/AdditionalFile
pairs and 6,771 retained dated observations. The earlier execution receipts retain
their original counts; they are not rewritten as if this follow-up happened then.

## Launcher failure and recovery

The first launch stopped before any file or database mutation: the one-off CLI's
argument-name validator rejected the digits in `--plan-sha256`. The original
[runner](runner.cjs) is retained as evidence of that attempted invocation.
The [module adapter](apply-module.cjs) then called the already-tested exported
operation with the same sealed plan, implementation, independent backup and
quiescence receipt. All guards remained in force. That application succeeded.
The server's sealed operation source is retained unchanged for recovery evidence.
Commit `c369bee` retains that exact executed implementation. The subsequent
repository-only parser correction accepts the explicit `--plan-sha256` option and
rejects missing, repeated or command-inappropriate options before connecting to
MongoDB. [Eight CLI regression cases](cli-tests.log), [all nine operation/recovery
cases](operation-tests-after-cli-fix.log), and [all nine controller cases](window-tests-after-cli-fix.log)
passed after the correction. This changes the repository tool identity; do not
substitute it for the original sealed server tool when verifying the executed plan.
Do not rerun the one-off launchers as a routine follow-up.

The first full AWS-backed archive plan [stopped at expired SSO authentication](archive-plan.stderr),
before its AWS preflight could complete. Its [attempt receipt](archive-plan-attempt.json)
is retained separately. After George renewed the existing SSO login, the [full live
archive plan passed](archive-plan-final.json) with exit code 0 at
`2026-10-22T22:04:53.149Z` (23:04 BST), using the fenced KomondorArchiveMover role
in account `958120753368` and bucket `tsl-hpc-reads`.

The plan found all 39 files / 41,849,908,492 bytes, with no missing expected files,
no uncatalogued files, and no serious anomalies. It retained **26 non-blocking
stored-location notes**: the files remain at their actual `raw/` or `processed/`
paths rather than the generic AdditionalFile-derived `additional/` location.
It also recorded five empty directories that the archive will skip. These notes
are expected consequences of preserving the real layout and provisional catalogue
classification; they are not missing data. The proposed destination is
`s3://tsl-hpc-reads/ntalbot/study_of_pmk1as_mutant_in_presence_and_absence_of_an_inhibitor`.

This read-only plan did not hash payloads, lock the Project or write to MongoDB/S3.
Its zero checksum-anomaly count is not a new content-checksum proof. Normal sealed
checksums and transfer verification remain part of archive execution. Repeat the
live plan immediately before any later lock, since the Project remains writable.
The API checkout remained clean at the release above and its readiness endpoint
passed after this check. The AWS login issue is resolved.

## Remaining work

There is no remaining known database reconciliation hold in this batch. Historical
checksum gaps and provisional scientific classification remain explicit. Eligible
Projects still need normal fresh archive planning, locking, transfer and verification;
manual HPC disposal remains a separate checkpoint. No S3 object or HPC file was
deleted or uploaded by this operation, and no owners were contacted.

Private evidence is retained at `/storage/komondor-project2178-20261022/` on v1333
and `/Users/deeks/.codex/artifacts/project-2178-consolidation-20261022/` on the Mac.
Full BSON documents and sealed plans stay outside Git; this folder retains compact
receipts, reviewed scripts and tests. Nothing was merged or pushed.
