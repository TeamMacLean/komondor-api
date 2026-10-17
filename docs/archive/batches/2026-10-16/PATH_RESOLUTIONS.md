# Resolution of 110 missing expected file paths

Primary read-only production comparison: 2026-10-17T11:56:37.068Z to 2026-10-17T13:39:46.104Z, v1333 as deeks. Supplemental checks were completed earlier on the same day; their original timestamps are retained.
No files moved, no MongoDB edits, no S3 writes. Production remained at
`c6b9d77db069fa6dd808367086ff358302565b2f` with a clean checkout.

Of the 110 records, **51** have a physical candidate matching the recorded
original MD5, **26** have a validated gzip payload matching it, and
**33** have no valid original MD5. Current hashes for that last group
do not establish historical checksum equality. None requires a file move.

[Complete per-record decisions and hashes](path-resolutions.json),
[raw output](evidence/2026-10-17/paths-complete-20261017T125243Z.json),
[exact command/output hash](evidence/2026-10-17/paths-complete-20261017T125243Z.command.json),
and per-project command receipts/progress logs linked from that receipt are retained.
The [extension-variant supplement](evidence/2026-10-17/extension-paths-20261017T070916Z.json) and
[its exact command](evidence/2026-10-17/extension-paths-20261017T070916Z.command.json)
cover three Jones filenames ending in .fastq on disk but .fastq.txt in the database.
They supersede the initial exact-name search for those three records.
A [gzip-content diagnostic](evidence/2026-10-17/gzip-diagnostics-20261017T072649Z.json) resolves 26 further
checksum discrepancies: compressed bytes differ, while each complete decoded payload
matches its recorded original MD5. All gzip trailers validated. The diagnostic uses
the identical physical bytes as the primary hash run, checked by size, MD5 and SHA-256.

## What replaces FIX_PATHS_THEN_ARCHIVE

Do **not** repair File.path, move files into raw/, or rewrite historical Read records
to make this discrepancy disappear. The CLI derives the expected Read location from
Run.path + raw/ + File.originalName; changing File.path alone does not change that
expectation. Its inventory copies all present readable regular files in the project,
including processed/ and unregistered files. None of these eight project resolutions proposes
a file move. Any later move needs a separately reviewed manual command and fresh
identity/content checks; a plan label is not permission to move bytes.

- **a — 83 records:** one located candidate in the same run. Compare actual
  content MD5 to the recorded original when valid; if none was recorded, explicitly
  retain that limitation. Preserve the tree and seal the path discrepancy.
- **b — 0 records:** expected and stored locations are absent, with no
  same-basename regular file anywhere in this project's full inventory. Archive
  existing bytes with the missing record/loss documented. This establishes absence
  of the recorded file, not that an unknown renamed copy cannot exist elsewhere;
  it does not claim recovery of missing data.
- **c resolved — 27 records:** all candidate copies were hashed. The
  decision states whether copies are byte-identical, one uniquely matches the
  original MD5, or a validated gzip payload matches that MD5 within the same run.
  The 26 gzip cases explicitly preserve the compressed-byte mismatch; historical
  checksum interpretation is not silently rewritten. Preserve all copies and history.
- **c hold — 0 records:** unresolved mismatch or ambiguity. Hold the
  affected project for a separately recorded decision; do not silently choose a
  copy, rename a file or use anomaly acknowledgement to claim identity.

## Per-project disposition

| Entry | Project | Missing expected | a | b | c resolved | c hold | Proposed action |
|---|---|---:|---:|---:|---:|---:|---|
| two_blades-015 | `/two_blades/japanse_isolate_timecourse` | 13 | 12 | 0 | 1 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-004 | `/jjones/whole_genome_shotgun_of_solanum_americanum` | 4 | 4 | 0 | 0 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-005 | `/jjones/albugo_candida` | 2 | 2 | 0 | 0 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-008 | `/jjones/resistance_to_p__infestans_in_s__americanum_line_sp2273__rpi_amr1_and_rpi_amr2__` | 3 | 3 | 0 | 0 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-012 | `/jjones/rice_renseq` | 50 | 46 | 0 | 4 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-041 | `/jjones/solynta_sequencing` | 2 | 0 | 0 | 2 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| jjones-047 | `/jjones/arabidopsis_pacbio_renseq` | 20 | 0 | 0 | 20 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |
| skamoun-014 | `/skamoun/janderso_rsolani` | 16 | 16 | 0 | 0 | 0 | ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES |

## Required manifest and review receipt

Before each lock, take a fresh live plan and compare it to this record. Each
Read/Run/File record was re-read unchanged after its comparison, and each project
tree was re-inventoried unchanged at the end. These sequential database reads are
not a transaction or a freeze for a future archive. Preserve all physical paths, including duplicate
copies. Acknowledgement is for documented historical anomalies only.

After copy seals the source manifest, check every expected missing Read ID/path in
`dbExpectedMissing` and `anomalies` (`kind:db-file-missing`, `recordKind:read`). Check
all retained physical candidate paths, sizes and SHA-256 values in `entries`. The CLI
seals these inventory facts; it does **not** automatically embed this external
resolution prose or the complete database export. Keep a batch review receipt that
binds this JSON SHA-256 and review commit to the exact migration ID, source-manifest
S3 version/pointer and digest. Retain original missing paths and duplicate-db-path
anomalies rather than replacing them with invented normal metadata. This is an
archive of the surviving physical tree, not a claim the historical database is complete.

Never edit an already sealed manifest. A mismatch with this audit requires review
before manual HPC deletion, even if the upload itself verified. Normal restore,
verification and manual deletion checkpoints remain in force.

