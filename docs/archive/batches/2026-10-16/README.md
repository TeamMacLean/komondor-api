# Project decisions and production findings — 16 October 2026

[Completed blocker-resolution review](BLOCKER_RESOLUTION_REVIEW_2026-10-17.md) records the verdict, commits and validation caveats.

**192 original source entries, each retained exactly once.** Decisions and technical findings are separate.
No real project has been archived or deleted by this reconciliation. No owners have been contacted.

Use the [filterable decision CSV](../../../hpc-archive-candidates-2026-10-16.csv) for follow-up,
the [structured register](register.json) for exact source paths and evidence, and
the [findings report](../../../HPC_ARCHIVE_CANDIDATES_2026-10-16.md) for discrepancies and handling limits.

## Current execution decisions supersede the historical labels below

Use [ACTION_PLAN.md](ACTION_PLAN.md) and [action-plan.csv](action-plan.csv) for the
current proposed actions. George's settled silence-consent decision supersedes
`AWAITING_GROUP_DECISION` for the three exports (156 entries); only discrepancies
receive outreach with a deadline. No age cutoff applies to this batch. Kamoun's
19 archive / 6 direct-delete / 11 KEEP decisions stand. Manual deletion remains a
separate checkpoint and nothing is deleted on silence.

This README and `register.json` retain original entries, source decisions and the
October 16 observations as history. The action plan supersedes their old waiting/
age labels and path-repair assumptions; it does not supersede exact source identity,
KEEP decisions, the independent production findings or later evidence. Read the
linked resolution and cleanup records before acting. A historical missing-path
finding remains evidence even when a later hash comparison resolves its handling.

## Historical imported decisions

| Group | Original entries | Awaiting group decision | Archive requested | Delete without archive requested | KEEP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Two Blades | 48 | 48 | 0 | 0 | 0 |
| Jones | 56 | 56 | 0 | 0 | 0 |
| Talbot | 52 | 52 | 0 | 0 | 0 |
| Kamoun | 36 | 0 | 19 | 6 | 11 |
| **Total** | **192** | **156** | **19** | **6** | **11** |

**Wheat Blast - Zambia 2018-2020** and **Ronny_Helen_Pinfestans_Pmirabilis_timecourse** remain KEEP,
as explicitly clarified by the operator. The other nine KEEP decisions come from the workbook.

The original supplied list defines this batch. **Ten years remains a tentative future policy**;
no date basis or cutoff has been agreed. The imported `ARCHIVE_ELIGIBLE_10Y`, `NEAR_10Y_REVIEW`,
`NOT_YET` and `EMPTY_DIR_CLEANUP` classifications are preserved as superseded history in JSON,
not applied as owner decisions. An empty directory is a technical finding, not disposal permission.

## October 17 content-resolution evidence

[PATH_RESOLUTIONS.md](PATH_RESOLUTIONS.md) and [path-resolutions.json](path-resolutions.json)
record the eight-project, 110-path content review and explicitly identify any holds.
They supersede size-only relocation suggestions. The October 16 findings below remain
historical metadata observations, not checksum evidence. Nothing was moved or deleted.

## What the production review establishes

The independent read-only inspection finished at **2026-10-16T20:31:11.362Z** on `v1333` as `deeks`.
It used the reviewed shortlist verifier with production master’s preflight/inventory helpers.
Registered IDs, exact path spellings, file counts and current bytes supersede earlier assumptions
and size estimates. Original source values remain preserved. File contents were not hashed,
and this inspection does not establish archive readiness, byte equivalence, restore success or permission to delete.

The five empty registered Saunders projects each have a related mixed-case unregistered directory.
Their association needs owner confirmation before any disposal. The Jones case mismatch also remains explicit.
No path has been renamed and no database record repaired. Unregistered directories cannot be archived by the CLI.

The detailed CSV separates owner questions from technical follow-up. Contact emails are recorded
from the database or supplied owner field; they have not been confirmed as current responsibility.
Where absent, contact the group administrator rather than inventing an address. Test notifications remain
**deeks@nbi.ac.uk**. Do not send outreach automatically.

## Source preservation

Unchanged originals are in `sources/`. Header row is 1; stable entry IDs use group and original row number.
The JSON preserves each source value and the original decision separately from later observations.

