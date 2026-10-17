# Path review complete — 17 October 2026

The earlier authentication/incomplete-evidence checkpoint is superseded. All eight
projects and **110 records** have completed read-only comparisons. The aggregate
passed complete-record, source-code, Git-identity, duplicate-candidate and whole-tree
consistency checks. No production writes or owner contact occurred.

Use [PATH_RESOLUTIONS.md](PATH_RESOLUTIONS.md), [the full per-record evidence](path-resolutions.json)
and [ACTION_PLAN.md](ACTION_PLAN.md). The eight former `FIX_PATHS_THEN_ARCHIVE` /
`HOLD_PATH_REVIEW` rows are now `ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES`.

- 83 records have one located candidate within the same run.
- 27 comparisons resolve duplicate or gzip-content ambiguity.
- No records remain classified as absent or unresolved content holds.
- 51 records match the original MD5 on physical bytes; 26 match it on the validated
  decoded gzip payload. The other **33 have no valid original MD5**, so historical
  checksum equality is not claimed for them.
- 112 distinct candidate files / **297,407,594,792 bytes** were hashed.
- Proposed file moves and database repairs for these eight projects: **none**.

The first SSH attempt returned no usable JSON. The second saved four project reports
before disconnecting. The resumed run retained those 59 records and saved the final
51 individually; it did not repeat the completed projects. Every accepted command,
output hash, source hash and observation timestamp is retained in
[the evidence folder](evidence/2026-10-17/README.md). Failed attempts remain marked
as failures, and their progress is not treated as checksum proof.

The aggregate is [paths-complete-20261017T125243Z.json](evidence/2026-10-17/paths-complete-20261017T125243Z.json),
with [its command/evidence receipt](evidence/2026-10-17/paths-complete-20261017T125243Z.command.json).
The local summary and action-table derivations have now run. Do not rerun the one-time
`finalize-path-actions.py` against the finalized plan; it expects the earlier checkpoint.

This completes the evidence review, not production execution. Deploy the reviewed
corrected release before locks; take fresh live plans and writer freezes. Preserve
historical anomalies in the manifest and bind its digest to this review evidence.
Separate manual deletion checkpoints remain mandatory.

Validation is retained in [validation-results.json](evidence/2026-10-17/validation-results.json)
and [the Git-readable excerpts](evidence/2026-10-17/VALIDATION_EXCERPTS.md).
The three full runs passed 2,084; passed 2,083 with one HTTP parser failure; then
passed 2,084. Model-registration and smoke suites passed in all three. The isolated
upload rerun passed 39, archive passed 167, scratch integration passed 58, and eight
local Python aggregation tests passed. The HTTP failure's root cause was not
established; do not report three entirely clean full runs.
