# HPC deletion checklist (per Project)

Written 14 November 2026 from the [preservation feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md).
It collects every gate for removing one archived Project's HPC tree in one
place. The [runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md#4-review-and-delete-manually)
remains the reference for each command; this page is the order to work in and
the traps found so far.

Deletion is always George's manual action. Nothing below authorises deleting
anything by itself. Stop at the first gate that fails, preserve the data, and
record why.

## Once, before the first deletion of a session

- [ ] **The reviewed preservation feature is deployed** (API before web). Without
  it, `deletion-command` cannot see `preserveOnHpcUntil` at all.
- [ ] **The five manual holds also carry a preservation date.** The
  [retention register](hpc-retention-holds.json) is not read by any code: today
  `deletion-command` would print a command for the four Gulnara sources, and for
  Gargy until its date is saved. Set `preserveOnHpcUntil` on all five from their
  project pages (a far-future date for open-ended holds) so the CLI refuses
  them, and keep the register as the record of *why*.
- [ ] **No stored date has a non-date type.** Mongoose silently converts some
  hand-edited values: `""` reads as no hold, `0` as an expired 1970 date, and a
  bare `"2027-01-01"` as midnight rather than end of day. Read-only check on v1333:

  ```bash
  mongosh --quiet mongodb://localhost:28015/komondor --eval 'printjson(db.projects.find({ preserveOnHpcUntil: { $exists: true, $not: { $type: ["date", "null"] } } }, { name: 1, path: 1, preserveOnHpcUntil: 1 }).toArray())'
  ```

  Expected: `[]`. Anything listed needs an administrator to fix it before any
  deletion review. The project page shows such a value as *no date*, and the
  save button returns a conflict for it.
- [ ] **The mount roots are confirmed.** The project page shows
  `READS_ROOT_PATH` (default `/tsl/data/reads`), but its presence check and the
  CLI use `DATASTORE_ROOT` on the archive host (recorded as `/mnt/reads`).
  Confirm that both point to the same tree before treating either as evidence.

## For each Project

1. [ ] **Not one of the five holds** in [HPC_RETENTION.md](HPC_RETENTION.md),
   matched by Project ID *and* relative path. Gulnara's four are released only
   by a recorded review after her copies are verified; Gargy only by George.
2. [ ] **Not one of the six manual-disposal entries.** Those follow
   [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md):
   no S3 copy and no archive CLI.
3. [ ] **Fresh status**, saved to the record:

   ```bash
   node scripts/move-project-to-s3.js status --project-id "$ARCHIVE_PROJECT_ID" --json > "$ARCHIVE_RECORD/pre-deletion-status.json"
   ```

   Require state `aws_pending_hpc_deletion`, phase `verified`,
   `hpcPreservationActive: false` and `hpcPreservationInvalid: false`. An
   expired date is fine; it permits review, nothing more.
4. [ ] **Project page agrees**: AWS shows *Verified in AWS* with the recorded
   date, and HPC shows *On HPC (directory present)*. *HPC presence unknown*
   means the check could not see the tree (mount, permissions or path). Find
   out why; never read it as already deleted. AWS *verified* is the recorded
   transfer verification, not a fresh S3 audit; `deletion-command` does the
   fresh check.
5. [ ] **Manifests saved and compared** against the digests in status, as the
   runbook describes.
6. [ ] **Generate the command fresh**, immediately before deleting:

   ```bash
   node scripts/move-project-to-s3.js deletion-command --project-id "$ARCHIVE_PROJECT_ID" > "$ARCHIVE_RECORD/deletion-command.txt" 2> "$ARCHIVE_RECORD/deletion.stderr"
   ```

   Require exit 0 and an empty or reviewed stderr. A refusal that mentions
   `preserveOnHpcUntil` means stop: the Project is held.
7. [ ] **George runs the single printed `rm -rf -- '…'` by hand**, after
   comparing its path with the approved root. Never pipe it to a shell or reuse
   an older file. The command cannot see a date set *after* it was printed, so
   if anyone may have changed the Project since step 6, run step 6 again.
8. [ ] **Confirm absence** (dry run, then `--execute`) and save the final
   status, as the runbook describes. Require state `aws`, phase `completed`.

## If something changes mid-way

| Situation | What it means | Do |
| --- | --- | --- |
| `deletion-command` refuses with a preservation message | A future or malformed date is set | Stop. Do not delete. Check the page and the register |
| Refusal: "Archive identity changed during deletion checks" | Path, S3 URI, migration or manifest changed while checking | Repeat the review from step 3 |
| A date was set after the tree was already removed | `confirm-absent` refuses while it is active, leaving the Project in `aws_pending_hpc_deletion` | Record what happened. An administrator clears the date (the history keeps who and when), then run `confirm-absent` |
| HPC shows *unknown* or *absent* while state is still `aws_pending_hpc_deletion` | The tree is missing or unreadable before any approved deletion | Investigate as a discrepancy; do not confirm absence to tidy it |
| The page shows no date but the CLI says invalid | A non-date value is stored (see the type check above) | An administrator repairs it in the database, recording the before and after values; the page cannot |
