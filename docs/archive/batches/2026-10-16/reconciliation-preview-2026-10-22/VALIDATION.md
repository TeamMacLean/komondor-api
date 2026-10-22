# Preview validation — 22 October 2026

## Step 1 implementation (latest)

The local implementation registers the 23 approved missing Projects: 18 with
custodian `shrestha`, five with custodian `winj`. The five existing Saunders
`winj`/`kamouns` records are untouched. Exact input, command and operation-window
requirements are in [the registration runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md).

- The new integration suite passes **24 tests** against a disposable local MongoDB.
  It exercises the real prepare/apply/inspect CLI, absent-before/complete-after
  history, BSON native-type retention, unchanged filesystem contents/ownership,
  no extra collections or NewsItems, crash recovery and duplicate-free resume.
- Refusal tests cover changed plans/backup/database/tool/targets, expired windows,
  active API/ingest work, changed filesystem metadata, conflicting claims,
  missing indexes/users/groups and later edits. Normal save/query/bulk/replacement/
  delete operations cannot overwrite the provenance or pinned identities.
- The full integration suite passes **82 tests across 11 suites**. It printed
  Jest's delayed-exit warning, then exited successfully without forced termination.
- The final full unit/contract run with coverage and open-handle diagnostics passes
  **2,094 tests across 74 suites**, including the coverage thresholds. An earlier
  rerun timed out in the unchanged news-route test; its 13-test suite passed in
  isolation and the full diagnostic rerun passed. The initial development runs
  also caught a missing OpenAPI declaration and a bulk-write rejection-wrapper
  issue, both fixed and covered before the successful final runs. A separate
  earlier run hit the repository's documented intermittent HTTP parse failure.
- `git diff --check`, syntax checks and the generated-evidence digest checks pass.
  Exact commands, counts and local test-log digests are retained in
  [implementation-validation.json](implementation-validation.json).
- The target fixture checks all 23 owner/root decisions and the source decision
  digest. No extra payload checksum sweep was run.

All execution tests used an isolated localhost MongoDB and temporary payload
fixtures. **No production database or filesystem write, notification, S3 operation
or deletion occurred.** Application code is now changed locally; earlier statements
below about unchanged application code describe their historical preview stages.
This does not establish production execution readiness: independent review,
deployment of the matching API, a fresh prepared plan, retained backup and the
approved writer window remain necessary.

## Completed live inspection and initial current-checksum pass

See [LIVE_PREVIEW.md](LIVE_PREVIEW.md) for current findings and
[live-provenance.json](live-provenance.json) for derived-output hashes and counts.

- SSH completed successfully for the inventory and both hashing runs, with exact
  collector sources and output hashes retained. Production Git identity/status
  were clean and unchanged in the recorded before/after checks.
- Validated 197 unique entries and agreement of every old file-count/byte-total pair.
- Validated 15,397 archive-scope files and 13,448,802,534,476 bytes against the live output.
- Validated all 110 old Read/File/Run identities and stored paths against the live
  records: 107 existing stored locations and three proposed corrections. All three
  correction candidates have newly measured current physical-byte hashes.
- Validated all 35 earlier derived-path collisions map to distinct stored physical paths.
- Reconciled all 6,771 current observations to their exact requested file identities,
  successful SSH receipts and collector hashes. No failures; 6,961,044,378 bytes.
- Reconciled the 8,626 remaining paths (13,441,841,490,098 bytes): no overlap with
  completed observations and no unaccounted archive-scope path.
- Current-checksum helper passed five local fixture scenarios: compressed physical
  bytes, stale inventory refusal, symlink refusal, traversal refusal and empty files.
- Node syntax checks for the four live helper scripts and `git diff --check` passed.

Application code and production data remain unchanged. No application test-suite
rerun was needed for this read-only evidence collection. The separate bulk checksum sweep is cancelled by George.
Content classification and implementation remain incomplete; the checks above do
not establish full archive readiness or a frozen source tree.

## Ownership and checksum-policy follow-up

- Read-only lookup returned 117 relevant Project records and selected User fields;
  `shrestha` and `winj` resolve to existing users. All five existing Saunders
  records retain `winj` / `kamouns`.
- Read 17 allowlisted notes (1,541,126 bytes) from ten Talbot directories. Document
  author names are clues, not project ownership. Raw extracted text and source
  hashes/command receipts are retained; no production filesystem writes occurred.
- Latest instruction: five new Saunders registrations use `winj`; the 17 Talbot
  directories and Courville use `shrestha`. The five existing Saunders owner pairs
  remain `winj` / `kamouns`. Original scientific ownership is not inferred from custody.
- Remaining checksum paths are coverage only. No extra audit sweep is required;
  normal manifest/upload verification remains mandatory.

Follow-up validation passed: 197 unique entries; exactly 17 Talbot + 5 Saunders +
1 Courville custodian proposals; every existing owner/secondary owner preserved;
all five existing Saunders owner pairs retained; unchanged checksum coverage;
new command output/collector hashes verified. Derived provenance refreshed.

## Earlier offline phase (historical)

This validates local derived reports, not live HPC contents or execution readiness.

- Offline generation completed with its scope/coverage assertions.
- Independently compared all 192 original entry IDs to the source register; each
  appears exactly once, plus five separately identified supplementary entries.
- Independently checked preservation of every original database owner and secondary
  owner, all 11 KEEP decisions and all six explicit direct-disposal decisions.
- Confirmed all five additional Saunders entries now propose preservation/archival.
- Parsed all 11,626 file-preview rows, of which 10,935 are in archive scope. Out-of-scope
  rows propose no reconciliation change. All known existing-reference rows propose
  linking existing records rather than duplicating them.
- Independently compared stored/proposed locations: 107 unchanged, three corrections,
  110 total. No file move is proposed.
- Verified all eight input SHA-256 values and four generated JSON/JSONL output
  SHA-256 values against provenance.json.
- Confirmed every checksum result remains null, every entry remains proposal-only,
  owner enquiries are disabled, original checksum fields are not to be filled, and
  permanent database-record deletion is disabled.
- Node syntax validation and `git diff --check` passed.

No application code changed, and the application/integration suites were not rerun.
No fresh data checksum was calculated and no production write was performed.

The read-only SSH access probe reached v1333 but exited 255 with authentication
failure (`Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password)`).
The requested replacement control socket is
`~/.ssh/v1333-codex-reconcile.sock`; fresh collection awaits authentication.

## Explicit Saunders owner selection and original-value retention design

George selected winj for all ten Saunders entries. Re-generated and checked all
197 entry rows: five new winj registrations, 18 new shrestha registrations, five
existing Saunders winj/kamouns owner pairs unchanged, and every other existing
owner/secondary owner retained. All disposition totals are unchanged. Filesystem
ownership changes and a separate bulk audit remain disabled.

The earlier owner proposal is retained with its digest under decision-history.
Original-value retention is now specified in ORIGINAL_VALUES_AND_CORRECTIONS.md;
this is a design, not implemented migration behaviour. Generator syntax, scoped
consistency assertions and git diff --check passed. No application code changed
and no production write was made for this update.
