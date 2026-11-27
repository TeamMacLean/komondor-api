# HPC deletion checklist (per Project)

Written 14 November 2026 from the [preservation feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md),
updated 27 November against the [current status](STATUS.md) and
[recorded deployment](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md).
This update performs no live check. It collects every gate for removing one archived Project's HPC tree in one
place. The [runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md#4-review-and-delete-manually)
remains the reference for each command; this page is the order to work in and
the traps found so far.

Deletion is always George's manual action. Nothing below authorises deleting
anything by itself. Stop at the first gate that fails, preserve the data, and
record why.

## Once, before the first deletion of a session

- [ ] **The reviewed preservation follow-up and archive-date gate are deployed.**
  George reported API `2474c4a` and web `a470095` on 27 November; confirm
  current running code before a later batch. API precedes web on redeploy.
  The preservation controls check active dates and malformed raw BSON values,
  and record requester/reason history. For new archive selections, the
  [27 November policy](HPC_RETENTION.md#policy-from-27-november-2026-aws-only-after-the-hpc-date-has-passed)
  requires the later of the age-based archive date and keep date to have passed.
  `lock` refuses earlier or unknown dates; a deliberate early exception needs
  `--before-review-date "<reason>"`, retained in the lock receipt. This does
  not reopen the completed October batch.
- [ ] **Current retained Projects are excluded.** The twelve saved dates,
  requesters and history were independently verified on 27 November: Gargy
  through 26 November 2027 and Joe Win's eleven through 26 November 2031.
  Xanthoria follows the normal age policy, currently 30 October 2031, with no
  extra date override. Consult [HPC_RETENTION.md](HPC_RETENTION.md) and live
  Project fields by exact ID/path; no repeat backfill is due. All thirteen
  retained roots were checked present after the final disposal job. The old
  [machine-readable register](hpc-retention-holds.json) is historical and not
  read by code. Gulnara's four source exclusions were separately released;
  deletion and native confirmations are complete. Do not rerun completed
  packages or treat these historical receipts as a new deletion instruction.
- [ ] **No stored date has a non-date type.** The follow-up checks raw BSON
  before Mongoose casting, flags invalid values publicly, and blocks deletion.
  Its deployment is reported complete, but confirm the running version and
  continue this read-only check on v1333:

  ```bash
  mongosh --quiet mongodb://localhost:28015/komondor --eval 'printjson(db.projects.find({ $expr: { $not: [{ $in: [{ $type: "$preserveOnHpcUntil" }, ["date", "null", "missing"]] }] } }, { name: 1, path: 1, preserveOnHpcUntil: 1 }).toArray())'
  ```

  Expected: `[]`. Anything listed needs an administrator to fix it before any
  deletion review. The follow-up project page flags it and an administrator
  may repair it with a requester and reason; the raw previous value is
  retained in history. Do not use an older page for the repair.
- [ ] **The mount roots are confirmed.** The project page shows
  `READS_ROOT_PATH` (default `/tsl/data/reads`), but its presence check and the
  CLI use `DATASTORE_ROOT` on the archive host (recorded as `/mnt/reads`).
  Confirm that both point to the same tree before treating either as evidence.

## For each Project

1. [ ] **No active hold**, checking the Project's date, requester and reason.
   Also check current decisions in [HPC_RETENTION.md](HPC_RETENTION.md), by
   Project ID *and* relative path. The agreed retention period must have ended
   (or an earlier release been explicitly agreed), with any extension checked
   and fresh manual review completed. Gulnara's four sources are already
   removed and confirmed; no hold or confirmation action remains for them.
2. [ ] **Not a direct-disposal entry.** The original six Kamoun no-S3
   disposals completed on 27 November; their metadata was retired and their
   HPC roots removed. Do not use archive `confirm-absent` for them or rerun
   their completed package. Any future no-S3 disposal requires a separately
   reviewed procedure. [Completion](batches/2026-11-27/kamoun-direct-disposal/evidence/COMPLETED.json).
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
7. [ ] **George performs the reviewed removal**, either by running the
   single printed `rm -rf -- '…'` manually or submitting a separately reviewed
   Slurm package with equivalent current checks. Compare every target with its
   approved root. Never pipe generated text to a shell or reuse an older file. The command cannot see a date set *after* it was printed, so
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
| The page or CLI says the keep date is invalid | A non-date value is stored (see the type check above) | With the follow-up deployed, an administrator repairs it through the project form; history retains the raw previous value. Do not delete until resolved |


## Review list

Use the [deletion-due report](../S3_PROJECT_ARCHIVAL_RUNBOOK.md#deletion-due-review-report)
ad hoc to find overdue and next-six-month candidates; no recurring schedule is
required. It includes active unarchived
projects and separately labels existing manual-disposal dispositions, so being
listed is **not** permission to delete or a claim that an AWS copy exists.
Invalid keep dates are included for attention with no eligibility date. Every
candidate must still pass every gate above; expiry and clearing never delete
anything automatically.