| Source | Data rows | SHA-256 |
| --- | ---: | --- |
| [reads_twoblades_plus5years_export_directory_260914_110643.csv](sources/reads_twoblades_plus5years_export_directory_260914_110643.csv) | 48 | `f0ad3728523c64bc09c8811dfec28c948163ad398a97aa0b511613b5661d591c` |
| [reads_jones_plus5years_export_directory_260914_111539.csv](sources/reads_jones_plus5years_export_directory_260914_111539.csv) | 56 | `efbe36d790b5fef05821778411d4f16f6a7e617a38e94a95d055b4658e06951f` |
| [reads_talbot_plus5years_export_directory_260914_112004.csv](sources/reads_talbot_plus5years_export_directory_260914_112004.csv) | 52 | `d5d537e658216f3d63c06fb8b2e4a28cf8f9772bca14f65fda1a3bf6d2bcdd6e` |
| [TSL_sequence_archiv-skamoun.xlsx](sources/TSL_sequence_archiv-skamoun.xlsx) | 36 | `c98c1f6b39d959d9fd2b8569e434cce0d4e0ad30b39d9145ebf6c1f73b985f30` |

## Historical source decision table

Each row below corresponds to one original entry. Imported waiting labels below are
superseded by [the current action CSV](action-plan.csv); use that CSV for execution
and discrepancy outreach. “Archive requested” still requires the normal
plan, freeze, checksum verification, restore/review and separate manual deletion checkpoints.
KEEP entries remain on HPC. Outstanding owner decisions, identity repairs and deferrals remain unfinished work.
See CSV/JSON for full paths, separate registered/observed counts, detailed questions and evidence.

### two_blades

| Entry / source row | Project | Owner / contact | Decision | Production finding |
| --- | --- | --- | --- | --- |
| `two_blades-002` / 2 | pacbio_genome_sequencing_ppufv02 | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-003` / 3 | Courville | shrestha | Awaiting group decision | Directory has no project record |
| `two_blades-004` / 4 | ppufv02_transcriptome | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-005` / 5 | gargy_2019_rnaseq | romeroc; cynara.romero@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `two_blades-006` / 6 | dovetail_re_sequencing_of_gargy_11_parent_of_2bl_ni_gargy_fam1 | ilkn | Awaiting group decision | Additional files absent from database |
| `two_blades-007` / 7 | phakopsora_pachyrhizi_ga05_1_complete_infection_transcriptome | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-008` / 8 | 2021_gargy_accessions_wgs | romeroc; cynara.romero@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-009` / 9 | sequencing_and_de_novo_assembly_of_glycine_latifolia_ | kawashic | Awaiting group decision | Additional files absent from database |
| `two_blades-010` / 10 | philmacclean_enrichedpacbio_earlhaminstitute | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-011` / 11 | pkg_enq_698nadineilk | rigneyb | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-012` / 12 | rnaseqp_sa | rigneyb | Awaiting group decision | Files present; no file records |
| `two_blades-013` / 13 | cajanus_70x_genomicdata_reads_illumina | kawashic | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-014` / 14 | ppufv02_timecourse | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-015` / 15 | japanse_isolate_timecourse | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Registered file paths missing |
| `two_blades-016` / 16 | _re_sequencing_genomic_dna_bgi | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-017` / 17 | medicago_trucatala__genome_sequences | peter.vanesse@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-018` / 18 | gargy_2019_isoseq | romeroc; cynara.romero@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `two_blades-019` / 19 | ppufv02_nanopore_sequencing | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-020` / 20 | rnaseq_of_differential_isolates_of_asr | Harun.Murithi@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-021` / 21 | sequencing_field_isolates_of_phakopsora | peter.vanesse@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-022` / 22 | whole_genome_shotgun_illumina_sequencing_of_gargy_11__gargy_04_and_bulk_susecptibles | ilkn | Awaiting group decision | Additional files absent from database |
| `two_blades-023` / 23 | foc_cr1_ | sarah.schmidt@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-024` / 24 | adpop7_progeny_bsa_illumina | strachan; shona.strachan@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-025` / 25 | mtruncatula_bgi_gdna_parents_twof2susceptiblebulks | kawashic | Awaiting group decision | Additional files absent from database |
| `two_blades-026` / 26 | foc_st4 | sarah.schmidt@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `two_blades-027` / 27 | rnaseq_bgi_cajanus_cajan_inf | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-028` / 28 | genotyping_by_sequencing_advanced_population_8 | romeroc; cynara.romero@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-029` / 29 | adpop7_parents_wgs_illumina | strachan; shona.strachan@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-030` / 30 | asr_sequencing_10xgenomics | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `two_blades-031` / 31 | asr_sequencing_illumina | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `two_blades-032` / 32 | mtruncatula_bgi_rnaseq_parents | kawashic | Awaiting group decision | Additional files absent from database |
| `two_blades-033` / 33 | exome_capture_field_samples_jan2018 | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `two_blades-034` / 34 | ppufv02_gdna_bgi | vanessep | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-035` / 35 | adpop7_refassembly_hifi | strachan; shona.strachan@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-036` / 36 | soybean_rust_dovetail_hic | guptay; yogesh.gupta@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-037` / 37 | gltp_wgs_cintiakawashima | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-038` / 38 | gltp_rnaseq_cintiakawashima | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-039` / 39 | bulks_asr_3_screen | rigneyb | Awaiting group decision | Additional files absent from database |
| `two_blades-040` / 40 | ant_project_rnaseq_data | navarrim; marion.navarri@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-041` / 41 | legumeenrichmentcapture_sbulk_ccrpp2 | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-042` / 42 | advpop7_cdna_nanopore | strachan; shona.strachan@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-043` / 43 | legumeenrichmentcapture_rd | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-044` / 44 | legumeenrichmentcapture_s48 | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-045` / 45 | legumeenrichmentcapture_raparent | kawashic | Awaiting group decision | Files present; no file records |
| `two_blades-046` / 46 | rnaseq_m_trun | rigneyb | Awaiting group decision | Checksum/metadata anomalies need review |
| `two_blades-047` / 47 | rnaseq_2bl_ni_gargy_fam1 | ilkn | Awaiting group decision | Additional files absent from database |
| `two_blades-048` / 48 | pkg_enq_832_01nadineilk | ilkn | Awaiting group decision | Files present; no file records |
| `two_blades-049` / 49 | medicago_trucatala___19__pacbio | tsldata | Awaiting group decision | No project record; no regular files |

