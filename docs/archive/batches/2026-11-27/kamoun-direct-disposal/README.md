# Six Kamoun direct disposals — 27 November 2026

**Completed and audited.** Metadata retirement finished at **15:06:00 UTC**;
all four services were restored at **15:06:41 UTC**. George's Slurm job
**25342010** deleted the exact six directories in **52 seconds**, ending at
**15:20:56 UTC**. The copied JSONL/stdout logs passed the audit at **15:26:36 UTC**.
Independent checks found all six roots absent, all thirteen protected roots
present, and all 2,459 retired metadata records exactly preserved.
[Final completion receipt](evidence/COMPLETED.json).

This is the six original Kamoun spreadsheet DELETE decisions, with no S3 copy.
It is separate from the completed 175-project S3 migration and 174 HPC removals.

George requested this work on 27 November and explicitly confirmed that no
external writers are active and these directories will remain frozen. He ran
the reviewed service controller in his `tsldata` terminal; Codex executed the
reviewed retirement as `deeks`. George submitted the separate HPC Slurm job; its completion is recorded below.

## Exact scope

All paths below are relative to `/tsl/data/reads` on HPC, mounted at `/mnt/reads`
on v1333. The historical lowercase Saunders shell paths are not deletion targets.

| Entry | Project ID | Exact relative root | Files | Bytes |
| --- | --- | --- | ---: | ---: |
| skamoun-002 | 5fc012bda3efcb29338b7cf9 | skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01 | 260 | 48,614,994,012 |
| skamoun-003 | 5fc012bda3efcb29338b7cf5 | skamoun/saunderd_pstriiformis_South_African_isolates | 24 | 109,802,811,903 |
| skamoun-005 | 5fc012bda3efcb29338b7d5c | skamoun/saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68 | 106 | 72,013,629,033 |
| skamoun-013 | 5fc012bda3efcb29338b7d7a | skamoun/xiao_scr74 | 62 | 161,447,455,740 |
| skamoun-015 | 5fc012bda3efcb29338b7d0d | skamoun/saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01 | 641 | 239,985,996,303 |
| skamoun-016 | 5fc012bda3efcb29338b7cf8 | skamoun/saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83 | 124 | 158,139,688,071 |

Total: **1,217 regular files / 790,004,575,062 bytes**, plus the one recorded
internal GEL139 symlink. Xiao's historical count of 53 refers to newly registered
File/AdditionalFile pairs; its physical count is 62. Fresh metadata inventories
matched every October path, type and regular-file size, and repeated scans were
stable. The symlink is inspected without traversal and was removed as a link.

## Retirement outcome

All **2,459 records** are retained: 6 Projects, 9 Samples, 10 Runs, 8 Reads,
1,209 AdditionalFiles and 1,217 Files. No IngestJobs or NewsItems were in scope.
The existing reconciliation retirement field and append-only history were used;
prior fields/history and every storage/archive value were preserved. Project
nudges were disabled and ENA submission disabled for these retired Projects.
No permanent metadata deletion or AWS operation occurred.

The website-only `displayOnSite` feature was considered. It intentionally leaves
workers, Nudge and operational tools able to see hidden Projects, so it was not
used as a substitute for disposal retirement. All eight normal record models
now exclude the retired scope. Browser checks confirmed Xiao and GEL139 return
“Project not found”, while Gargy and Xanthoria remain accessible.

All thirteen protected Projects and directories were unchanged: Joe Win's
eleven KEEP Projects, Gargy and the new Xanthoria destination. Fresh production
queries confirmed Joe's eleven BSON keep dates are **2031-11-26T23:59:59.999Z**;
Gargy's is **2027-11-26T23:59:59.999Z**. George said no Joe email is needed.

## Evidence and verification

