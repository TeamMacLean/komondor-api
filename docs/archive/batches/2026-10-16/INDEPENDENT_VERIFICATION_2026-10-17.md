# Independent verification — 17 October 2026

Reviewed commit: `c0b8f6603c5b1d3ffffdc0f221a5b9497ef51cd8` on `archive-batch-plan`,
pinned. Base: `0d497f5`, the revision whose BLOCK verdict was accepted.

**Verdict: GREEN.** No merge-blocking defects. This authorises the merge only. It
does not authorise production writes, archival execution, owner contact or HPC
deletion, and it does not revisit the settled policy.

This record is a second, independent pass over the same branch as
[BLOCKER_RESOLUTION_REVIEW_2026-10-17.md](BLOCKER_RESOLUTION_REVIEW_2026-10-17.md).
Nothing in that report or in any generated summary was taken as proof; every
figure below was recomputed from the raw evidence, and the corrected diagnostics
were regenerated from the unchanged observations in a disposable checkout. No
file in the reviewed commit was modified, and nothing was merged or pushed.

## The seven requested items

| Item                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Diagnostic correction   | Verified. The defect was `...item` spreading `item.kind` over `kind: "db-file-missing"`. Both labels now survive, both record kinds are covered, and reverting the fix fails exactly the two new tests and nothing else. All 110 corrected anomalies carry `kind: "db-file-missing"` plus `recordKind`; `dbRecordsMissingOnDisk` keeps its original `kind`. The four corrected reports regenerate **byte-identically** from the unchanged observations.   |
| 2. Path resolution         | Verified. 110 records across 8 projects; 112 distinct candidate files; 297,407,594,792 bytes — all exact. Categories a=83, c=27, b=0, unresolved=0. `proposedFileMoves` and `proposedDatabaseWrites` empty on all 110; `productionWrites` false. The three `.fastq.txt` records retain the superseded category-b conclusion verbatim with its scope caveat; no failed lookup became a loss claim.                                                         |
| 3. Dependent records       | Verified. 48 documents exactly. Closure complete: every `ref:` in `models/` reachable from a Project maps to one of the eight exported collections. Deletion order is children-first and identical across all eight projects. All seven blocker categories empty. Xiao has exactly nine File records. Legacy string references are counted for closure and flagged when foreign.                                                                          |
| 4. Kamoun ledger           | Verified. Every total recomputes from per-item sums: 628,557,119,322; +Xiao 161,447,455,740 = 790,004,575,062; five pending 172,949,558,341; all ten 801,506,677,663; combined 962,954,133,403. Status `proposal_not_executed`; the five pending targets carry archive-on-silence, never delete-on-silence.                                                                                                                                               |
| 5. Placeholders            | Verified. 18 bodies = 17 Talbot plus one manual-rename case, so both counts in the prior report are consistent. Route matches. `owner` is taken from the session and never from the body, so no owner can be invented structurally rather than by promise. All 18 set `nudgeable: false` and `doNotSendToEna: true`, suppressing the nudge the route would otherwise inherit from the group. Collisions resolve case-insensitively with a numeric suffix. |
| 6. Housekeeping and pilots | Verified. 192 rows, LF only, all 192 `entry_id` values unique. KEEP 11, direct-delete 6, Kamoun archive 18+1 = 19. The three named pilots are the first three wave-1 rows in file order, smallest first. A fresh live plan is required before each lock.                                                                                                                                                                                                  |
| 7. Batch locking           | Verified. Drains ingest/MD5 and names the AdditionalFile moves embedded in create requests, reingest and queued jobs. Stops every API instance and worker on every host, pauses Power, freezes external writers, and requires connection refusal rather than a draining 503. Sequential locks record per-project outcomes with identity read-back, stop on failure or unknown result, and never auto-unlock or reset state.                               |

## Evidence chain

All three source hashes claimed by `path-resolutions.json` were recomputed and
match. Across 59 observation result files there is one Git identity
(`c6b9d77d`, clean status), no before/after drift, one `moduleSha256` per module,
and a single host and operator.

The interrupted primary job is cited nowhere as a source, and its progress log is
labelled as not being checksum evidence. The directory corroborates the failure
narrative independently: the failed gzip run has a stdout capture but no result
JSON, and exactly four retry result files exist, matching the four complete
project reports claimed.

All 26 gzip diagnostics bind to a candidate's `physical.sha256`, carry the
record's own original MD5, and report both a validated trailer and a decoded
payload match. The decoded MD5 equals the original while the physical MD5
differs, so compressed-byte hashes are retained rather than relabelled.
51 + 26 = 77 records with a valid original MD5, with no overlap, and 33 without,
totalling 110.