### jjones

| Entry / source row | Project | Owner / contact | Decision | Production finding |
| --- | --- | --- | --- | --- |
| `jjones-002` / 2 | sequencing_of_nlrs_from_tetraploid_wheat_lines | jonesj | Awaiting group decision | Files present; no file records |
| `jjones-003` / 3 | hk_pacbio | Hari.Karki@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-004` / 4 | whole_genome_shotgun_of_solanum_americanum | jonesj | Awaiting group decision | Registered file paths missing |
| `jjones-005` / 5 | albugo_candida | jonesj | Awaiting group decision | Registered file paths missing |
| `jjones-006` / 6 | witekk_s_americanum_gDNA_bgi | jonesj | Awaiting group decision | Directory and database differ in letter case |
| `jjones-007` / 7 | s__americanum_nanopore_cdna_renseq | linx; xiao.lin@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-008` / 8 | resistance_to_p__infestans_in_s__americanum_line_sp2273__rpi_amr1_and_rpi_amr2__ | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Registered file paths missing |
| `jjones-009` / 9 | s__americanum_sp1102_cdna_nanopore | linx; xiao.lin@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-010` / 10 | aj_pathseq | Agathe.Jouet@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-011` / 11 | dingp_ath_atacseq_2019_1 | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-012` / 12 | rice_renseq | Agathe.Jouet@sainsbury-laboratory.ac.uk | Awaiting group decision | Registered file paths missing |
| `jjones-013` / 13 | witekk_s_pimpinellifolium_qcdata | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-014` / 14 | xl_pacbio_rlp_k_seq_2019 | linx; xiao.lin@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `jjones-015` / 15 | ccg_expression | jonesj | Awaiting group decision | Files present; no file records |
| `jjones-016` / 16 | hk_amr5 | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-017` / 17 | witekk_jupef_solanum | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-018` / 18 | solanum_americanum_nanopore_sequencing | fairheas; sebastian.fairhead@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `jjones-019` / 19 | resistance_to_pvy_from_s__stoloniferum__rysto_ | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-020` / 20 | dingp_rnaseq_novogene_strand_specific_seti_gh_eti_2020 | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-021` / 21 | dingp_ath_mutants_rnacapseq_20170602_nextseq500_hioutput | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-022` / 22 | hk_renseq | Hari.Karki@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-023` / 23 | genetic_variation_in_albugo_laibachii | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Files present; no file records |
| `jjones-024` / 24 | cdna_penseq_of_4_p__infestans_isoaltes | linx; xiao.lin@tsl.ac.uk | Awaiting group decision | Metadata matches; full plan still needed |
| `jjones-025` / 25 | dingp_ath_mutants_fansataccapseq_20170630_nextseq500_pe_midoutput | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-026` / 26 | renseq_on_s__americanum_populations_2021 | fairheas; sebastian.fairhead@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-027` / 27 | hk_amr10 | Hari.Karki@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-028` / 28 | dingp_rnaseq_bgiseq500_gh_eti_2018 | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-029` / 29 | witekk_tomato_renseq_miseq | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-030` / 30 | resistance_to_plrv_from_solanum_tuberosum_ssp__andigena__rl_adg_ | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-031` / 31 | hr_5_loss_of_ex1_resistance_m2_sequencing | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-032` / 32 | dingp_rnaseq_bgiseq500_seti_eti_2018 | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-033` / 33 | witekk_s_tuberosum_dm_ber2 | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-034` / 34 | miseq_renseq_of_arabidopsis_thaliana_accessions_ | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-035` / 35 | resistance_to_p__infestans_in_s__americanum_line_sp2273___rpi_amr2 | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-036` / 36 | resistance_to_albugo_laibachii_in_hr_5 | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-037` / 37 | amr4_mapping | fairheas; sebastian.fairhead@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-038` / 38 | non_host_resistance_to_ac2v_in_wu_0 | fairheas; sebastian.fairhead@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `jjones-039` / 39 | witekk_s_pimpinellifolium_cf_ecp2 | jonesj | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-040` / 40 | hiseq_on_solanum_cdna | heal; robert.heal@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-041` / 41 | solynta_sequencing | jonesj | Awaiting group decision | Registered file paths missing |
| `jjones-042` / 42 | furzero_hpa_emwa1_illumina | jonesj | Awaiting group decision | Files present; no file records |
| `jjones-043` / 43 | rpi_amr2_in_sp3675__bc2f2_of_sp2273__ | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-044` / 44 | miseq_renseq_on_various_solanum_ | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-045` / 45 | rpc_amr1__resistance_to_p__capsici_from_s__americanum_sp1102 | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-046` / 46 | resistance_to_albugo_candida_acex1_in_hr_5_oy_0_c24_and_lz_0 | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-047` / 47 | arabidopsis_pacbio_renseq | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Registered file paths missing |
| `jjones-048` / 48 | pacbio_penseq_on_phytophthora_infestans | fairheas; sebastian.fairhead@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `jjones-049` / 49 | atac_cseq | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-050` / 50 | resistance_to_albugo_candida_ac7v_in_sf_2 | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-051` / 51 | col_0_rpp2_fast_neutron_mutant_renseq | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-052` / 52 | white_rust_resistance_gene_cloning_using_renseq | jonesj | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-053` / 53 | miseq_renseq_of_brassica_accessions_ | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-054` / 54 | lop_868_pacbio_renseq | jonesj | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-055` / 55 | resistance_to_albugo_laibachii_in_sf_2 | Oliver.Furzer@sainsbury-laboratory.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-056` / 56 | plant_capture_enhancer | witekk; kamil.witek@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `jjones-057` / 57 | dingp_ath_atacseq_2019_optimization | dingp; pingtao.ding@tsl.ac.uk | Awaiting group decision | No regular files observed |

