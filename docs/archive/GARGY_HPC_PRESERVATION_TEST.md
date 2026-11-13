# Gargy — candidate for George's HPC preservation test

Prepared 13 November 2026. **Not executed. No production date has been set.**
George will test the project-page control after the reviewed API and web
feature branches are deployed. He suggested approximately a year and will
choose the actual date himself.

## Exact candidate

| Field | Value |
| --- | --- |
| Project ID | `5fc012bda3efcb29338b7d58` |
| Project | Gargy 2019 RNAseq |
| Requested HPC directory | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` |
| Recorded archive-host root | `/mnt/reads/two_blades/gargy_2019_rnaseq` |
| S3 prefix | `s3://tsl-hpc-reads/two_blades/gargy_2019_rnaseq` |
| Migration ID | `6adb2e0b5f563cce90e74409` |
| Recorded S3 verification | `2026-10-30T20:18:30.550Z` |
| Recorded payload | 59 files, 274,802,985,983 bytes |

Identity comes from the unchanged
[3 November register](evidence/transfer-completion-20261103/completed-project-register-20261103T121635Z.json).
That is historical transfer evidence, not a fresh presence check. The two HPC
mount roots must not be substituted blindly.

Gargy remains in the [manual retention exclusions](HPC_RETENTION.md), independent
of Gulnara. Testing the UI, clearing a date, or letting a date expire does not
release that existing instruction. Keep its source tree and S3 archive intact.

## Manual test after deployment

1. Open the project page for the exact ID above as an administrator. Confirm
   the project identity and both displayed paths. AWS should show its recorded
   verification date. HPC should show a current directory presence observation;
   if it is unknown or absent, investigate before treating the copy as present.
2. In **Preserve on HPC until**, choose the desired future date and save it.
   The date is inclusive through the end of that UTC day. No MongoDB shell
   edits or storage-state changes are required.
3. Reload the page. Confirm the saved date persists, both location indicators
   remain independent, and the notice tells users to contact **George Deeks**
   if they need longer HPC retention.
4. View the same project as a non-admin user who has access. Confirm the date
   and extension notice are visible, and the editing controls are absent.
5. Have the AI/operator inspect the latest Project's `preserveOnHpcUntil` and
   [manual exclusions](hpc-retention-holds.json) during deletion review. The
   deployed feature's native `status --json` also reports `preserveOnHpcUntil`,
   `hpcPreservationActive` and `hpcPreservationInvalid`.
6. If checking the command safeguard, use only the native read-only
   `deletion-command` preparation for this ID. With a future date it must refuse
   and emit **no deletion command**. Do not execute any output, remove files,
   or run `confirm-absent` as part of this test. An unexpected success is a
   failed test to investigate, not permission to delete.
7. Record the actual chosen date, test time, deployed API/web heads and results
   below. Leave the date set after the test. Any later release of the separate
   manual exclusion needs an explicit recorded decision from George.

## Result — awaiting George

- Chosen preserve-through date (UTC): not set
- Test performed at: pending
- API/web deployed heads: pending
- Admin save and reload: pending
- Reader-visible notice / no reader editing control: pending
- AWS/HPC location observations: pending
- Optional deletion-command refusal: pending
- Source files and S3 archive retained: required

The feature does not schedule deletion. All future deletions still require fresh
source/S3 verification and George's own manual action.