## two_blades-015 — /two_blades/japanse_isolate_timecourse

Project ID: `5fc012bda3efcb29338b7d67`. 13 expected paths reviewed;
14 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cda3efcb29338b9e70` | `0h/0h/raw/1312_LIB14323_LDI11928_NoIndex_L001_R1.fastq.gz` | c — resolved | `ace2cdb67a2b71bf9c64b3de111612fa` | 2 |
| `5fc012cba3efcb29338b9889` | `0h/0h/raw/JISO_0h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9be4` | `0h/0h/raw/JISO_0h_R2.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9ccf` | `12h/12h/raw/JISO_12h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9fae` | `12h/12h/raw/JISO_12h_R2.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9c8f` | `168h/168h/raw/JISO_168h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cba3efcb29338b975f` | `168h/168h/raw/JISO_168h_R2.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9e4e` | `24h/24h/raw/JISO_24h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9ef5` | `24h/24h/raw/JISO_24h_R2.clean.paired.fq` | a | none recorded | 1 |
| `5fc012caa3efcb29338b95a5` | `36h/36/raw/JISO_36h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9da6` | `36h/36/raw/JISO_36h_R2.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cba3efcb29338b982d` | `72h/72h/raw/JISO_72h_R1.clean.paired.fq` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9e89` | `72h/72h/raw/JISO_72h_R2.clean.paired.fq` | a | none recorded | 1 |

Candidate comparison for Read `5fc012cda3efcb29338b9e70`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `0h/0_hour/raw/1312_LIB14323_LDI11928_NoIndex_L001_R1.fastq.gz` | 3858761752 | `ace2cdb67a2b71bf9c64b3de111612fa` | `ec68c87a536897fcad2d35789715dd4d6bee224713011b2f598d86fa8a8c8205` |
| `0h/0h/processed/1312_LIB14323_LDI11928_NoIndex_L001_R1.fastq.gz` | 3858761752 | `ace2cdb67a2b71bf9c64b3de111612fa` | `ec68c87a536897fcad2d35789715dd4d6bee224713011b2f598d86fa8a8c8205` |

Candidates compared. Preserve every copy in place; record matching/duplicate paths without moving bytes or changing Read/File history.

## jjones-004 — /jjones/whole_genome_shotgun_of_solanum_americanum

Project ID: `5fc012bda3efcb29338b7d0a`. 4 expected paths reviewed;
4 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cda3efcb29338b9fbb` | `sp2273/sp2273_1/raw/R_DMP02900-W_HNVHKBCXX_L1_1.fq.gz` | a | `3db4f4583bcb35cc30e64aaa8eadc874` | 1 |
| `5fc012cda3efcb29338b9f6c` | `sp2273/sp2273_1/raw/R_DMP02900-W_HNVHKBCXX_L1_2.fq.gz` | a | `930af2445087db81d0b4410adc508185` | 1 |
| `5fc012cda3efcb29338b9e7a` | `sp2273/sp2273_1/raw/R_DMP02900-W_HNVHKBCXX_L2_1.fq.gz` | a | `28c2d9fa151fe53dc32356e8b0d66763` | 1 |
| `5fc012cda3efcb29338b9fe7` | `sp2273/sp2273_1/raw/R_DMP02900-W_HNVHKBCXX_L2_2.fq.gz` | a | `351cf903efb283b24047cf5e9a92e44e` | 1 |

## jjones-005 — /jjones/albugo_candida

Project ID: `5fc012bda3efcb29338b7d29`. 2 expected paths reviewed;
2 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cca3efcb29338b9da3` | `acem2_solexa/run1/raw/acem2_run146_lane7.i300bp.R1.fq` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9e80` | `acem2_solexa/run1/raw/acem2_run146_lane7.i300bp.R2.fq` | a | none recorded | 1 |

## jjones-008 — /jjones/resistance_to_p__infestans_in_s__americanum_line_sp2273__rpi_amr1_and_rpi_amr2__

Project ID: `5fc012bda3efcb29338b7d3a`. 3 expected paths reviewed;
3 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fcba83ed8dd4a63058cc19d` | `rad_sequencing_on_bs/rad_seq_psti_2271/raw/TSL_JJones_SolanumS-Parent_sequence_1.fastq.txt` | a | none recorded | 1 |
| `5fcba8c9d8dd4a63058cc1a1` | `rad_sequencing_on_bs/rad_seq_psti_2273/raw/TSL_JJones_SolanumPop1-R_sequence_1.fastq.txt` | a | none recorded | 1 |
| `5fcba9fdd8dd4a63058cc1a5` | `rad_sequencing_on_bs/rad_seq_psti_bs_all/raw/TSL_JJones_SolanumPop1-BS_sequence_1.fastq.txt` | a | none recorded | 1 |

## jjones-012 — /jjones/rice_renseq

