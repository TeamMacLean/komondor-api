# HPC archive candidates and discrepancies — 16 October 2026

**Current decision table:** [192 original entries with owner/contact, decision and finding](archive/batches/2026-10-16/README.md).
The [CSV](hpc-archive-candidates-2026-10-16.csv) is the filterable follow-up list. The
[JSON register](archive/batches/2026-10-16/register.json) preserves exact source rows, original values,
historical classifications, contacts and technical follow-up. No production mutations or owner outreach were performed.

## Policy and source decisions

Dan’s three exports contain 156 entries: Two Blades 48, Jones 56 and Talbot 52. All remain earmarked,
awaiting group decisions. Kamoun’s workbook has 19 archive requests, six delete-without-archive requests
and 11 KEEP entries after the operator’s two explicit clarifications. Do not treat every row as a deletion instruction.

The current batch is the explicit supplied list. **Ten years is only a proposed future rule.**
The imported age-based categories are not policy approval and do not remove candidates from this batch.
Directory mtime and file rollup dates are preserved observations; this review has not established that
any clustered date is an original sequencing date or a bulk-copy date. No external retention requirement is inferred.

## Independent review and corrections

Independent observation: **2026-10-16T20:30:26.719Z to 2026-10-16T20:31:11.362Z**, `v1333`, user `deeks`.
Production checkout stayed clean at `c6b9d77` before and after the inspection.
The reviewed verifier was executed in memory over SSH, using production master’s modules, with automatic
collection/index creation disabled. MongoDB and filesystem metadata were read; no AWS operations were performed.
See [provenance](hpc-verification-2026-10-16/independent-review/provenance.json).

Original Claude reports remain unchanged in `hpc-verification-2026-10-16/verify-*.json`.
The fresh `independent-review/verify-*.json` reports include full missing/untracked lists rather than
the originals’ first-20 samples. The originals are summaries with sampled paths, not complete per-file inventories.

- **17 of the 19 Kamoun archive requests have serious preflight anomalies**, primarily missing destination MD5 records.
  The imported READY labels ignored these. A metadata match is not an archive gate.
- **Eight registered projects have missing expected file paths**, including six Jones projects omitted from the earlier discussion.
- For the two highlighted projects, 29 missing expected paths have same-named files elsewhere.
  One has two candidates. No content comparison was performed, so “nothing is lost” is not established.
- **The ten unregistered Saunders directories total 801,506,677,663 bytes (801.5 decimal GB)**, not about 30 GB.
  Five correspond by source name to listed delete requests; five are outside the original candidate list.
  This is a name association, not authority to delete their contents.
- File counts, bytes, IDs and path discrepancies take precedence over estimates. Owner intent and the two KEEP clarifications remain authoritative.

## Specific directories requiring decisions

| Finding | Observed evidence | Next action |
| --- | --- | --- |
| Talbot numbered directories | 18 unregistered `project_*` directories, including `project_946` with no regular files | Ask the group to identify ownership and choose keep/register/archive through a reviewed route/dispose. CLI requires a Project record. |
| `two_blades/Courville` | No Project record; 100 files, 298,805,448,427 bytes; export owner `shrestha` | Confirm responsible owner and intended handling. |
| `jjones/witekk_s_americanum_gDNA_bgi` | 135 files, 319,776,477,622 bytes at mixed-case path; registered lowercase path absent | Agree and verify a path repair; do not rename or change Mongo automatically. |
| Five listed Saunders delete requests | Registered roots have no regular files; related mixed-case directories have substantial data | Confirm exact directory identity and disposal scope with Kamoun. Empty registered roots are not the data to remove. |
| Five additional Saunders directories | Outside the supplied 192 rows | Record separately and ask Kamoun; do not expand the batch silently. |
| Other empty roots | No regular files in registered `jjones/dingp_ath_atacseq_2019_optimization`, `ntalbot/long_read_assembly_of_african_yam_bean`; unregistered `two_blades/medicago_trucatala___19__pacbio` and `ntalbot/project_946` | Keep as findings awaiting an explicit decision. Empty regular-file count does not prove an empty directory or authorize DB removal. |

All ten unregistered Saunders directories (whole-directory inventory, not proof of equivalence to a source entry):

| Exact directory name under `/mnt/reads/skamoun` | Files | Observed bytes | Original scope |
| --- | ---: | ---: | --- |
| `saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01` | 641 | 239,985,996,303 | skamoun-015; association requires confirmation |
| `saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01` | 260 | 48,614,994,012 | skamoun-002; association requires confirmation |
| `saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130409.01` | 268 | 65,286,846,255 | Outside original list; decision needed |
| `saunderd_pstriiformis_South_African_isolates` | 24 | 109,802,811,903 | skamoun-003; association requires confirmation |
| `saunderd_pstriiformis_TCS_DianeSaunders_TSL.DS.20130809.01_113` | 38 | 32,165,487,135 | Outside original list; decision needed |
| `saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68` | 106 | 72,013,629,033 | skamoun-005; association requires confirmation |
| `saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83` | 124 | 158,139,688,071 | skamoun-016; association requires confirmation |
| `saunderd_pstriiformis_TSL.DS.20130722.01_TCS_99` | 16 | 6,156,498,502 | Outside original list; decision needed |
| `saunderd_pstriiformis_TSL.DS.20130730.01_TCS_105` | 34 | 41,786,044,848 | Outside original list; decision needed |
| `saunderd_pstriiformis_TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144` | 64 | 27,554,681,601 | Outside original list; decision needed |

