# Archive status — updated 27 November 2026

This is the current position of the HPC-to-S3 archive work. Older plans,
previews and snapshots under `docs/archive/` are historical; where they disagree
with this page, this page and the records it links to win.

The 13 November update adds Gargy's HPC retention instruction and records the
published completion evidence. Production/transfer observations below remain
dated 3 November; this update performs no new live check.

The 27 November update records George's report that API and web master are
deployed, and the new AWS-after-HPC-date policy. It was not checked against the
live hosts.

## Done

- **Production code, as George reported on 27 November.** API master
  `2474c4a` and web master `a470095` are deployed. Power `d98fab1` and Nudge
  `3791969` are unchanged since 3 November
  ([record](DEPLOYMENT_2026-11-03.md)). Earlier records: the keep-date feature
  ([16 November](DEPLOYMENT_2026-11-16.md)) and the retention follow-up, first
  deployed that evening as API `48bcd53` and web `284f762`
  ([record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md),
  [review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md)).
- **New in the 27 November API deployment.** The archive CLI's `lock` refuses a
  Project not yet due for AWS (see the first standing rule), and the
  per-Project website visibility flag `displayOnSite`
  ([notes](../PROJECT_SITE_VISIBILITY.md)).
- **New in the 27 November web deployment (`a470095`).** Since `284f762` it adds the project-page redesign
  (`6905b26`, `7cc01c7`, `84af546`), retires HPC-only controls once a
  Project's HPC copy is gone and locks accession editing on archived Projects
  (`89cadf1`), and shows "In AWS · verified <date>" on archived file lists in
  place of the arrival MD5 columns (`d29cc35`). Later commits fix nav search
  (`521dbc4`), fold the AWS retention details into a collapsible (`21ac1ba`)
  and move HPC removal details under the HPC status (`a470095`). Checked by the
  web unit tests and a production build only; no check against a live archived
  Project is recorded here.
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

1. **Keep dates: done (27 November).** Gargy (26 Nov 2027) and the 11 Kamoun
   KEEP Projects (26 Nov 2031) have keep dates in production. The four Lichen
   CoCulture Projects need none: George has removed them from HPC (step 4).
   [Dates and requesters](HPC_RETENTION.md#keep-dates-to-set-george).
2. **HPC deletion review for the 170 archived Projects outside Gargy and the four Lichen Projects.** For
   each: a fresh source/S3 check immediately before deletion, manual deletion by
   George, then `confirm-absent`. No waiting period: George set the pre-deletion
   hold to zero on 23 October. The pilot restore passed the same day. Check the
   [current retention register](HPC_RETENTION.md) first; these are review
   candidates, not approved deletion targets. Work through the
   [per-Project deletion checklist](HPC_DELETION_CHECKLIST.md).
3. **The six manual-disposal entries.** Deleted by George outside the archive
   CLI, with no S3 copy. See the outcome table and
   [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md).
4. **Gulnara's ENA reassignment: done, as George reported on 27 November.**
   He has made the new Project for Gulnara's samples and then removed the four
   Lichen CoCulture source Projects from HPC, having had no reply from her.
   The sources' verified AWS copies remain. Not recorded here: the checks run,
   whether the destination is the planned Project `6ae4ac89a6b876c643741d27`,
   and whether `confirm-absent` was run for the four sources.
   [Original plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md).
5. **Gargy HPC retention.** Preserve
   `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
   `5fc012bda3efcb29338b7d58`) until George explicitly releases it. No end date
   supplied; this is independent of Gulnara. The
   [retention requirements](HPC_RETENTION.md) describe the application
   feature: independent AWS/HPC indicators and the admin-editable
   `preserveOnHpcUntil` date. It was deployed on 16 November. George's
   [Gargy test](GARGY_HPC_PRESERVATION_TEST.md) is not recorded as done.
   Gargy's keep date is now set (26 Nov 2027), so the CLI refuses its deletion.
6. **Follow-up feature: deployed; George's setup steps remain.**
   The API and web changes implement the
   [spec](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md): visible disabled actions,
   requester/reason history, raw BSON date safeguards and repair, contact link,
   computed archive/deletion dates, and a read-only CSV/email review report.
   [Review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md),
   [deployment record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md). George
   has set API `HPC_DUE_REPORT_TO` and web `HPC_RETENTION_CONTACT_EMAIL` to
   his own address (reported 27 November). Still to do: check a report by
   hand. The January/July
   email schedule is optional and not planned: reviews are ad hoc (see the last
   standing rule). `HPC_RETENTION_YEARS` defaults to 5.
   Deployment itself changed no production fields, email delivery or cron
   installation.
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

- **AWS only after the HPC date has passed (George, 27 November 2026).** A
  Project is selected for copying to AWS only once its deletion-review date,
  the later of its 5-year archive date and any keep date, has passed. `lock`
  refuses earlier copies unless given `--before-review-date "<reason>"`
  (API `2474c4a`, deployed 27 November). The October batch is unaffected.
  [Details](HPC_RETENTION.md#policy-from-27-november-2026-aws-only-after-the-hpc-date-has-passed).
- Silence is consent for projects on the three plus-5-years exports. Owners are
  contacted only about a genuine new discrepancy, with a short deadline.
- Deletion is always manual. Never hand-edit `storage.*` or `archiveMigration.*`.
- **Reviews are ad hoc (George, 27 November 2026).** There is no formal
  twice-yearly check. George runs a batch when he chooses, somewhere between
  twice a year and once every five years; twice a year is the ideal. He intends
  to make this semi-automated at some point; nothing is built yet.
- Kamoun's "keep on HPC" decisions stand, including *Wheat Blast - Zambia
  2018-2020* and *Ronny_Helen_Pinfestans_Pmirabilis_timecourse*.