Project ID: `5fc012bda3efcb29338b7d2b`. 50 expected paths reviewed;
51 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cba3efcb29338b968e` | `os_1/os_1/raw/Os_1_mixed_L3_1_l170.fq.gz` | a | `8fba126f2c68a17a679a1522710bfd1b` | 1 |
| `5fc012cda3efcb29338b9f9a` | `os_10/os_10/raw/Os_10_mixed_L3_1_l170.fq.gz` | a | `3d96aaf8bba1fa2eab14bc99f1754c7e` | 1 |
| `5fc012cba3efcb29338b96f1` | `os_10/os_10/raw/Os_10_mixed_L3_2_l170.fq.gz` | a | `0ebf18f508be94a32d6a227222d4715e` | 1 |
| `5fc012cba3efcb29338b996a` | `os_11/os_11/raw/Os_11_mixed_L3_1_l170.fq.gz` | a | `b38c2aaf411eba80af90baa73193f4d3` | 1 |
| `5fc012cca3efcb29338b9a46` | `os_11/os_11/raw/Os_11_mixed_L3_2_l170.fq.gz` | a | `8e46d65cefbc172a9c35c83d3c77d69e` | 1 |
| `5fc012cda3efcb29338b9ffc` | `os_12/os_12/raw/Os_12_mixed_L3_1_l170.fq.gz` | a | `283723b3a21c71c995a9f6d9adc9ae95` | 1 |
| `5fc012cca3efcb29338b9d20` | `os_12/os_12/raw/Os_12_mixed_L3_2_l170.fq.gz` | a | `5cc18f304822dd3912b1473f3baa5016` | 1 |
| `5fc012cda3efcb29338b9f06` | `os_13/os_13/raw/Os_13_mixed_L3_1_l170.fq.gz` | a | `3bf57fedd02c5456e8019cd8c95d7aca` | 1 |
| `5fc012cba3efcb29338b96c0` | `os_13/os_13/raw/Os_13_mixed_L3_2_l170.fq.gz` | a | `14ad25c9e94e54694b294c3ca1137d41` | 1 |
| `5fc012cba3efcb29338b990e` | `os_14/os_14/raw/Os_14_mixed_L3_1_l170.fq.gz` | a | `0affbf6ce342033a2279eeaf336b2d5d` | 1 |
| `5fc012cca3efcb29338b9cc2` | `os_14/os_14/raw/Os_14_mixed_L3_2_l170.fq.gz` | a | `d4461bd5039dc1a446de4912e5cc38b1` | 1 |
| `5fc012cba3efcb29338b98c2` | `os_15/os_15/raw/Os_15_mixed_L3_1_l170.fq.gz` | a | `cbb51193697e35fc3d84ddc2415f8438` | 1 |
| `5fc012cca3efcb29338b9ccc` | `os_15/os_15/raw/Os_15_mixed_L3_2_l170.fq.gz` | a | `7d90f652ebac72daeefe65a3cbebf6b9` | 1 |
| `5fc012cda3efcb29338b9f3b` | `os_17/os_17/raw/Os_17_mixed_L3_1_l170.fq.gz` | a | `e6cb1cccb561fa1f5733052e49fb7f20` | 1 |
| `5fc012cca3efcb29338b9b0e` | `os_17/os_17/raw/Os_17_mixed_L3_2_l170.fq.gz` | a | `bf513212fa718484f872338e56575a4b` | 1 |
| `5fc012cda3efcb29338b9f7d` | `os_18/os_18/raw/Os_18_mixed_L3_1_l170.fq.gz` | a | `46c4cf1aeb347991f13cedbd4dde2fa5` | 1 |
| `5fc012cba3efcb29338b971a` | `os_18/os_18/raw/Os_18_mixed_L3_2_l170.fq.gz` | a | `3da600475791289b76367648a8323041` | 1 |
| `5fc012cba3efcb29338b971f` | `os_19/os_19/raw/Os_19_mixed_L3_1_l170.fq.gz` | a | `9ac130eae59a18a760ee2b04f99608a1` | 1 |
| `5fc012cba3efcb29338b9670` | `os_19/os_19/raw/Os_19_mixed_L3_2_l170.fq.gz` | a | `d588da630ce7d4bf9b0ddec915ad4061` | 1 |
| `5fc012cba3efcb29338b995c` | `os_2_2/os_3/raw/Os_3_mixed_L3_1_l170.fq.gz` | a | `25f9e968390e1b1e45610042ddae5af5` | 1 |
| `5fc012cca3efcb29338b9df5` | `os_2_2/os_3/raw/Os_3_mixed_L3_2_l170.fq.gz` | a | `2f567fc0973786c2431a583443be23db` | 1 |
| `5fc012cca3efcb29338b99fb` | `os_2/os_2/raw/Os_2_mixed_L3_1_l170.fq.gz` | a | `afb0d5b2cfbffc0fcb0b8abf3a508e18` | 1 |
| `5fc012cca3efcb29338b9d4e` | `os_2/os_2/raw/Os_2_mixed_L3_2_l170.fq.gz` | a | `a04af517c68f60b98715ffec11340f4c` | 1 |
| `5fc012cba3efcb29338b985f` | `os_20/os_20/raw/Os_20_mixed_L3_1_l170.fq.gz` | a | `53c0333d3bc7a057756f4548a1feac21` | 1 |
| `5fc012cca3efcb29338b9d45` | `os_20/os_20/raw/Os_20_mixed_L3_2_l170.fq.gz` | a | `681fda1ac59294e7048fa58ef4f8f5a0` | 1 |
| `5fc012cca3efcb29338b9a7e` | `os_21/os_21/raw/Os_21_mixed_L3_1_l170.fq.gz` | a | `6429657085d9108066c0e179fd2d90eb` | 1 |
| `5fc012cca3efcb29338b9a0d` | `os_21/os_21/raw/Os_21_mixed_L3_2_l170.fq.gz` | a | `6c0b469ee897e698d130b56f40116dde` | 1 |
| `5fc012cca3efcb29338b9cd3` | `os_22/os_22/raw/Os_22_mixed_L3_1_l170.fq.gz` | a | `d6f63dd41cd439e9bad838b9084cd78d` | 1 |
| `5fc012cca3efcb29338b9ba2` | `os_22/os_22/raw/Os_22_mixed_L3_2_l170.fq.gz` | a | `8251c158217ba24fc23396eedbacbb20` | 1 |
| `5fc012cca3efcb29338b9a2b` | `os_23/os_23/raw/Os_23_mixed_L3_1_l170.fq.gz` | a | `d6acb72c585db5aeb3c748a1149625df` | 1 |
| `5fc012cda3efcb29338b9f28` | `os_23/os_23/raw/Os_23_mixed_L3_2_l170.fq.gz` | a | `1df2d7501891cc9bcf51b6ccfe734b55` | 1 |
| `5fc012cca3efcb29338b9ad5` | `os_24/os_24/raw/Os_24_mixed_L3_1_l170.fq.gz` | a | `b1c96124301ff4ef3674dd39bdfa716e` | 1 |
| `5fc012cca3efcb29338b9a33` | `os_24/os_24/raw/Os_24_mixed_L3_2_l170.fq.gz` | a | `2c27981b32ce09ea63a98587ca881f4a` | 1 |
| `5fc012cba3efcb29338b982e` | `os_4/os_4/raw/Os_4_mixed_L3_1_l170.fq.gz` | a | `f373eff1fad3d3d9794aad7d3e5e1305` | 1 |
| `5fc012cca3efcb29338b9b88` | `os_4/os_4/raw/Os_4_mixed_L3_2_l170.fq.gz` | a | `7df2cabd0d3eb1856b8e30a600cf366e` | 1 |
| `5fc012cba3efcb29338b9774` | `os_5/os_5/raw/Os_5_mixed_L3_1_l170.fq.gz` | a | `ff4a2fdc09576d536b92aa09dd9d6a13` | 1 |
| `5fc012cda3efcb29338b9fca` | `os_5/os_5/raw/Os_5_mixed_L3_2_l170.fq.gz` | a | `791c0210336c679c0021718568e41279` | 1 |
| `5fc012cba3efcb29338b9882` | `os_6/os_6/raw/Os_6_mixed_L3_1_l170.fq.gz` | a | `eb0d54a91a2eccedb8f81187412ae26b` | 1 |
| `5fc012cca3efcb29338b9d70` | `os_6/os_6/raw/Os_6_mixed_L3_2_l170.fq.gz` | a | `61d285ae7f00dbb47668b4fa71157326` | 1 |
| `5fc012cba3efcb29338b98da` | `os_7/os_7/raw/Os_7_mixed_L3_1_l170.fq.gz` | a | `92aab72dadc9477531b6c46244560d13` | 1 |
| `5fc012cca3efcb29338b9aab` | `os_7/os_7/raw/Os_7_mixed_L3_2_l170.fq.gz` | a | `1350e5f24e0d326db09cd5fa031c485a` | 1 |
| `5fc012cba3efcb29338b9792` | `os_8/os_8/raw/Os_8_mixed_L3_1_l170.fq.gz` | a | `1545a3b8daec380a4d8c0726ff5918ae` | 1 |
| `5fc012cba3efcb29338b96c9` | `os_8/os_8/raw/Os_8_mixed_L3_2_l170.fq.gz` | a | `f4886c15c6346f6e470b5a53137e73fa` | 1 |
| `5fc012cba3efcb29338b9917` | `os_9/os_9/raw/Os_9_mixed_L3_1_l170.fq.gz` | a | `3887cc02c5794778a0fddd6ba06e2d1a` | 1 |
| `5fc012cca3efcb29338b9ceb` | `os_9/os_9/raw/Os_9_mixed_L3_2_l170.fq.gz` | a | `7793280dbfb01089ac8d90b38cb5c970` | 1 |
| `5fc012cba3efcb29338b9926` | `rice_pacbio_1/pacbio_1/raw/rice_pacbio_ccs_sample_1.fastq.gz` | c — resolved | `f42e1b40be9df3f11c12be106da10467` | 1 |
| `5fc012cba3efcb29338b9753` | `rice_pacbio_16/rice_pacbio_16/raw/AJI_2.fastq.gz` | a | `310ce6ec56f6a3552aff2dd75d1dd05d` | 1 |
| `5fc012cba3efcb29338b981f` | `rice_pacbio_2/pacbio_2/raw/rice_pacbio_ccs_sample_2.fastq.gz` | c — resolved | `496a8aacde9368f7158cead24044fd5b` | 1 |
| `5fc012cba3efcb29338b97b2` | `rice_pacbio_2/pacbio_2/raw/rice_pacbio_ccs_sample_3.fastq.gz` | c — resolved | `51132b7a78aae271222336f64d368f04` | 2 |
| `5fc012cda3efcb29338b9e7b` | `rice_pacbio_4/pacbio_4/raw/rice_pacbio_ccs_sample_4.fastq.gz` | c — resolved | `5b2ecfee51c53970046029ab21293dab` | 1 |

Candidate comparison for Read `5fc012cba3efcb29338b9926`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `rice_pacbio_1/pacbio_1/processed/rice_pacbio_ccs_sample_1.fastq.gz` | 99277506 | `ce09bc709db7eb917b79c1b4a8723d8c` | `4bc862e8eb5af5a8c667b951537706c77ba72f80f792171c0713a8146e289f4b` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 295889478 bytes; MD5 `f42e1b40be9df3f11c12be106da10467`; SHA-256 `bfb1bf39a1a5ba76dd4043132a9bda9d80ecba6ecf813c5aa91442acd508d46e`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b981f`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `rice_pacbio_2/pacbio_2/processed/rice_pacbio_ccs_sample_2.fastq.gz` | 88795398 | `414cd05dba2e0b14ef198691d0e87e95` | `7db074a69348090408e6521db7f0de1e679267dee06149d68603cf5163584555` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 255104560 bytes; MD5 `496a8aacde9368f7158cead24044fd5b`; SHA-256 `9aa74c4802c026e50af67988f5f1ad7d70187e696d3117f722e1524890d4334a`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b97b2`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `rice_pacbio_2/pacbio_2/processed/rice_pacbio_ccs_sample_3.fastq.gz` | 189528284 | `dd4c1db277756bd15cf6abb510a31049` | `5b453a79e6420bc2a762d194d634a68f9eb462b429cce3319da39f56b390d748` |
| `rice_pacbio_3/pacbio_3/processed/rice_pacbio_ccs_sample_3.fastq.gz` | 189528284 | `dd4c1db277756bd15cf6abb510a31049` | `5b453a79e6420bc2a762d194d634a68f9eb462b429cce3319da39f56b390d748` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 551414576 bytes; MD5 `51132b7a78aae271222336f64d368f04`; SHA-256 `d49873c1dfe846c38af25bcccb15ace3a62417ee7e355c4296962bdfd3c04446`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cda3efcb29338b9e7b`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `rice_pacbio_4/pacbio_4/processed/rice_pacbio_ccs_sample_4.fastq.gz` | 125963714 | `125e284b2ad3bd947434c1137102c9f8` | `5ea761455b92db3a4fe5a10f2838cbe99470cd6f187328036561f758b5dcff9b` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 358317116 bytes; MD5 `5b2ecfee51c53970046029ab21293dab`; SHA-256 `c26e36b9fa9dacad3b747d8403a0f81c507986d8177fb4fee98193f8e35209b2`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

