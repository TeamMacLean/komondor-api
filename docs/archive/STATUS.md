# Archive status — updated 26 November 2026

This is the current documented position of the HPC-to-S3 archive work. Older
plans, previews and snapshots under `docs/archive/` are historical; where they
disagree with this page, this page and the records it links to win.

This update reconciles the repository and deployment notes. It makes **no new
live production check**. Transfer observations are dated 3 November; the latest
recorded deployment is 16 November. Production keep dates and any later manual
operations must be checked before proceeding.

## Done

- **Recorded production deployment.** George reported API `48bcd53` and web
  `92d6794` deployed on 16 November, followed by web-only `284f762`. Power
  `d98fab1` and Nudge `3791969` were unchanged. The
  [follow-up deployment record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)
  supersedes the earlier same-day API `f2e464c` / web `5e7bcf2` deployment.
  API master `550074e` adds documentation only relative to `48bcd53`.
  These are recorded heads, not independently rechecked running heads today.
- **Preservation feature and follow-up.** Both are merged and reportedly
  deployed: separate HPC/AWS indicators, administrator-set keep dates,
  requester/reason history, malformed-date safeguards and repair, contact
  link, computed archive/deletion-review dates and a read-only CSV/email
  review report. The [16 November review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md)
  records 2,287 API unit/contract tests, 115 integration tests and 641 web
  tests passing. Those checks were not rerun for this documentation update.
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
  are preserved unchanged in the repository, with provenance and checksums.
  This historical completion evidence does not replace fresh deletion checks.
- **Original batch owner contact: none was needed.** The discrepancies the
  [action plan](batches/2026-10-16/ACTION_PLAN.md) would have taken to owners
  (unregistered directories, missing or misplaced files, empty projects) were
  all resolved in the database without contact. The 22 registered Projects have
  an administrative custodian (17 `shrestha`, 5 `winj`) because their original
  owner is unknown ([list](batches/2026-10-16/reconciliation-preview-2026-10-22/OWNERSHIP_AND_NEXT_STEPS.md)).
  Naming the real owners is optional and blocks nothing. This is separate from
  the possible keep-date notifications below.

## Remaining

1. **Read back production before making changes.** Confirm running API/web
   heads, the archive-host mount roots, and each relevant Project's current
   date, requester and reason. The 16 November notes recorded no dates set;
   that is not proof they remain unset. No Gargy production-test result has
   been recorded. The keep-date editor requires the local `admin` account;
   George's LDAP/ENA-admin login is not an API administrator.
2. **Record the scoped keep-date decisions (George, manual).** The
   [retention page](HPC_RETENTION.md#keep-dates-to-set-george) now distinguishes
   Sara's Gargy (one year; working date 26 November 2027) and Joe Win's 11
   Kamoun KEEP Projects (five years from today, 26 November 2031). George will
   email Joe; no message or production date change is performed by this update.
   Gulnara has one destination under the normal five-year archive-age policy,
   whose computed date needs a live read. That is 13 long-term Projects, with
   12 specific manual dates; her four old source holds are temporary safeguards,
   not four five-year commitments. Test Gargy first and record actual saved
   values. Keep all five original-batch exclusions in force for now.
3. **HPC deletion review for the 170 archived Projects outside the five holds.**
   These remain candidates from the recorded batch, not approved targets.
   Check the [retention register](HPC_RETENTION.md) and the
   [per-Project deletion checklist](HPC_DELETION_CHECKLIST.md), including fresh
   source/S3 verification immediately before George's manual deletion and
   subsequent `confirm-absent`. No blanket waiting period applies: George
   removed the seven-day hold on 23 October and the pilot restore passed that
   day. No deletion or finalization is authorised by this documentation update.
4. **Gulnara's ENA reassignment.** The four Lichen CoCulture source Projects
   stay on HPC until the copy into the destination Project is done and
   verified. [Plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). No execution is
   recorded. The one destination (`6ae4ac89a6b876c643741d27`) already existed
   in the 30 October snapshot; verify it rather than creating a duplicate.
   Sources can join deletion review after reassignment/copy verification and
   explicit release review, with any active temporary dates cleared.
5. **Gargy HPC retention.** Preserve
   `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
   `5fc012bda3efcb29338b7d58`) for the one year George told Sara, unless she asks
   otherwise. The working date is 26 November 2027; check it against the earlier
   promise before saving. This replaces the unspecified duration, remains
   independent of Gulnara and requires fresh manual review before later deletion.
6. **The six manual-disposal entries.** These are separate from the archive
   workflow: George deletes manually with no S3 copy. See the outcome table
   and [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md).
   Recheck their current state before acting.
7. **Report/contact setup, if requested.** Confirm or set `HPC_DUE_REPORT_TO`
   and web `HPC_RETENTION_CONTACT_EMAIL`, and check the read-only report by
   hand. The documented January/July report schedule remains a separate
   installation step; there is no recorded production report/email test or
   schedule installation. This update neither installs a schedule nor sends
   messages. Once hold fields are populated and reviewed, they are the current
   record; retain `hpc-retention-holds.json` unchanged as history and preserve
   its explicit release conditions.
8. **Unpublished web wording follow-up.** Local commit `6905b26` in
   `komondor-web-hpc-preservation-fixes-20261126` clarifies that the AWS label
   means recorded transfer verification, not a fresh S3 check. As inspected
   on 26 November it is one commit ahead of origin/master `284f762`, unpushed
   and not recorded as deployed. Review/publication/deployment remain separate
   work. Optionally also pin API `READS_ROOT_PATH` in `.env`.

## Standing rules

- Silence is consent for projects on the three plus-5-years exports. Owners are
  contacted only about a genuine new discrepancy, with a short deadline.
  George's planned email to Joe about the scoped keep dates does not
  retroactively change that batch policy.
- Deletion is always manual. Never hand-edit `storage.*` or `archiveMigration.*`.
- Kamoun's "keep on HPC" decisions stand, including *Wheat Blast - Zambia
  2018-2020* and *Ronny_Helen_Pinfestans_Pmirabilis_timecourse*.
- A keep date blocks HPC deletion, not copying to AWS. Expiry permits review
  only; there is no automatic deletion.