### ntalbot

| Entry / source row | Project | Owner / contact | Decision | Production finding |
| --- | --- | --- | --- | --- |
| `ntalbot-002` / 2 | transcription_profiling_during_rice_plant_infection | yan; xia.yan@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-003` / 3 | pmk1_mapkinase_pathway_appressorium_development_ | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-004` / 4 | uv_mutagenesis | tangb; bozeng.tang@tsl.ac.uk | Awaiting group decision | Additional files absent from database |
| `ntalbot-005` / 5 | lichen_coculture_i_21_days | scharnag; klara.scharnagl@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-006` / 6 | wt_guy11_and_guy11_pwl2_mutant_infection_on_eragrostis_curvula_rna_seq_timecourse | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-007` / 7 | wheat_blast_project | ryderl | Awaiting group decision | Files present; no file records |
| `ntalbot-008` / 8 | lichen_coculture_i_2_days | scharnag; klara.scharnagl@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-009` / 9 | lichen_coculture_i_9_days | scharnag; klara.scharnagl@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-010` / 10 | lichen_coculture_i_42_days | scharnag; klara.scharnagl@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-011` / 11 | ke002_infection_on_rice_rna_seq_timecourse | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-012` / 12 | project_2370 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-013` / 13 | project_2035 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-014` / 14 | lichen_tissue_rna1 | talbotn | Awaiting group decision | Additional files absent from database |
| `ntalbot-015` / 15 | rna_seq_of_various_mutants | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-016` / 16 | nadph_oxidase_project | ryderl | Awaiting group decision | Files present; no file records |
| `ntalbot-017` / 17 | transcriptomics_appressorial_assay_dznf1_tf | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-018` / 18 | project_945 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-019` / 19 | generational_experiment_ | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-020` / 20 | rna_seq_mycelium_cultures_guy11__dhox7_and_dmst12 | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-021` / 21 | global_transcriptional_analysis_of_surface_perception | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-022` / 22 | sequencing_of_sub_saharan_africa_magnaporthe_oryzae_isolates | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-023` / 23 | transcriptional_regulation_of_melanin_in_magnaporthe_oryzae | talbotn | Awaiting group decision | Additional files absent from database |
| `ntalbot-024` / 24 | project_2012 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-025` / 25 | project_809 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-026` / 26 | study_of_pmk1as_mutant_in_presence_and_absence_of_an_inhibitor | talbotn | Awaiting group decision | Files present; no file records |
| `ntalbot-027` / 27 | sequencing_of_5_strains_of_kenyan_magnaporthe_oryzae_ | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-028` / 28 | project_930 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-029` / 29 | project_2323 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-030` / 30 | sequencing_melanin_biosynthesis_pathway_crispr_mutants_in_guy11_background | fostera | Awaiting group decision | Files present; no file records |
| `ntalbot-031` / 31 | project_2178 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-032` / 32 | sequencing_of_magnaporthe_oryzae_isolates_from_kenya | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-033` / 33 | project_2009 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-034` / 34 | cell_cycle | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-035` / 35 | project_1622 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-036` / 36 | chip_seq_data_hox7_3xflag_mycelium | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-037` / 37 | project_1566 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-038` / 38 | sequencing_pwl2_mutants_in_guy11_background | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-039` / 39 | transcriptomics_appressorial_assay_dhox7_tf | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-040` / 40 | project_592_593 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-041` / 41 | chip_seq_data_mst12_gfp_mycelium | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-042` / 42 | dap_seq_mst12_and_hox7_ | osesrum; miriam.oses-ruiz@tsl.ac.uk | Awaiting group decision | Checksum/metadata anomalies need review |
| `ntalbot-043` / 43 | wsc1_project | ryderl | Awaiting group decision | Files present; no file records |
| `ntalbot-044` / 44 | project_2171 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-045` / 45 | turgor_project | ryderl | Awaiting group decision | Files present; no file records |
| `ntalbot-046` / 46 | project_539 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-047` / 47 | project_2561 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-048` / 48 | sequencing_of_magnaporthe_oryzae_ke002 | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-049` / 49 | sequencing_magnaporthe_oryzae_guy11_ | werev; vincent.were@tsl.ac.uk | Awaiting group decision | Files present; no file records |
| `ntalbot-050` / 50 | project_230 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-051` / 51 | project_758 | tsldata | Awaiting group decision | Directory has no project record |
| `ntalbot-052` / 52 | long_read_assembly_of_african_yam_bean | talbotn | Awaiting group decision | No regular files observed |
| `ntalbot-053` / 53 | project_946 | tsldata | Awaiting group decision | No project record; no regular files |