## jjones-041 — /jjones/solynta_sequencing

Project ID: `5fc012bda3efcb29338b7d28`. 2 expected paths reviewed;
2 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cca3efcb29338b9bbc` | `solynta_b98/solynta_b98_smrt_renseq/raw/B98.fastq.gz` | c — resolved | `a75faa2ffa94085c241716110ebf2599` | 1 |
| `5fc012cca3efcb29338b9c02` | `solynta_b98/solynta_b98_smrt_renseq/raw/B981.fastq.gz` | c — resolved | `a75faa2ffa94085c241716110ebf2599` | 1 |

Candidate comparison for Read `5fc012cca3efcb29338b9bbc`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `solynta_b98/solynta_b98_smrt_renseq/processed/B98.fastq.gz` | 54413765 | `f7b946f6fa6948019ad101b07cf094a2` | `8c6eef7c7670519db2ea1bcf357c89d195191e8e6076523261e544d385ab0be4` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 197895856 bytes; MD5 `a75faa2ffa94085c241716110ebf2599`; SHA-256 `b0b9e8ae225c975dea9902bb630bb5aefd33d17dd63509bd3e76fb48d1a10694`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9c02`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `solynta_b98/solynta_b98_smrt_renseq/processed/B981.fastq.gz` | 54413765 | `f7b946f6fa6948019ad101b07cf094a2` | `8c6eef7c7670519db2ea1bcf357c89d195191e8e6076523261e544d385ab0be4` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 197895856 bytes; MD5 `a75faa2ffa94085c241716110ebf2599`; SHA-256 `b0b9e8ae225c975dea9902bb630bb5aefd33d17dd63509bd3e76fb48d1a10694`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

