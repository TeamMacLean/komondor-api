# Archive status — updated 26 November 2026

This is the current documented position of the HPC-to-S3 archive work. Older
plans, previews and snapshots under `docs/archive/` are historical; where they
disagree with this page, this page and the records it links to win.

This update includes George's **26 November production keep-date verification
output**, checked against the reviewed batch. There was no direct agent access
to production. Transfer observations remain dated 3 November and the latest
recorded deployment is 16 November; running heads, website behaviour and
filesystem/S3 state were not rechecked by this read-back.

A separate **26 November Gulnara read-only preflight** subsequently checked its
five Project records and twelve selected sample trees directly on v1333. That
scoped observation does not refresh the other archive Projects. George also
confirmed retention functionality works; Claude is handling display polish as
separate web work.

## Done

- **Twelve HPC keep dates saved and verified.** George supplied a successful
  read-back on 26 November: Sara's Gargy through **26 November 2027**, and Joe
  Win's eleven Kamoun KEEP Projects through **26 November 2031**. All twelve
  have BSON dates, the expected requester/reason and one matching audit entry.
  [Verification evidence](evidence/hpc-retention-20261126/README.md). Gulnara's
  destination and four source Projects read back with no manual keep date;
  their five records are outside this batch's writes. George subsequently
  confirmed the functionality works; UI presentation is separate ongoing work.
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

1. **Retention presentation follow-up is separate.** George confirmed the
   functionality on 26 November and has Claude working on web presentation.
   No repeat date save is needed. Confirm running API/web heads before later
   operations; the Gulnara observer found clean API checkout `550074e` and
   datastore root `/mnt/reads`, not the running process's loaded code version.
   George plans to email Joe; no email is recorded as sent.
2. **Gulnara's ENA reassignment.** Her destination
   (`6ae4ac89a6b876c643741d27`) exists in the supplied read-back; use that identity.
   A fresh [preflight and execution plan](batches/2026-11-26/gulnara/README.md)
   confirms an empty destination and 40 files / 41.43 GB across the selected
   12 Samples and 12 Runs. It specifies 64 record changes and journalled recovery
   for standalone MongoDB. Seven checksum text files would enter the current
   ENA export as Reads; validate the separate 24-FASTQ submission list. Copy/apply
   tooling must be built and rehearsed before execution. Its expected normal
   archive-age date is 30 October 2031, subject to rechecking after reassignment.
   The four old source Projects remain temporarily excluded until
   independent copies, reassignment checks and explicit release review succeed.
   [Plan](GULNARA_ENA_REASSIGNMENT_2026-10-30.md). No reassignment execution is
   recorded; any active temporary dates must be cleared only on agreed release.
3. **HPC deletion review for the 170 archived Projects outside the five holds.**
   These remain candidates from the recorded batch, not approved targets.
   Check the [retention register](HPC_RETENTION.md) and the
   [per-Project deletion checklist](HPC_DELETION_CHECKLIST.md), including fresh
   source/S3 verification immediately before George's manual deletion and
   subsequent `confirm-absent`. No blanket waiting period applies: George
   removed the seven-day hold on 23 October and the pilot restore passed that
   day. No deletion or finalization is authorised by this documentation update.
4. **Gargy HPC retention.** Preserve
   `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` (Project
   `5fc012bda3efcb29338b7d58`) for the one year George told Sara, unless she asks
   otherwise. The saved date is **26 November 2027**. This remains independent
   of Gulnara and requires fresh manual review before later deletion.
5. **The six manual-disposal entries.** These are separate from the archive
   workflow: George deletes manually with no S3 copy. See the outcome table
   and [KAMOUN_DELETE_TARGETS.md](batches/2026-10-16/KAMOUN_DELETE_TARGETS.md).
   Recheck their current state before acting.
6. **Report/contact setup, if requested.** Confirm or set `HPC_DUE_REPORT_TO`
   and web `HPC_RETENTION_CONTACT_EMAIL`, and check the read-only report by
   hand. The documented January/July report schedule remains a separate
   installation step; there is no recorded production report/email test or
   schedule installation. This update neither installs a schedule nor sends
   messages. Once hold fields are populated and reviewed, they are the current
   record; retain `hpc-retention-holds.json` unchanged as history and preserve
   its explicit release conditions.
7. **Unpublished web wording follow-up.** Local commit `6905b26` in
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