## Missing registered paths

| Registered project | Missing paths | Serious anomalies | Follow-up |
| --- | ---: | ---: | --- |
| `/jjones/albugo_candida` | 2 | 108 | Resolve registered path and checksum anomalies; no READY claim. |
| `/jjones/arabidopsis_pacbio_renseq` | 20 | 46 | Resolve registered path and checksum anomalies; no READY claim. |
| `/jjones/resistance_to_p__infestans_in_s__americanum_line_sp2273__rpi_amr1_and_rpi_amr2__` | 3 | 12 | Resolve registered path and checksum anomalies; no READY claim. |
| `/jjones/rice_renseq` | 50 | 290 | Resolve registered path and checksum anomalies; no READY claim. |
| `/jjones/solynta_sequencing` | 2 | 17 | Resolve registered path and checksum anomalies; no READY claim. |
| `/jjones/whole_genome_shotgun_of_solanum_americanum` | 4 | 8 | Resolve registered path and checksum anomalies; no READY claim. |
| `/skamoun/janderso_rsolani` | 16 | 34 | Resolve registered path and checksum anomalies; no READY claim. |
| `/two_blades/japanse_isolate_timecourse` | 13 | 38 | Resolve registered path and checksum anomalies; no READY claim. |

`skamoun/janderso_rsolani`: 16 expected `raw/` paths have same-basename files in `processed/`.
`two_blades/japanse_isolate_timecourse`: 13 expected `raw/` paths have candidate files in `processed/`;
one also exists under `0h/0_hour/raw/`. Same name/size is not proof of matching bytes or biological content.
The [29 relocation observations](hpc-verification-2026-10-16/independent-review/relocated-file-candidates.json)
retain expected paths, stored File metadata, available MD5 fields and every same-basename candidate.
Do not silently rewrite records, mark them verified or use anomaly acknowledgement as proof that missing data is safe.

## S3 locations and CLI limits

Master’s groups-at-root layout remains authoritative. With the configured bucket, a file would be:
`s3://tsl-hpc-reads/<group>/<project>/<relative-file-path>`.
There is no added `projects/`, Mongo ID or `payload/` prefix for real project data.
Control manifests use `_control/projects/<project-id>/<migration-id>/`; disposable fixtures use `_smoke/<uuid>/`.
A configured optional base prefix would precede these paths. Payload goes directly to Deep Archive;
control manifests remain Standard. No S3 objects were created by this review.

**Unregistered directories cannot be archived by `move-project-to-s3.js`.** It requires a Mongo Project ID.
Registration/path repair or disposal outside the CLI needs a separately reviewed plan. Do not invent IDs,
pretend an empty registered project contains a sibling directory, or mark direct disposal as an S3 archive.
Files inside a valid project tree can be inventoried even without individual Read/AdditionalFile records,
but skipped symlinks/special entries and anomalies must still be reviewed. The website may lack those file listings.

## Verify before selecting a pilot or batch

Run from the reviewed checkout on the mounted host. The first selection step is a read-only shortlist check.
The optional report must be a new file outside `DATASTORE_ROOT`; it is the only file written by this command.
It reads Mongo and filesystem metadata, does not hash file contents, and needs no AWS configuration.

```bash
node scripts/archive-shortlist-verify.js \
  --csv docs/hpc-archive-candidates-2026-10-16.csv \
  --json "/storage/verify-shortlist-$(date -u +%Y%m%dT%H%M%SZ).json"
```

To check only the audited archive requests, add `--decision ARCHIVE_PI_APPROVED`.
Use `--group two_blades` (and the other three group names) separately to find directories with no Project record.
The original raw PowerScale exports have different columns: use the reconciled CSV above with `hpc_path`.
Exit 0 means the inspection ran, not that every candidate passed. Review verdicts, serious anomalies and active-work blockers.
`OK` means metadata correspondence only. `ANOMALIES_REQUIRE_REVIEW`, `ACTIVE_WORK`, missing/empty paths,
`NO_DB_PROJECT`, `AMBIGUOUS_DB_PROJECT`, `PATH_REFUSED` and `WALK_FAILED` require investigation.
A CSV path case mismatch may appear as `NO_DB_PROJECT`; the group report exposes the registered path and unmatched directory.
Then follow the [runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md) for a full plan, hashes, owner/current-work checks,
freeze, copy, restore/review and separately approved manual source deletion. Keep all 11 KEEP entries excluded.

## Owner follow-up

Filter the CSV by `AWAITING_GROUP_DECISION` for the 156 unaudited entries. Each row includes the source owner,
database owner, available contact email, a specific owner question and technical follow-up.
Group administrators must confirm contacts for missing/outdated owner records. No addresses were guessed
from usernames. Also ask Kamoun about exact Saunders directory identities and the five additional directories.
Existing KEEP decisions need no archival outreach. Technical findings on KEEP entries are retained for completeness.

The batch is complete only when each original entry has a recorded decision and the agreed action is evidenced;
a pending decision, failed migration or deferred action remains outstanding. Future semi-annual selection requires
an agreed age policy and date basis. No outreach, deletion or repair follows automatically from this table.