### skamoun

| Entry / source row | Project | Owner / contact | Decision | Production finding |
| --- | --- | --- | --- | --- |
| `skamoun-002` / 2 | saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01 | winj; joe.win@tsl.ac.uk | Delete without archive requested | Empty registered root; related data in another directory |
| `skamoun-003` / 3 | saunderd_pstriiformis_South_African_isolates | winj; joe.win@tsl.ac.uk | Delete without archive requested | Empty registered root; related data in another directory |
| `skamoun-004` / 4 | Rice Blast | Emilie.Chanclud@sainsbury-laboratory.ac.uk | Archive requested | Files present; no file records |
| `skamoun-005` / 5 | saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68 | winj; joe.win@tsl.ac.uk | Delete without archive requested | Empty registered root; related data in another directory |
| `skamoun-006` / 6 | Sequencing of Mini-chromosomes of M. oryzae 2018 | langnert | KEEP | Checksum/metadata anomalies need review |
| `skamoun-007` / 7 | Wheat Blast - Zambia 2018-2020 | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-008` / 8 | Ronny_Helen_Pinfestans_Pmirabilis_timecourse | Helen.Pennington@sainsbury-laboratory.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-009` / 9 | Wheat Blast 2017 | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-010` / 10 | Nanopore sequences from Italian rice blast fungal isolates | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-011` / 11 | Wheat Blast | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-012` / 12 | Halioticida_Haliphthoros | Helen.Pennington@sainsbury-laboratory.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-013` / 13 | Xiao_SCR74 | Helen.Pennington@sainsbury-laboratory.ac.uk | Delete without archive requested | Checksum/metadata anomalies need review |
| `skamoun-014` / 14 | janderso_rsolani | winj; joe.win@tsl.ac.uk | Archive requested | Registered file paths missing |
| `skamoun-015` / 15 | saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01 | winj; joe.win@tsl.ac.uk | Delete without archive requested | Empty registered root; related data in another directory |
| `skamoun-016` / 16 | saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83 | winj; joe.win@tsl.ac.uk | Delete without archive requested | Empty registered root; related data in another directory |
| `skamoun-017` / 17 | Halioticida_Haliocrustida | Helen.Pennington@sainsbury-laboratory.ac.uk | Archive requested | Additional files absent from database |
| `skamoun-018` / 18 | RNA-Seq data from lettuce (Lactuca sativa) | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-019` / 19 | RNA-Seq data from Spinach (Spinacia oleracea) | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-020` / 20 | RNA-Seq data from N. benthamiana WT and NRC234 KO mutants | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-021` / 21 | RNA-Seq data from tomato LA1792 (incl. HERO) | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-022` / 22 | RNA-Seq data from N. benthamiana WT and ZAR1 mutants | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-023` / 23 | RNA-Seq data from NRC2/3/4 KO N. benthamiana expressing activated NLRs | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-024` / 24 | RNA-Seq data from N. benthamiana expressing WT and DV mutant M. polymorpha CNL | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-025` / 25 | RNA-Seq data from N. benthamiana expressing WT and DV mutant of NbRoq1 | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-026` / 26 | Differential gene expression analysis of Tol9 CRISPR mutants | barragan; cristina.barragan@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-027` / 27 | RNA-Seq data from N. benthamiana transiently expressing WT and autoactive TNL | winj; joe.win@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-028` / 28 | Pangenome of rice-infecting Magnaporthe oryzae | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-029` / 29 | Blast fungi collected from wild grasses in Germany | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-030` / 30 | Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-031` / 31 | Sequencing of Br62 and I54 blast fungus isolates | barragan; cristina.barragan@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-032` / 32 | RNAseq_PikobodiesMADA | bon23vap; jose.salguero-linares@tsl.ac.uk | Archive requested | Checksum/metadata anomalies need review |
| `skamoun-033` / 33 | Italian blast fungus isolates from wild grasses | barragan; cristina.barragan@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-034` / 34 | Wheat Blast - Bolivia 2023-24 | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-035` / 35 | Wheat Blast - Zambia 2023 | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-036` / 36 | Wheat Blast - Paraguay 2023 | winj; joe.win@tsl.ac.uk | KEEP | Checksum/metadata anomalies need review |
| `skamoun-037` / 37 | PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | sugihara; yu.sugihara@tsl.ac.uk | KEEP | Metadata matches; full plan still needed |

## Updating this register

Keep source copies and entry IDs immutable. Record decisions with reviewer, date, scope and reason;
update JSON, CSV and this readable table together. Preserve KEEP until explicitly changed.
Add execution evidence only after actual operations. No archive command automatically consumes this register.