The CLI seals `anomalies`, `dbExpectedMissing`, per-entry SHA-256 values, the
summary and the HPC snapshot. External resolution prose is not sealed, and the
prior report does not claim otherwise.

## Findings, by severity

None blocks the merge.

1. **Observations were produced by the pre-fix module.** The evidence records
   `lib/s3-archive/preflight.js` as `5a3a80e9…`, which is the blob at `c6b9d77d`
   and `0d497f5`; the reviewed commit has `2af98a9c…`. This is disclosed rather
   than concealed, the corrected labels are an explicitly derived relabelling,
   and they reproduce exactly. The consequence is that the sealed manifest will
   be the first artefact the fixed code produces. Deploy the corrected release
   before any lock and verify the manifest's anomaly labels at that point.
2. **The manifest cannot reference the external audit record.** No
   `auditRecord` or equivalent field exists; `anomalyAcknowledgement` carries
   only `by`, `at` and `manifestSha256`. The documentation does not over-promise,
   but nothing in code maintains the audit-to-manifest linkage. Keep it an
   explicit execution step.
3. **The prior summary names one duplicate; there are three.** Candidates are
   112 distinct by path but 109 by SHA-256. Besides the LIB14323 pair,
   `rice_pacbio_ccs_sample_3.fastq.gz` appears under both `pacbio_2` and
   `pacbio_3`, and `B98.fastq.gz` and `B981.fastq.gz` are byte-identical under
   different names across two separate Read records. All are correctly
   dispositioned in the JSON as preserve-in-place; only the prose implies a
   single case. A one-line correction is enough.
4. **"Wave 1, 33 fully registered projects" against 34 CSV rows.** The 34th is
   the rename-first entry, so the sentence is accurate but easy to misread.
5. **The test gate is less reliable than the repository documents.** See below.

## Tests run

Executed against the pinned commit on this machine, Node v24.11.1, with an
explicitly named disposable MongoDB that was dropped afterwards.

| Command                                                 | Result                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `npm test -- --runInBand` (run 1)                       | 73 suites, 2,084 passed                                     |
| `npm test -- --runInBand` (run 2)                       | 1 failed, 2,083 passed — `__tests__/routes/samples.test.js` |
| `npm test -- --runInBand` (run 3)                       | 1 failed, 2,083 passed — `__tests__/routes/runs.test.js`    |
| `npm test -- --runInBand` (run 4)                       | 73 suites, 2,084 passed                                     |
| `npm run test:archive`                                  | 9 suites, 167 tests passed                                  |
| `npm run test:integration`                              | 10 suites, 58 tests passed, with an open-handle warning     |
| `python3 __tests__/scripts/archive-path-resume.test.py` | 8 tests, OK                                                 |
| `git diff 0d497f5..c0b8f66 --check`                     | exit 0                                                      |

Four full runs were available rather than three because an earlier background
invocation completed after it appeared to have stopped. **Two of four full runs
failed**, each with `Parse Error: Expected HTTP/, RTSP/ or ICE/`, in
`samples.test.js` and `runs.test.js`. The prior report observed the same error in
`uploads.test.js`.

That is three unrelated route suites, none of them touched by this diff, failing
with one error family. An eight-line change in `preflight.js` cannot roam that
way, so this is the repository's open HTTP transport defect, recorded in
`__tests__/setup/httpAgent.js` and `jest.config.js`. The roaming is stronger
evidence of that than any single clean run would be, and it is not a reason to
withhold the merge.

It is, separately, worse than the repository claims. `httpAgent.js` describes
roughly one full run in twelve; the rate observed here was two in four. The
deployment procedure uses test runs as a gate, and at this rate an operator
cannot distinguish a red run from a genuine regression without re-running. Worth
addressing on its own account, not as part of this batch.

## Not independently verified

- The filesystem observations themselves. The reads mount and the execution host
  were not reachable from this review, so internal consistency, provenance
  hashes and reproducibility were checked, but not that the HPC bytes are as
  reported.
- Four of the eight source mutations claimed in the prior validation record. The
  item 1 fix was mutation-tested here; the rest were not repeated.
- The deployed production state, and whether the two missing group-administrator
  addresses exist.

## Read-only checks to run before execution

Described rather than performed, since this review had no production access:

1. On the execution host, as the user that will run the archive commands:
   `git rev-parse HEAD` and `git status --porcelain` on the deployed checkout.
2. `shasum -a 256 lib/s3-archive/preflight.js lib/s3-archive/inventory.js` on
   that deployed tree, compared with the reviewed commit. `preflight.js` must be
   `2af98a9c…`, not the `5a3a80e9…` the observations were taken with.
3. A fresh `plan` for each pilot, confirming the anomaly labels now read
   `db-file-missing` with a separate `recordKind`.
