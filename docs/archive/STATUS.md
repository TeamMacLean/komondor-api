# Archive status — updated 16 November 2026

This is the current position of the HPC-to-S3 archive work. Older plans,
previews and snapshots under `docs/archive/` are historical; where they disagree
with this page, this page and the records it links to win.

The 13 November update adds Gargy's HPC retention instruction and records the
published completion evidence. Production/transfer observations below remain
dated 3 November; this update performs no new live check.

## Done

- **Production code.** API `f2e464c`, Web `5e7bcf2`, Power `d98fab1`, Nudge
  `3791969`, all on their GitHub default branches. API and Web were deployed on
  16 November with the HPC keep-date feature
  ([record](DEPLOYMENT_2026-11-16.md)); Power and Nudge are unchanged since
  3 November ([record](DEPLOYMENT_2026-11-03.md)).
- **Master, not yet deployed.** The retention follow-up was reviewed and merged
  on 16 November: web master is `284f762` and API master includes `7225374`.
  Deployment is pending
  ([procedure](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md),
  [review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md)).
- **Web master, 27 November: `af16f37`, not yet deployed.** Web-only; no API
  change is needed. Since `284f762` it adds the project-page redesign
  (`6905b26`, `7cc01c7`, `84af546`), retires HPC-only controls once a
  Project's HPC copy is gone and locks accession editing on archived Projects
  (`89cadf1`), and shows "In AWS · verified <date>" on archived file lists in
  place of the arrival MD5 columns (`d29cc35`). Checked by the web unit tests
  and a production build only, not against a live archived Project.
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

1. **Set the keep dates (George, manual).** Five holds plus the 11 Kamoun KEEP
   Projects, from each project page. The
   [list with IDs and suggested dates](HPC_RETENTION.md#keep-dates-to-set-george)
   is in the retention page. Do Gargy first, as the
   [test](GARGY_HPC_PRESERVATION_TEST.md). Finish the five holds before step 2
   starts. Set them after the follow-up deployment (step 6), so each date's
   requester and reason are recorded with it and nothing needs backfilling.
2. **HPC deletion review for the 170 archived Projects outside the five holds.** For
   each: a fresh source/S3 check immediately before deletion, manual deletion by
   George, then `confirm-absent`. No waiting period: George set the pre-deletion
   hold to zero on 23 October. The pilot restore passed the same day. Check the
   [current retention register](HPC_RETENTION.md) first; these are review
   candidates, not approved deletion targets. Work through the
   [per-Project deletion checklist](HPC_DELETION_CHECKLIST.md).
3. **The six manual-disposal entries.** Deleted by George outside the archive
   CLI, with no S3 copy. See the outcome table and
   [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md).
4. **Gulnara's ENA reassignment.** The four Lichen CoCulture source Projects
   stay on HPC until the copy into the destination Project is done and
   verified. [Plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). They can join
   step 2 only after their release is explicitly reviewed and recorded, and
   their keep dates are cleared.
5. **Gargy HPC retention.** Preserve
   `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
   `5fc012bda3efcb29338b7d58`) until George explicitly releases it. No end date
   supplied; this is independent of Gulnara. The
   [retention requirements](HPC_RETENTION.md) describe the application
   feature: independent AWS/HPC indicators and the admin-editable
   `preserveOnHpcUntil` date. It was deployed on 16 November. George's
   [Gargy test](GARGY_HPC_PRESERVATION_TEST.md) is step 1. Until the dates are
   set, these five exclusions are manual only.
6. **Follow-up feature: reviewed and merged 16 November; deploy next.**
   The API and web changes implement the
   [spec](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md): visible disabled actions,
   requester/reason history, raw BSON date safeguards and repair, contact link,
   computed archive/deletion dates, and a read-only CSV/email review report.
   [Review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md). Deploy API and web
   together, API first
   ([procedure](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)). Then George backfills
   the production holds, sets `HPC_DUE_REPORT_TO` and web
   `HPC_RETENTION_CONTACT_EMAIL`, checks a report by hand, and separately installs
   the documented January/July schedule. `HPC_RETENTION_YEARS` defaults to 5.
   No production fields, email delivery or cron installation were changed.
   Review fixes require a fresh release reason, validate retention years at
   startup, keep pages available when date lookups fail, and list uncertain
   eligibility separately from due candidates. CSV files refuse overwrites.
   Compatibility details are in [BREAKING_CHANGES.md](../../BREAKING_CHANGES.md).
   Once backfilled and reviewed, Project date/requester/reason are the current
   hold record and `hpc-retention-holds.json` is historical.
7. **Housekeeping.** Optionally set `READS_ROOT_PATH` in the API `.env`.
8. **Rename and describe the 22 AI-registered Projects (George).** These are
   the 22 Projects registered on 22 October: 16 Talbot, Courville and five
   Kamoun/Saunders. Each still has its directory name as its name, plus generated
   short and long descriptions. There is no edit form for this yet. The checklist,
   with a link to each Project, is in [PROJECT_NAME_TIDY.md](PROJECT_NAME_TIDY.md).

## Standing rules

- Silence is consent for projects on the three plus-5-years exports. Owners are
  contacted only about a genuine new discrepancy, with a short deadline.
- Deletion is always manual. Never hand-edit `storage.*` or `archiveMigration.*`.
- Kamoun's "keep on HPC" decisions stand, including *Wheat Blast - Zambia
  2018-2020* and *Ronny_Helen_Pinfestans_Pmirabilis_timecourse*.
