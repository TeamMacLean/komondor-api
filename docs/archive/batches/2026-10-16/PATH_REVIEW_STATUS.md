# Path review checkpoint — authentication required

Items 1 and 3–7 are committed and pushed. **Item 2 is incomplete; the branch remains
BLOCKED for execution.** The eight former FIX_PATHS_THEN_ARCHIVE rows are now explicitly HOLD_PATH_REVIEW.
No file moves or File.path edits are authorized by this review.

The first primary SSH job ended with exit 255 without returning any JSON. Its
progress messages were not accepted as checksum evidence. A fresh connection was
verified and the retry started at 11:56 UTC on 17 October; no old collector remained.
That authenticated socket disappeared at 12:32 UTC and subsequent commands failed
with Permission denied. The cause of the disconnect has not been established.

The retry saved complete, successful reports and command/output hashes for:

| Entry | Completed records | Observation |
|---|---:|---|
| jjones-004 | 4 | All four same-run processed/ candidates match valid original MD5 |
| jjones-005 | 2 | Both same-run processed/ candidates hashed; no valid original MD5 recorded |
| jjones-008 | 3 | Exact-name search supplemented by the three independently hashed .fastq alternatives; current identities and inventory totals agree |
| jjones-012 | 50 | 46 category-a records; four gzip-content cases agree with the earlier decoded-payload evidence |

**59 records saved; 51 remaining**: two_blades-015 (13), jjones-041 (2),
jjones-047 (20), skamoun-014 (16). Partial progress for failed jobs is retained,
but it is not a complete accepted project report. No final eight-project resolution
or GREEN verdict has been produced.

## Resume after authentication

On the Mac, from this repository:

```bash
python3 docs/archive/batches/2026-10-16/evidence/2026-10-17/resume-path-review.py
```

This validates saved evidence and lists unfinished records without SSH. With the
VPN connected and authenticated socket `$HOME/.ssh/v1333-codex-review-20261017.sock`:

```bash
python3 docs/archive/batches/2026-10-16/evidence/2026-10-17/resume-path-review.py --execute
```

The runner first refuses any surviving old collector. It reuses the four complete
project reports and saves each new comparison separately on the Mac, with at most
two readers. Each observation inventories the entire project before/after hashing;
combined observations must have identical whole-tree fingerprints, module hashes
and Git identities. Missing records, duplicate records, changed inventories or
conflicting candidate hashes prevent aggregation. Eight local synthetic tests pass.
If interrupted, run the same command after reauthentication: only unfinished
comparisons are scheduled. Keep the Mac awake and VPN connected while it runs.

When it produces a successful `paths-complete-<timestamp>.json`, run the local
`summarize-paths.cjs` with that filename, review its output, then run
`finalize-path-actions.py`. The final review generator is for use only after the
complete evidence has been accepted and item 2 committed. These derivations have
not yet run. Any unexpected output remains a stop condition.

## Other retained evidence

- All 48 dependent documents exported twice; the refreshed reference checks include
  legacy string IDs. Contents were unchanged and no blocker lists were populated.
- Three Jones .fastq alternatives for database .fastq.txt names fully hashed, without
  a valid original MD5 available. No historical equality is claimed for them.
- 26 successful gzip diagnostics: complete decoded payloads match recorded originals;
  compressed-byte hashes remain different. The four rice cases are now matched to
  the successful primary report; remaining bindings await the other project reports.
- Full test counts and the one HTTP parser failure remain in
  [validation-results.json](evidence/2026-10-17/validation-results.json) and
  [Git-readable excerpts](evidence/2026-10-17/VALIDATION_EXCERPTS.md).

Nothing has been merged, written to production or sent to owners. Existing 19/6/11
Kamoun decisions and all 192 entry identities are unchanged. Manual production
procedures remain proposals for George.


## Completed item commits and validation

| Item | Pushed implementation commits |
|---|---|
| 1 — diagnostic kind and derived labels | `47f6957` |
| 2 — eight project content resolutions | Incomplete: 59/110 records saved; final derivation not run |
| 3 — dependent-record procedure/exports | `aca906d`, `e98b9d2`; snapshot clarification `b1006b9` |
| 4 — exact Kamoun targets/totals | `cdc4df2` |
| 5 — placeholder payloads/manual Courville procedure | `93a0160` |
| 6 — LF, cross-links and first three pilots | `e33c3a3`; older findings entry-point labels clarified in this checkpoint |
| 7 — quiescence and sequential locks | `8095765` |

Three full runs: 2,084 passed; 2,083 passed / 1 HTTP parser failure; 2,084 passed.
Model-registration and smoke suites passed in all three. The isolated upload suite
rerun passed 39 tests. Archive: 167 tests; scratch integration: 58 tests. Both suites passed.
Eight additional local Python tests validate the resumable evidence aggregation.
The HTTP failure resembles the documented intermittent transport issue, but its
root cause was not established here. Do not claim three fully clean full runs.
