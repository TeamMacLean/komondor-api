# Archive batch 2026-10-16: action plan

Status: proposed by George Deeks, 2026-10-17, for review before execution. Nothing here has been run.
Inputs: `../../../hpc-archive-candidates-2026-10-16.csv` (the reconciled register with production verification columns) and the four `verify-*.json` reports. Output: `action-plan.csv`, one row per original entry, 192 rows.

## Policy decisions that change the register

1. **Silence is consent.** Dan MacLean emailed every group leader months before this batch. Only the Kamoun group replied, which is why they have a dedicated spreadsheet. The operator's decision is that every project on the three PowerScale exports is approved for archiving. The register's `AWAITING_GROUP_DECISION` is therefore replaced by a technical classification of what the archive step needs.
2. **Contact owners only for discrepancies.** The only rows that go back to a group are directories with no Komondor project record, where the CLI cannot act and the ownership is unknown. The email names the directories, gives a short deadline, and states what happens on silence.
3. **Archival doubles as a data audit.** Historical uploads were often buggy and never repaired. Each archived project is inventoried against the database and sealed in a manifest; path repairs and empty-record cleanup are done where found; backfilling file records from manifests is a planned follow-up.
4. **Kamoun decisions are unchanged.** 19 archive, 6 delete without S3 copy, 11 keep, including the two operator-confirmed keeps.
5. The 10-year rule is not applied to this batch and is not needed for it.

## Classification of the 192 entries

| Action | Wave | Rows | On disk | Meaning |
|---|---|---:|---:|---|
| ARCHIVE | 1 | 33 | 1.67 TB | fully registered |
| ARCHIVE | 2 | 50 | 3.89 TB | partly registered, unregistered files archived from inventory |
| ARCHIVE | 3 | 43 | 4.19 TB | no file records, manifest is the inventory |
| ARCHIVE | 4 | 18 | 1.24 TB | Kamoun PI approved |
| FIX_PATHS_THEN_ARCHIVE | 3 | 7 | 1.15 TB | repair File.path for reads found under processed/, then archive |
| FIX_PATHS_THEN_ARCHIVE | 4 | 1 | 0.16 TB | same, Kamoun |
| FIX_RENAME_THEN_ARCHIVE | 1 | 1 | 0.32 TB | rename directory to lowercase registered path, then archive |
| CONTACT_DEADLINE |  | 18 | 0.66 TB | unregistered directory; one email, short deadline, then placeholder-project archive or delete |
| DELETE_MANUAL_AFTER_DIR_CONFIRM |  | 6 | 0.79 TB | Kamoun delete; confirm exact mixed-case directory names first, no S3 copy |
| TIDY_DELETE_PROJECT_RECORD |  | 2 | 0.00 TB | registered project, nothing on disk |
| TIDY_RMDIR |  | 2 | 0.00 TB | empty unregistered directory |
| KEEP |  | 11 | 1.46 TB | stays on HPC |

153 entries are archived in four waves without contacting anyone. Where `needs_acknowledge_known_anomalies` is `yes`, the preflight will report serious anomalies (typically legacy reads with no stored destination MD5, run status `error`, or MD5 `failed`) and `lock` needs `--acknowledge-known-anomalies`. Those are recorded facts about the upload era, not reasons to stop; they are sealed into the manifest.

## Order of work

1. **Quiet fixes, no contact.** Rename `jjones/witekk_s_americanum_gDNA_bgi` to the lowercase registered path. Repair `File.path` for the 8 projects whose registered reads sit under `processed/` rather than `raw/`, using `../../../hpc-verification-2026-10-16/independent-review/relocated-file-candidates.json` as the candidate list and confirming each by size before writing. Delete the 2 empty project records. Remove the 2 empty unregistered directories.
2. **Emails, two-week deadline.** One per group below, listing exact directory names and sizes. Wording: "reply by DATE with keep, archive or delete; after that we archive them under a placeholder project in your group". Archiving on silence is chosen over deleting on silence because it is reversible and costs under a pound per terabyte per month in Deep Archive. Kamoun also gets the five Saunders directories not on their sheet, with the question whether they join the delete list.
3. **Wave 1**, 33 fully registered projects, smallest first, each through `plan`, `lock`, `copy`, `deletion-command`, manual deletion, `confirm-absent` per the runbook. The first three are done with a second person watching.
4. **Wave 2**, 50 partly registered. **Wave 3**, 43 with no file records plus the repaired-path projects. **Wave 4**, Kamoun's 19.
5. **After the deadline:** register-and-archive or delete the unregistered directories per replies. Use the [exact placeholder payloads and manual Courville procedure](PLACEHOLDER_REGISTRATION.md); George must supply both group-administrator addresses. Kamoun direct disposal follows [the exact target ledger](KAMOUN_DELETE_TARGETS.md): five associated Saunders directories and the separate populated `xiao_scr74` project. The five additional directories remain pending. Dependent records are exported and handled together under the [exact cleanup proposal](DEPENDENT_RECORD_CLEANUP.md); never delete only a Project shell.
6. **Audit follow-up, not blocking:** a tool to backfill Read and AdditionalFile records from a sealed manifest, so archived projects stop showing an empty file list on the website.

## Contact list

### ntalbot: 17 directories, 0.36 TB

| Directory | Files | Bytes |
|---|---:|---:|
| ntalbot/project_1566 | 1 | 8,982,368,958 |
| ntalbot/project_1622 | 15 | 10,629,370,636 |
| ntalbot/project_2009 | 28 | 14,852,621,710 |
| ntalbot/project_2012 | 72 | 31,629,123,970 |
| ntalbot/project_2035 | 97 | 75,397,724,663 |
| ntalbot/project_2171 | 1 | 3,557,810,271 |
| ntalbot/project_2178 | 31 | 18,228,463,024 |
| ntalbot/project_230 | 7 | 8,728,408 |
| ntalbot/project_2323 | 40 | 22,039,506,100 |
| ntalbot/project_2370 | 11 | 78,243,529,352 |
| ntalbot/project_2561 | 34 | 1,523,739,906 |
| ntalbot/project_539 | 8 | 2,914,165,083 |
| ntalbot/project_592_593 | 3 | 5,229,182,384 |
| ntalbot/project_758 | 4 | 119,591 |
| ntalbot/project_809 | 6 | 27,090,686,963 |
| ntalbot/project_930 | 52 | 22,742,214,458 |
| ntalbot/project_945 | 20 | 38,737,500,366 |

### two_blades: 1 directories, 0.30 TB

| Directory | Files | Bytes |
|---|---:|---:|
| two_blades/Courville | 100 | 298,805,448,427 |

### skamoun: Saunders directories

Use [KAMOUN_DELETE_TARGETS.md](KAMOUN_DELETE_TARGETS.md) for the exact three-part ledger and pre-deletion check. Ten Saunders directories total 801,506,677,663 bytes; that excludes Xiao_SCR74. Five additional Saunders directories require a reply; silence means archive, never direct deletion.

## What this plan does not do

It does not change the archive code, the runbook's per-project checkpoints, or the rule that deletion is manual and separate. It does not delete anything on silence. It does not apply an age cutoff. It does not touch the 11 KEEP projects.