- [Database before-images and hold verification](../PUBLICATION.md#artifact-14).
- [Final source inventory](evidence/filesystem-preflight-r2-20261127.json).
- [Retirement plan](../PUBLICATION.md#artifact-18), SHA-256
  `47a03545ab758e871b8e07bea9daf57c02276f70bd245783878c1d4887bacd4e`.
- [Independent review](evidence/INDEPENDENT_REVIEW.md); 18 retirement tests,
  16 service-controller tests and 22 disposal guard tests passed.
- [Final actual-Mongo rehearsal](evidence/rehearsal-plan-r2.json): isolated
  temporary database, all 2,459 conditional writes, actual model exclusions,
  typed BSON round-trip, protected records, blind repeat refusal and inspected
  adoption without writes. Temporary test database removed; production untouched.
- [Completed retirement](evidence/retirement-completed.json),
  [independent live after-state](evidence/live-after-state.json),
  [services restored](evidence/services-restored.json),
  [website checks](evidence/website-checks.json).
- [Full execution archive](../PUBLICATION.md#artifact-15):
  2,466 retained files, 1,599,735 compressed bytes, SHA-256
  `0e8556d081bba266e10a33c3f67beecea6a97a414e02b84921cac4d503dd56ef`.
  Every archive member matched the [server manifest](evidence/retirement-evidence-manifest.json)
  by size and SHA-256; [copy verification](evidence/retirement-evidence-copy-verified.json).

Server execution evidence: `/storage/komondor-kamoun-retirement-20261127-01`.
Controller pack: `/storage/komondor-kamoun-disposal-20261127-01`.
Independent plan backup: `/storage/komondor-kamoun-disposal-backup-20261127-01`.
Do not rerun the completed retirement or controller.

A final preflight initially stopped on API HEAD drift from `2474c4a` to
`5a707a1`. The new commit changed documentation only; no runtime code changed.
The original plan and failed observation remain preserved. The refreshed plan
passed a new live before-state check and actual-Mongo rehearsal before execution.
API `5a707a16e5843fc18b7ada016dce962a393c432b` and web
`536c87446dbe71b4bbd15f9f867a23d4a255960d` were pinned throughout the window.

## Physical deletion and final audit

George submitted job **25342010** from the reviewed package
`/storage/komondor-kamoun-six-delete-20261127-01.tar.gz` (98,331 bytes, SHA-256
`16fbfe33a8b6019330220117b679984c0bead80e3c27fca73be453449b488d19`).
It bound the completed retirement receipt and sealed source inventory. The
historical review expiry was 20:58:38 UTC on 27 November. **Do not submit it again.**

- [Actual JSONL](evidence/job-25342010/deletion-25342010.jsonl) and
  [Slurm stdout](evidence/job-25342010/komondor-kamoun-6-25342010.log): all eleven
  package checksums and all twenty ordered audit events passed. All six
  preflights finished before any deletion. Exact targets, paths, bytes,
  identities, source seal, retirement seal and execution window match.
- [Log audit](evidence/job-25342010/job-25342010-audit.json): runner completed
  15:20:04.651947–15:20:56.704036 UTC, exit 0, GNU time 52.24 seconds,
  23,468 KiB peak memory, 0.67 CPU seconds; one CPU and 1 GB were ample.
- [Final Slurm accounting](evidence/job-25342010-accounting-user-supplied.json):
  George supplied COMPLETED / 0:0, 52 seconds. This was not queried directly;
  the copied logs independently prove the successful runner exit.
- [Independent NFS check](evidence/job-25342010-observation-01.json) at
  15:21:57 UTC: all six roots absent; Joe's eleven, Gargy and Xanthoria present.
- [Independent database check](evidence/job-25342010-database-after.json) at
  15:23:13 UTC: all 2,459 exact retired records retained, none divergent;
  all thirteen protected Project records unchanged.

These were no-S3 disposals. No archive `confirm-absent` is required and no AWS
storage state was invented. Logical file bytes removed total 790,004,575,062;
quota reclamation or filesystem snapshot retention was not measured.

The original package instructions and earlier checkpoint receipts remain
historical evidence. Reports, optional Gulnara staging/CSV cleanup and later
reviews are ad hoc. No Joe email, Gulnara chase or further disposal action is due.
Completion evidence is recorded on the separate
`codex/archive-disposal-completion-20261127` review branch, as George requested
for the end of this work. See the [publication and artifact register](../PUBLICATION.md).