## jjones-047 — /jjones/arabidopsis_pacbio_renseq

Project ID: `5fc012bda3efcb29338b7d60`. 20 expected paths reviewed;
20 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cca3efcb29338b9a9b` | `bur_0_pacbio_renseq/bur_0_pacbio_renseq_2/raw/Bur-0_ROI_2.fastq.gz` | c — resolved | `36ef2a37d616dddd23a3c929e564d969` | 1 |
| `5fc012cba3efcb29338b9818` | `ct_1_pacbio_renseq/ct_1_pacbio_renseq/raw/Ct-1_ROI_2.fastq.gz` | c — resolved | `cf9060b613d84d5bc3c4765e6e996b55` | 1 |
| `5fc012cca3efcb29338b9be0` | `edi_0_pacbio_renseq/edi_0_pacbio_renseq/raw/Edi-0_ROI.fastq.gz` | c — resolved | `5340dbffd61e9b38c507d52377292a26` | 1 |
| `5fc012cba3efcb29338b98a7` | `hi_0_pacbio_renseq/hi_0_pacbio_renseq/raw/Hi-0_ROI.fastq.gz` | c — resolved | `b24fc2646c20a0bf2d80fde98c39850b` | 1 |
| `5fc012cca3efcb29338b9b48` | `hr_5_pacbio_renseq/hr_5_pacbio_renseq/raw/HR-5_ROI.fastq.gz` | c — resolved | `8ea641cb01c19bf7abd3e9da4ca176bc` | 1 |
| `5fc012cda3efcb29338b9f6f` | `kn_0_pacbio_renseq/kn_0_pacbio_renseq/raw/Kn-0_ROI.fastq.gz` | c — resolved | `a2e6c049c96b24e5be8a645f4112d9f0` | 1 |
| `5fc012cda3efcb29338ba057` | `ler_0_pacbio_renseq/ler_0_pacbio_renseq/raw/Ler-0_ROI.fastq.gz` | c — resolved | `76ecc083e8d0fcd66992006ea0ec05a3` | 1 |
| `5fc012cda3efcb29338ba088` | `mt_0_pacbio_renseq/mt_0_pacbio_renseq/raw/Mt-0_ROI.fastq.gz` | c — resolved | `6f2478d7e114e86672eeec2d35a307ba` | 1 |
| `5fc012cba3efcb29338b9841` | `no_0_pacbio_renseq/no_0_pacbio_renseq/raw/No-0_ROI.fastq.gz` | c — resolved | `d214a786f3e3c1e0cd5538c882c4fd8a` | 1 |
| `5fc012cca3efcb29338b9c45` | `oy_0_pacbio_renseq/oy_0_pacbio_renseq/raw/Oy-0_ROI.fastq.gz` | c — resolved | `54002d69f86c0b0eb5f6b0911150f0c9` | 1 |
| `5fc012cba3efcb29338b99dc` | `po_0_pacbio_renseq/po_0_pacbio_renseq/raw/Po-0_ROI_2.fastq.gz` | c — resolved | `82869a40139d973f15e3ea4b69ca9264` | 1 |
| `5fc012cca3efcb29338b9cb2` | `rsch_4_pacbio_renseq/rsch_4_pacbio_renseq/raw/Rsch-4_ROI.fastq.gz` | c — resolved | `2ca1fa96e5b71e9b3a6aa5482db251e8` | 1 |
| `5fc012cca3efcb29338b9de3` | `sf_2_pacbio_renseq/sf_2_pacbio_renseq/raw/Sf-2_ROI.fastq.gz` | c — resolved | `494264b6aedfc531419fde3c8cdce58f` | 1 |
| `5fc012cba3efcb29338b9956` | `tsu_0_pacbio_renseq/tsu_0_pacbio_renseq/raw/Tsu-0_ROI_2.fastq.gz` | c — resolved | `80d40b393de7e8ed87d345ccb6e1a0d9` | 1 |
| `5fc012cba3efcb29338b999f` | `wil_2_pacbio_renseq/wil_2_pacbio_renseq/raw/Wil-2_ROI.fastq.gz` | c — resolved | `4335afabbc22059c06c6386893153449` | 1 |
| `5fc012cca3efcb29338b9e16` | `ws_0_pacbio_renseq/ws_0_pacbio_renseq_2/raw/Ws-0_ROI.fastq.gz` | c — resolved | `82a5d61cb2ab574efd4f8c3b1fbada95` | 1 |
| `5fc012cca3efcb29338b9d78` | `ws_2_pacbio_renseq/ws_2_pacbio_renseq/raw/Ws-2_ROI_2.fastq.gz` | c — resolved | `e4fe08a7e2befb75a33d32277ba5576b` | 1 |
| `5fc012cba3efcb29338b9967` | `wu_0_pacbio_renseq/wu_0_pacbio_renseq/raw/Wu-0_ROI.fastq.gz` | c — resolved | `ade488af02eb0a8b7ad72f8756748f43` | 1 |
| `5fc012cda3efcb29338b9f01` | `yo_0_pacbio_renseq/yo_0_pacbio_renseq/raw/Yo-0_ROI.fastq.gz` | c — resolved | `ea385edd649fd92d701f6217a5d5129e` | 1 |
| `5fc012cca3efcb29338b9dd1` | `zu_0_pacbio_renseq/zu_0_pacbio_renseq/raw/Zu-0_ROI_2.fastq.gz` | c — resolved | `dc6fb2ec15a0d46b707eeaf64bc3c0fe` | 1 |

Candidate comparison for Read `5fc012cca3efcb29338b9a9b`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `bur_0_pacbio_renseq/bur_0_pacbio_renseq_2/processed/Bur-0_ROI_2.fastq.gz` | 50064540 | `a9e50a4ff248be042b5614ba712d765e` | `9ce3ad18c4fecbb96c7bc967f9ebb42a4bdd2b3db3f4be0643b636764ed23a49` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 142191971 bytes; MD5 `36ef2a37d616dddd23a3c929e564d969`; SHA-256 `0713045a1ccdb7c2645617735de53983b6326759d155730687a97f4fdcd93cc5`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b9818`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `ct_1_pacbio_renseq/ct_1_pacbio_renseq/processed/Ct-1_ROI_2.fastq.gz` | 61472784 | `f08409e38e4cc75e71eab726c82ce850` | `4d7307f35f1d8081254b251e7fb646e040411033933dcf85a287d26db6043f1b` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 186674385 bytes; MD5 `cf9060b613d84d5bc3c4765e6e996b55`; SHA-256 `13147b0e62d19cc19348c24f2cb7b5528389f7a0e5dec5e39a721f8bd17e1b43`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9be0`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `edi_0_pacbio_renseq/edi_0_pacbio_renseq/processed/Edi-0_ROI.fastq.gz` | 62821843 | `2fba5393d4d762b86138cad533440963` | `f7298f52f1307e58ffed22ab74540a0b9a894a97c29c61c87a174cbd036df23e` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 174843434 bytes; MD5 `5340dbffd61e9b38c507d52377292a26`; SHA-256 `6a4f6f50a1496ee2d2ba907d61b5419e41036125ba16552fd98c22648fcad912`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b98a7`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `hi_0_pacbio_renseq/hi_0_pacbio_renseq/processed/Hi-0_ROI.fastq.gz` | 27084420 | `8e0d88f426489adb9c09258500e206df` | `87aa34da8f5ffbd536192729f013e394ee7b3b33104228d32ffced7d78979f3f` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 74832995 bytes; MD5 `b24fc2646c20a0bf2d80fde98c39850b`; SHA-256 `51f9a6edd80f9b2bd40db8200e9f78568d7855aff3a93f3a33926aba943aa016`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9b48`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `hr_5_pacbio_renseq/hr_5_pacbio_renseq/processed/HR-5_ROI.fastq.gz` | 68861624 | `16c792c102b9c6d47c3b9ac8368b2097` | `a9a8fb0b6bb265509f436e949bb87b96a757899f13f9617f384e62015309c252` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 200889943 bytes; MD5 `8ea641cb01c19bf7abd3e9da4ca176bc`; SHA-256 `ae4a814f5b1e4c615b69d2dbd8323c5200a8ee08d01c9542f9273dcbad847277`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cda3efcb29338b9f6f`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `kn_0_pacbio_renseq/kn_0_pacbio_renseq/processed/Kn-0_ROI.fastq.gz` | 19864944 | `4cf9a3066773e0674ca90e8e8325925a` | `73f32e2e401256f6eb99a056578fd304bbf2511a00602b372ebec63edc38b2c6` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 55991070 bytes; MD5 `a2e6c049c96b24e5be8a645f4112d9f0`; SHA-256 `b8a0b0e1cb499a3f47639c431e2acc41a2bde09878ce653751070f5393361eaf`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cda3efcb29338ba057`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `ler_0_pacbio_renseq/ler_0_pacbio_renseq/processed/Ler-0_ROI.fastq.gz` | 32067608 | `380062f69559fa558a68ce2d51199d22` | `3aaa722fe892423a1d87c8947db94a469e090c9cb743bfa5fd8ac973a76c1462` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 87629243 bytes; MD5 `76ecc083e8d0fcd66992006ea0ec05a3`; SHA-256 `8e473e31c69b2852429c2a43ce7423963a37641f9e56cec9af905ffd28ecf9b2`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cda3efcb29338ba088`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `mt_0_pacbio_renseq/mt_0_pacbio_renseq/processed/Mt-0_ROI.fastq.gz` | 108262695 | `f755c2f510ec412c69622b748761a8d6` | `40d399a05b5aba4caf9ade7f31b10d7cf0a367c749119b8d3c678f7caacf7627` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 301644497 bytes; MD5 `6f2478d7e114e86672eeec2d35a307ba`; SHA-256 `2fe0f91c48608b13aae86bcd16818f6a571cf41d9d156f25e6eeedcf34b4a654`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b9841`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `no_0_pacbio_renseq/no_0_pacbio_renseq/processed/No-0_ROI.fastq.gz` | 30973581 | `a7a94b64a1be78545e01e15f51df6f5c` | `a9444fadb4b45ca41ae75f7d722515e7ebb1a9b587b00888d26e649d690985af` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 84501332 bytes; MD5 `d214a786f3e3c1e0cd5538c882c4fd8a`; SHA-256 `e523e4a53f190d80f6258317632a6b11593e756a82f3f2adbb2d5d98500600d5`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9c45`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `oy_0_pacbio_renseq/oy_0_pacbio_renseq/processed/Oy-0_ROI.fastq.gz` | 84402046 | `f6a97e4ee08eae42f6b60e9ed8a3fa30` | `58f46debadb685ba19d9f03694d5fdac6729b1a16307fb260adca61c339e4186` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 216147894 bytes; MD5 `54002d69f86c0b0eb5f6b0911150f0c9`; SHA-256 `f1fc84f3caaa07a32d3ecf5e2b853cfb181752f726d2d3e88c05134ef2e2b374`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b99dc`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `po_0_pacbio_renseq/po_0_pacbio_renseq/processed/Po-0_ROI_2.fastq.gz` | 34641253 | `74e6889c561707973bedb2267b491ae8` | `5a05ae785c7a0b90b01d891272b752b4493a4a3dc498493500cef87ac7825c5d` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 95588714 bytes; MD5 `82869a40139d973f15e3ea4b69ca9264`; SHA-256 `5c2a71e222ea78ce975f99962e785a76eec91f1be61b729055579c2bfef0e14e`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9cb2`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `rsch_4_pacbio_renseq/rsch_4_pacbio_renseq/processed/Rsch-4_ROI.fastq.gz` | 32508836 | `6b0cd9339ccb13b80f216821ad7863c6` | `85da1944e2f0abc14a74c52bd9c42f38c1a2fff07b9a5ac1977095159770707d` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 90255615 bytes; MD5 `2ca1fa96e5b71e9b3a6aa5482db251e8`; SHA-256 `5ef914cce3039c8d2e114f940c9817dc41df813c74cc1700cceab5efd0126264`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9de3`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `sf_2_pacbio_renseq/sf_2_pacbio_renseq/processed/Sf-2_ROI.fastq.gz` | 80296871 | `637de84df30562e66b444dff93134f13` | `8b9fa9b97753619d01213acf698827f9bf16ccadb0e4c97262d8112e1c955b6f` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 204906053 bytes; MD5 `494264b6aedfc531419fde3c8cdce58f`; SHA-256 `d639b000d94219cdbecc9bfbebb294703efb2c87946cb4806017565dfbbc7875`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b9956`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `tsu_0_pacbio_renseq/tsu_0_pacbio_renseq/processed/Tsu-0_ROI_2.fastq.gz` | 32498454 | `e965f0001d5b44779055df05260a956a` | `3b1ccd19711c944a92f31044469bde65e69962566a278866ec3d8953fe111fc3` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 92115839 bytes; MD5 `80d40b393de7e8ed87d345ccb6e1a0d9`; SHA-256 `bb76859c3bc06dc1648e614537873dc41148bce64285f05abe991323aefdde74`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b999f`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `wil_2_pacbio_renseq/wil_2_pacbio_renseq/processed/Wil-2_ROI.fastq.gz` | 38568434 | `4671d995fc4644d6bb3018fa5485e250` | `65662c6a1227d92fdfc058208b811efe572cf80d9c6dfbbef0db463681a71f61` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 114098270 bytes; MD5 `4335afabbc22059c06c6386893153449`; SHA-256 `4030969458fa7a1b08fa0b3891e712698799cfc87a1561a87593c9a1ecaca597`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9e16`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `ws_0_pacbio_renseq/ws_0_pacbio_renseq_2/processed/Ws-0_ROI.fastq.gz` | 34122639 | `bed2b21cf0c8a1bb84769df7b83fde42` | `8127230c1b6491e677ac04a8f64503a59c38e37033c26b926b9c0f1dac02901d` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 96882665 bytes; MD5 `82a5d61cb2ab574efd4f8c3b1fbada95`; SHA-256 `aca68d37803814724d3924a4883a740d94e90d72a118e775b96f472c260e1864`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9d78`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `ws_2_pacbio_renseq/ws_2_pacbio_renseq/processed/Ws-2_ROI_2.fastq.gz` | 45631587 | `21e914b829414c8738a9a79c1840d08e` | `08ade54b8c9142ebf5cf000bce01c00d12de9aaad04e353318a677331aca0bb5` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 121609843 bytes; MD5 `e4fe08a7e2befb75a33d32277ba5576b`; SHA-256 `11628345cb023be0da14332a0cbe77951c007103e66560bb64bc61a88d10f965`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cba3efcb29338b9967`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `wu_0_pacbio_renseq/wu_0_pacbio_renseq/processed/Wu-0_ROI.fastq.gz` | 36609936 | `61f0b84452b3c8e5c8dc1ca1e2899429` | `f6932f9afc154317deaafcf04e33589803fb72f0a6363d2878e7450c24db9dd8` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 102045939 bytes; MD5 `ade488af02eb0a8b7ad72f8756748f43`; SHA-256 `e709dcd28404bed94c3c685211ec9dc9517fde12efaa9419a4e16a65501fae3a`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cda3efcb29338b9f01`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `yo_0_pacbio_renseq/yo_0_pacbio_renseq/processed/Yo-0_ROI.fastq.gz` | 32314514 | `bcfcf0bd31334f10a45bd485d389cbea` | `8b2eb4826f131191eea51c9b4ea19957bcd4e9833c8b535d41445800a1198a74` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 93348364 bytes; MD5 `ea385edd649fd92d701f6217a5d5129e`; SHA-256 `ee33a1226e8c9fa0a289a8190a8f686ec4881a52fdf604fec6337e44c0222370`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

Candidate comparison for Read `5fc012cca3efcb29338b9dd1`:

| Candidate relative path | Bytes | Actual MD5 | SHA-256 |
|---|---:|---|---|
| `zu_0_pacbio_renseq/zu_0_pacbio_renseq/processed/Zu-0_ROI_2.fastq.gz` | 38768115 | `5a1a587adb3cbd66cf11d6ed8fb26a8c` | `f994f6f9e3027e52c6eee781bd995021d45fe21bd5f125acd250ec95469ac360` |

The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.

Decoded payload: 109652732 bytes; MD5 `dc6fb2ec15a0d46b707eeaf64bc3c0fe`; SHA-256 `f0512b0a57411795d2311c9af688060fbbb65f4b09458fecd9724d4567f209eb`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.

## skamoun-014 — /skamoun/janderso_rsolani

Project ID: `5fc012bda3efcb29338b7d3d`. 16 expected paths reviewed;
16 distinct regular files hashed. Proposed file moves: **none**.
Proposed database writes: **none**. Action: **ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES**.

| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |
|---|---|---|---|---:|
| `5fc012cca3efcb29338b9a85` | `sample1/run1/raw/AG8_2_200_1.fastq.trim.paired` | a | none recorded | 1 |
| `5fc012cda3efcb29338ba00d` | `sample1/run1/raw/AG8_2_200_2.fastq.trim.paired` | a | none recorded | 1 |
| `5fc012cda3efcb29338ba0b7` | `sample1/run1/raw/AG8_2_500_1.fastq.trim.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9ac4` | `sample1/run1/raw/AG8_2_500_2.fastq.trim.paired` | a | none recorded | 1 |
| `5fc012cba3efcb29338b9786` | `sample1/run1/raw/ja4_tgacca_l002_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9af0` | `sample1/run1/raw/ja4_tgacca_l002_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cba3efcb29338b97ea` | `sample1/run1/raw/ja5_acagtg_l002_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9e84` | `sample1/run1/raw/ja5_acagtg_l002_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9a31` | `sample1/run1/raw/ja6_gccaat_l002_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9b1a` | `sample1/run1/raw/ja6_gccaat_l002_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9b4e` | `sample1/run1/raw/jar13z_atcacg_l005_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cca3efcb29338b9e64` | `sample1/run1/raw/jar13z_atcacg_l005_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cba3efcb29338b95f0` | `sample1/run1/raw/jar14z_tgacca_l005_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cba3efcb29338b9773` | `sample1/run1/raw/jar14z_tgacca_l005_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9edc` | `sample1/run1/raw/jar15z_acttga_l005_r1_001.fastq.trimmed.paired` | a | none recorded | 1 |
| `5fc012cda3efcb29338b9f24` | `sample1/run1/raw/jar15z_acttga_l005_r2_001.fastq.trimmed.paired` | a | none recorded | 1 |
