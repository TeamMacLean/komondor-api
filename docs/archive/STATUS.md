# Archive status — updated 13 November 2026

This is the current position of the HPC-to-S3 archive work. Older plans,
previews and snapshots under `docs/archive/` are historical; where they disagree
with this page, this page and the records it links to win.

The 13 November update adds Gargy's HPC retention instruction and records the
published completion evidence. Production/transfer observations below remain
dated 3 November; this update performs no new live check.

## Done

- **Production code.** API `4bb4f36`, Web `e9e183c`, Power `d98fab1`, Nudge
  `3791969`, all on their GitHub default branches.
  [Deployment record](DEPLOYMENT_2026-11-03.md).
- **Database reconciliation (22 October).** 22 unregistered directories were
  registered as Projects, then 26,724 operations corrected paths, added
  13,052 File/AdditionalFile pairs, retired two empty Projects and recorded
  original values and history. The 69-operation Project 2178 consolidation
  followed. [Record](batches/2026-10-16/reconciliation-production-2026-10-22/README.md).
  Do not rerun that plan; any later correction needs a fresh preview.
- **Every batch entry has a database outcome.**
  [197-entry outcome table](batches/2026-10-16/reconciliation-production-2026-10-22/OUTCOMES.md):

  | Outcome | Entries |
  | --- | ---: |
  | Archive to S3 | 175 |
  | Pending manual disposal (no S3 copy) | 6 |
  | KEEP on HPC, unchanged | 11 |
  | Empty directory recorded | 2 |
  | Empty Project retired | 2 |
  | Consolidated into an existing Project | 1 |

- **S3 transfer.** All 175 archive Projects (13.45 TB) were uploaded and
  verified by 2 November 20:55 GMT. The
  [completion receipt and three companion files](evidence/transfer-completion-20261103/README.md)
  are now preserved unchanged in the repository, with provenance and checksums.
- **Owner contact: none needed.** The discrepancies the
  [action plan](batches/2026-10-16/ACTION_PLAN.md) would have taken to owners
  (unregistered directories, missing or misplaced files, empty projects) were
  all resolved in the database without contact. The 22 registered Projects have
  an administrative custodian (17 `shrestha`, 5 `winj`) because their original
  owner is unknown ([list](batches/2026-10-16/reconciliation-preview-2026-10-22/OWNERSHIP_AND_NEXT_STEPS.md)).
  Naming the real owners is optional and blocks nothing.

## Remaining

1. **HPC deletion review for the 170 archived Projects outside the five holds.** For
   each: a fresh source/S3 check immediately before deletion, manual deletion by
   George, then `confirm-absent`. No waiting period: George set the pre-deletion
   hold to zero on 23 October. The pilot restore passed the same day. Check the
   [current retention register](HPC_RETENTION.md) first; these are review
   candidates, not approved deletion targets. Work through the
   [per-Project deletion checklist](HPC_DELETION_CHECKLIST.md).
2. **The six manual-disposal entries.** Deleted by George outside the archive
   CLI, with no S3 copy. See the outcome table and
   [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md).
3. **Gulnara's ENA reassignment.** The four Lichen CoCulture source Projects
   stay on HPC until the copy into the destination Project is done and
   verified. [Plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). They can join
   step 1 only after their release is explicitly reviewed and recorded.
4. **Gargy HPC retention.** Preserve
   `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
   `5fc012bda3efcb29338b7d58`) until George explicitly releases it. No end date
   supplied; this is independent of Gulnara. The
   [retention requirements](HPC_RETENTION.md) also record the pending application
   work prepared locally: independent AWS/HPC indicators and the admin-editable
   `preserveOnHpcUntil` date. Deployment and George's
   [Gargy test](GARGY_HPC_PRESERVATION_TEST.md) are pending.
   These five exclusions are manual; no production hold is installed.
5. **Housekeeping.** Optionally set `READS_ROOT_PATH` in the API `.env`.

## Standing rules

- Silence is consent for projects on the three plus-5-years exports. Owners are
  contacted only about a genuine new discrepancy, with a short deadline.
- Deletion is always manual. Never hand-edit `storage.*` or `archiveMigration.*`.
- Kamoun's "keep on HPC" decisions stand, including *Wheat Blast - Zambia
  2018-2020* and *Ronny_Helen_Pinfestans_Pmirabilis_timecourse*.
