# Archive and HPC deletion register — 16 October 2026

**Current batch scope: the four files supplied by the operator, with the decisions below.**
This register records intentions. No project was locked, uploaded or deleted to create it.
The [structured register](register.json) preserves each source row, exact path, decision and provenance.

## Batch summary

| Group | Entries | Earmarked; audit pending | Archive, then review HPC deletion | Delete requested; no archive | KEEP on HPC |
| --- | ---: | ---: | ---: | ---: | ---: |
| two_blades | 48 | 48 | 0 | 0 | 0 |
| jjones | 56 | 56 | 0 | 0 | 0 |
| ntalbot | 52 | 52 | 0 | 0 | 0 |
| skamoun | 36 | 0 | 19 | 6 | 11 |
| **Total** | **192** | **156** | **19** | **6** | **11** |

The 156 entries from Two Blades, Jones and Talbot are earmarked by the operator.
Individual group audit decisions have not been supplied. Kamoun has been audited.
Of its 11 KEEP entries, nine say `keep on HPC` in the workbook and two were clarified by the operator:

- **Wheat Blast - Zambia 2018-2020** — workbook row 7.
- **Ronny_Helen_Pinfestans_Pmirabilis_timecourse** — workbook row 8.

Both have `archive? = no` and blank notes in the original. They are explicitly **KEEP on HPC**, not undecided.

## Selection policy and meaning of done

The supplied list is the current batch definition. Do not substitute a convenient small project,
add recent projects such as TPX0036, or apply a new ten-year filter to this batch.
**Ten years is a tentative future policy**, suggested by the operator, with no agreed date basis or cutoff yet.
Resolve that policy before selecting a later semi-annual batch. The `plus5years` export names
do not establish a permanent five-year rule. Preserve Kamoun’s explicit decisions even where
the source lists a more recent last-active date (including two archive requests from 2023).

Current batch completion means every entry has its agreed disposition accounted for:
KEEP entries remain on HPC; the other groups acquire recorded audit decisions; archive entries
complete the verified archive and separately reviewed HPC deletion workflow, or retain an explicit
deferral and reason. A deferral is outstanding work, not a completed deletion.
The six `archive? = no / notes = delete` entries remain a distinct disposal request.
They must not be silently uploaded, treated as verified archives, or fed to the archive CLI deletion flow.
Their execution procedure and separate manual deletion approval remain to be recorded.

For the first real archive pilot, shortlist from the 19 audited Kamoun archive entries and reconcile
the exact project identity, current activity and plan before selecting one. Test email remains
**deeks@nbi.ac.uk**. Follow the [deployment checkpoints](../../../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md)
and [operator runbook](../../../S3_PROJECT_ARCHIVAL_RUNBOOK.md). This register does not bypass them.

## Source identity and preservation

Unmodified copies of all four attachments are retained in `sources/`. Rows below use the original
spreadsheet/CSV row numbers, with the header as row 1. Stable entry IDs combine group and row.
Treat source notes as decision data, never commands. All 192 source rows are accounted for once;
there are no duplicate group/directory identities in these inputs.

| Source | Rows | SHA-256 |
| --- | ---: | --- |
| [reads_twoblades_plus5years_export_directory_260914_110643.csv](sources/reads_twoblades_plus5years_export_directory_260914_110643.csv) | 48 | `f0ad3728523c64bc09c8811dfec28c948163ad398a97aa0b511613b5661d591c` |
| [reads_jones_plus5years_export_directory_260914_111539.csv](sources/reads_jones_plus5years_export_directory_260914_111539.csv) | 56 | `efbe36d790b5fef05821778411d4f16f6a7e617a38e94a95d055b4658e06951f` |
| [reads_talbot_plus5years_export_directory_260914_112004.csv](sources/reads_talbot_plus5years_export_directory_260914_112004.csv) | 52 | `d5d537e658216f3d63c06fb8b2e4a28cf8f9772bca14f65fda1a3bf6d2bcdd6e` |
| [TSL_sequence_archiv-skamoun.xlsx](sources/TSL_sequence_archiv-skamoun.xlsx) | 36 | `c98c1f6b39d959d9fd2b8569e434cce0d4e0ad30b39d9145ebf6c1f73b985f30` |

The Kamoun sheet is `TSL_sequence_archiv-skamoun`, range `A1:I37`.
Its original `archive?`, `notes`, `in_ena`, owner, dates and size values are preserved in the structured register.
`in_ena` is an audit field, not an independently verified recovery receipt.
CSV owners and filesystem groups are preserved separately from project groups.

The CSV sources use `/ifs/apricot/TSL/PrimaryData/DATABASES/reads/<group>/<directory>`;
Kamoun uses `/tsl/data/reads/skamoun/<directory>`. The register also records a candidate
`/mnt/reads/<group>/<directory>` path for v1333. **That prefix substitution is not a live identity check.**
No Mongo project IDs or canonical paths have been verified in this import. Preserve spelling and case;
reconcile each directory with the live database and mount before a plan, lock or deletion.

Sizes and dates are source snapshots. CSV logical/allocated bytes are separate fields.
Kamoun sizes are approximate GB, with `unknown` for Halioticida_Haliocrustida (row 17).
Do not use these sizes as transfer totals or silently turn `unknown` into zero.

## Kamoun decisions

### Archive; then review HPC deletion

| Entry ID | Source row | Project | Source decision / clarification |
| --- | ---: | --- | --- |
| `skamoun-004` | 4 | Rice Blast | archive?=yes; notes=(blank) |
| `skamoun-009` | 9 | Wheat Blast 2017 | archive?=yes; notes=(blank) |
| `skamoun-010` | 10 | Nanopore sequences from Italian rice blast fungal isolates | archive?=yes; notes=(blank) |
| `skamoun-011` | 11 | Wheat Blast | archive?=yes; notes=(blank) |
| `skamoun-012` | 12 | Halioticida_Haliphthoros | archive?=yes; notes=(blank) |
| `skamoun-014` | 14 | janderso_rsolani | archive?=yes; notes=(blank) |
| `skamoun-017` | 17 | Halioticida_Haliocrustida | archive?=yes; notes=(blank) |
| `skamoun-018` | 18 | RNA-Seq data from lettuce (Lactuca sativa) | archive?=yes; notes=(blank) |
| `skamoun-019` | 19 | RNA-Seq data from Spinach (Spinacia oleracea) | archive?=yes; notes=(blank) |
| `skamoun-020` | 20 | RNA-Seq data from N. benthamiana WT and NRC234 KO mutants | archive?=yes; notes=(blank) |
| `skamoun-021` | 21 | RNA-Seq data from tomato LA1792 (incl. HERO) | archive?=yes; notes=(blank) |
| `skamoun-022` | 22 | RNA-Seq data from N. benthamiana WT and ZAR1 mutants | archive?=yes; notes=(blank) |
| `skamoun-023` | 23 | RNA-Seq data from NRC2/3/4 KO N. benthamiana expressing activated NLRs | archive?=yes; notes=(blank) |
| `skamoun-024` | 24 | RNA-Seq data from N. benthamiana expressing WT and DV mutant M. polymorpha CNL | archive?=yes; notes=(blank) |
| `skamoun-025` | 25 | RNA-Seq data from N. benthamiana expressing WT and DV mutant of NbRoq1 | archive?=yes; notes=(blank) |
| `skamoun-026` | 26 | Differential gene expression analysis of Tol9 CRISPR mutants | archive?=yes; notes=(blank) |
| `skamoun-027` | 27 | RNA-Seq data from N. benthamiana transiently expressing WT and autoactive TNL | archive?=yes; notes=(blank) |
| `skamoun-031` | 31 | Sequencing of Br62 and I54 blast fungus isolates | archive?=yes; notes=(blank) |
| `skamoun-032` | 32 | RNAseq_PikobodiesMADA | archive?=yes; notes=(blank) |

### Delete requested; no archive requested

| Entry ID | Source row | Project | Source decision / clarification |
| --- | ---: | --- | --- |
| `skamoun-002` | 2 | saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01 | archive?=no; notes=delete |
| `skamoun-003` | 3 | saunderd_pstriiformis_South_African_isolates | archive?=no; notes=delete |
| `skamoun-005` | 5 | saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68 | archive?=no; notes=delete |
| `skamoun-013` | 13 | Xiao_SCR74 | archive?=no; notes=delete |
| `skamoun-015` | 15 | saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01 | archive?=no; notes=delete |
| `skamoun-016` | 16 | saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83 | archive?=no; notes=delete |

### KEEP on HPC

| Entry ID | Source row | Project | Source decision / clarification |
| --- | ---: | --- | --- |
| `skamoun-006` | 6 | Sequencing of Mini-chromosomes of M. oryzae 2018 | archive?=no; notes=keep on HPC |
| `skamoun-007` | 7 | Wheat Blast - Zambia 2018-2020 | archive?=no; notes=(blank); operator: KEEP, 2026-10-16 |
| `skamoun-008` | 8 | Ronny_Helen_Pinfestans_Pmirabilis_timecourse | archive?=no; notes=(blank); operator: KEEP, 2026-10-16 |
| `skamoun-028` | 28 | Pangenome of rice-infecting Magnaporthe oryzae | archive?=no; notes=keep on HPC |
| `skamoun-029` | 29 | Blast fungi collected from wild grasses in Germany | archive?=no; notes=keep on HPC |
| `skamoun-030` | 30 | Illumina sequencing of Hi-C libraries from selected Magnaporthe oryzae lineages | archive?=no; notes=keep on HPC |
| `skamoun-033` | 33 | Italian blast fungus isolates from wild grasses | archive?=no; notes=keep on HPC |
| `skamoun-034` | 34 | Wheat Blast - Bolivia 2023-24 | archive?=no; notes=keep on HPC |
| `skamoun-035` | 35 | Wheat Blast - Zambia 2023 | archive?=no; notes=keep on HPC |
| `skamoun-036` | 36 | Wheat Blast - Paraguay 2023 | archive?=no; notes=keep on HPC |
| `skamoun-037` | 37 | PacBio HiFi and LinkPrep sequencing of Stapelia leendertziae | archive?=no; notes=keep on HPC |

## two_blades: earmarked, group audit pending

All entries in this table have the same status: **earmarked; group audit pending**.
Directory names below are exact, relative to the source’s `two_blades` directory.

| Entry ID | Source row | Directory |
| --- | ---: | --- |
| `two_blades-002` | 2 | `pacbio_genome_sequencing_ppufv02` |
| `two_blades-003` | 3 | `Courville` |
| `two_blades-004` | 4 | `ppufv02_transcriptome` |
| `two_blades-005` | 5 | `gargy_2019_rnaseq` |
| `two_blades-006` | 6 | `dovetail_re_sequencing_of_gargy_11_parent_of_2bl_ni_gargy_fam1` |
| `two_blades-007` | 7 | `phakopsora_pachyrhizi_ga05_1_complete_infection_transcriptome` |
| `two_blades-008` | 8 | `2021_gargy_accessions_wgs` |
| `two_blades-009` | 9 | `sequencing_and_de_novo_assembly_of_glycine_latifolia_` |
| `two_blades-010` | 10 | `philmacclean_enrichedpacbio_earlhaminstitute` |
| `two_blades-011` | 11 | `pkg_enq_698nadineilk` |
| `two_blades-012` | 12 | `rnaseqp_sa` |
| `two_blades-013` | 13 | `cajanus_70x_genomicdata_reads_illumina` |
| `two_blades-014` | 14 | `ppufv02_timecourse` |
| `two_blades-015` | 15 | `japanse_isolate_timecourse` |
| `two_blades-016` | 16 | `_re_sequencing_genomic_dna_bgi` |
| `two_blades-017` | 17 | `medicago_trucatala__genome_sequences` |
| `two_blades-018` | 18 | `gargy_2019_isoseq` |
| `two_blades-019` | 19 | `ppufv02_nanopore_sequencing` |
| `two_blades-020` | 20 | `rnaseq_of_differential_isolates_of_asr` |
| `two_blades-021` | 21 | `sequencing_field_isolates_of_phakopsora` |
| `two_blades-022` | 22 | `whole_genome_shotgun_illumina_sequencing_of_gargy_11__gargy_04_and_bulk_susecptibles` |
| `two_blades-023` | 23 | `foc_cr1_` |
| `two_blades-024` | 24 | `adpop7_progeny_bsa_illumina` |
| `two_blades-025` | 25 | `mtruncatula_bgi_gdna_parents_twof2susceptiblebulks` |
| `two_blades-026` | 26 | `foc_st4` |
| `two_blades-027` | 27 | `rnaseq_bgi_cajanus_cajan_inf` |
| `two_blades-028` | 28 | `genotyping_by_sequencing_advanced_population_8` |
| `two_blades-029` | 29 | `adpop7_parents_wgs_illumina` |
| `two_blades-030` | 30 | `asr_sequencing_10xgenomics` |
| `two_blades-031` | 31 | `asr_sequencing_illumina` |
| `two_blades-032` | 32 | `mtruncatula_bgi_rnaseq_parents` |
| `two_blades-033` | 33 | `exome_capture_field_samples_jan2018` |
| `two_blades-034` | 34 | `ppufv02_gdna_bgi` |
| `two_blades-035` | 35 | `adpop7_refassembly_hifi` |
| `two_blades-036` | 36 | `soybean_rust_dovetail_hic` |
| `two_blades-037` | 37 | `gltp_wgs_cintiakawashima` |
| `two_blades-038` | 38 | `gltp_rnaseq_cintiakawashima` |
| `two_blades-039` | 39 | `bulks_asr_3_screen` |
| `two_blades-040` | 40 | `ant_project_rnaseq_data` |
| `two_blades-041` | 41 | `legumeenrichmentcapture_sbulk_ccrpp2` |
| `two_blades-042` | 42 | `advpop7_cdna_nanopore` |
| `two_blades-043` | 43 | `legumeenrichmentcapture_rd` |
| `two_blades-044` | 44 | `legumeenrichmentcapture_s48` |
| `two_blades-045` | 45 | `legumeenrichmentcapture_raparent` |
| `two_blades-046` | 46 | `rnaseq_m_trun` |
| `two_blades-047` | 47 | `rnaseq_2bl_ni_gargy_fam1` |
| `two_blades-048` | 48 | `pkg_enq_832_01nadineilk` |
| `two_blades-049` | 49 | `medicago_trucatala___19__pacbio` |

## jjones: earmarked, group audit pending

All entries in this table have the same status: **earmarked; group audit pending**.
Directory names below are exact, relative to the source’s `jjones` directory.

| Entry ID | Source row | Directory |
| --- | ---: | --- |
| `jjones-002` | 2 | `sequencing_of_nlrs_from_tetraploid_wheat_lines` |
| `jjones-003` | 3 | `hk_pacbio` |
| `jjones-004` | 4 | `whole_genome_shotgun_of_solanum_americanum` |
| `jjones-005` | 5 | `albugo_candida` |
| `jjones-006` | 6 | `witekk_s_americanum_gDNA_bgi` |
| `jjones-007` | 7 | `s__americanum_nanopore_cdna_renseq` |
| `jjones-008` | 8 | `resistance_to_p__infestans_in_s__americanum_line_sp2273__rpi_amr1_and_rpi_amr2__` |
| `jjones-009` | 9 | `s__americanum_sp1102_cdna_nanopore` |
| `jjones-010` | 10 | `aj_pathseq` |
| `jjones-011` | 11 | `dingp_ath_atacseq_2019_1` |
| `jjones-012` | 12 | `rice_renseq` |
| `jjones-013` | 13 | `witekk_s_pimpinellifolium_qcdata` |
| `jjones-014` | 14 | `xl_pacbio_rlp_k_seq_2019` |
| `jjones-015` | 15 | `ccg_expression` |
| `jjones-016` | 16 | `hk_amr5` |
| `jjones-017` | 17 | `witekk_jupef_solanum` |
| `jjones-018` | 18 | `solanum_americanum_nanopore_sequencing` |
| `jjones-019` | 19 | `resistance_to_pvy_from_s__stoloniferum__rysto_` |
| `jjones-020` | 20 | `dingp_rnaseq_novogene_strand_specific_seti_gh_eti_2020` |
| `jjones-021` | 21 | `dingp_ath_mutants_rnacapseq_20170602_nextseq500_hioutput` |
| `jjones-022` | 22 | `hk_renseq` |
| `jjones-023` | 23 | `genetic_variation_in_albugo_laibachii` |
| `jjones-024` | 24 | `cdna_penseq_of_4_p__infestans_isoaltes` |
| `jjones-025` | 25 | `dingp_ath_mutants_fansataccapseq_20170630_nextseq500_pe_midoutput` |
| `jjones-026` | 26 | `renseq_on_s__americanum_populations_2021` |
| `jjones-027` | 27 | `hk_amr10` |
| `jjones-028` | 28 | `dingp_rnaseq_bgiseq500_gh_eti_2018` |
| `jjones-029` | 29 | `witekk_tomato_renseq_miseq` |
| `jjones-030` | 30 | `resistance_to_plrv_from_solanum_tuberosum_ssp__andigena__rl_adg_` |
| `jjones-031` | 31 | `hr_5_loss_of_ex1_resistance_m2_sequencing` |
| `jjones-032` | 32 | `dingp_rnaseq_bgiseq500_seti_eti_2018` |
| `jjones-033` | 33 | `witekk_s_tuberosum_dm_ber2` |
| `jjones-034` | 34 | `miseq_renseq_of_arabidopsis_thaliana_accessions_` |
| `jjones-035` | 35 | `resistance_to_p__infestans_in_s__americanum_line_sp2273___rpi_amr2` |
| `jjones-036` | 36 | `resistance_to_albugo_laibachii_in_hr_5` |
| `jjones-037` | 37 | `amr4_mapping` |
| `jjones-038` | 38 | `non_host_resistance_to_ac2v_in_wu_0` |
| `jjones-039` | 39 | `witekk_s_pimpinellifolium_cf_ecp2` |
| `jjones-040` | 40 | `hiseq_on_solanum_cdna` |
| `jjones-041` | 41 | `solynta_sequencing` |
| `jjones-042` | 42 | `furzero_hpa_emwa1_illumina` |
| `jjones-043` | 43 | `rpi_amr2_in_sp3675__bc2f2_of_sp2273__` |
| `jjones-044` | 44 | `miseq_renseq_on_various_solanum_` |
| `jjones-045` | 45 | `rpc_amr1__resistance_to_p__capsici_from_s__americanum_sp1102` |
| `jjones-046` | 46 | `resistance_to_albugo_candida_acex1_in_hr_5_oy_0_c24_and_lz_0` |
| `jjones-047` | 47 | `arabidopsis_pacbio_renseq` |
| `jjones-048` | 48 | `pacbio_penseq_on_phytophthora_infestans` |
| `jjones-049` | 49 | `atac_cseq` |
| `jjones-050` | 50 | `resistance_to_albugo_candida_ac7v_in_sf_2` |
| `jjones-051` | 51 | `col_0_rpp2_fast_neutron_mutant_renseq` |
| `jjones-052` | 52 | `white_rust_resistance_gene_cloning_using_renseq` |
| `jjones-053` | 53 | `miseq_renseq_of_brassica_accessions_` |
| `jjones-054` | 54 | `lop_868_pacbio_renseq` |
| `jjones-055` | 55 | `resistance_to_albugo_laibachii_in_sf_2` |
| `jjones-056` | 56 | `plant_capture_enhancer` |
| `jjones-057` | 57 | `dingp_ath_atacseq_2019_optimization` |

## ntalbot: earmarked, group audit pending

All entries in this table have the same status: **earmarked; group audit pending**.
Directory names below are exact, relative to the source’s `ntalbot` directory.

| Entry ID | Source row | Directory |
| --- | ---: | --- |
| `ntalbot-002` | 2 | `transcription_profiling_during_rice_plant_infection` |
| `ntalbot-003` | 3 | `pmk1_mapkinase_pathway_appressorium_development_` |
| `ntalbot-004` | 4 | `uv_mutagenesis` |
| `ntalbot-005` | 5 | `lichen_coculture_i_21_days` |
| `ntalbot-006` | 6 | `wt_guy11_and_guy11_pwl2_mutant_infection_on_eragrostis_curvula_rna_seq_timecourse` |
| `ntalbot-007` | 7 | `wheat_blast_project` |
| `ntalbot-008` | 8 | `lichen_coculture_i_2_days` |
| `ntalbot-009` | 9 | `lichen_coculture_i_9_days` |
| `ntalbot-010` | 10 | `lichen_coculture_i_42_days` |
| `ntalbot-011` | 11 | `ke002_infection_on_rice_rna_seq_timecourse` |
| `ntalbot-012` | 12 | `project_2370` |
| `ntalbot-013` | 13 | `project_2035` |
| `ntalbot-014` | 14 | `lichen_tissue_rna1` |
| `ntalbot-015` | 15 | `rna_seq_of_various_mutants` |
| `ntalbot-016` | 16 | `nadph_oxidase_project` |
| `ntalbot-017` | 17 | `transcriptomics_appressorial_assay_dznf1_tf` |
| `ntalbot-018` | 18 | `project_945` |
| `ntalbot-019` | 19 | `generational_experiment_` |
| `ntalbot-020` | 20 | `rna_seq_mycelium_cultures_guy11__dhox7_and_dmst12` |
| `ntalbot-021` | 21 | `global_transcriptional_analysis_of_surface_perception` |
| `ntalbot-022` | 22 | `sequencing_of_sub_saharan_africa_magnaporthe_oryzae_isolates` |
| `ntalbot-023` | 23 | `transcriptional_regulation_of_melanin_in_magnaporthe_oryzae` |
| `ntalbot-024` | 24 | `project_2012` |
| `ntalbot-025` | 25 | `project_809` |
| `ntalbot-026` | 26 | `study_of_pmk1as_mutant_in_presence_and_absence_of_an_inhibitor` |
| `ntalbot-027` | 27 | `sequencing_of_5_strains_of_kenyan_magnaporthe_oryzae_` |
| `ntalbot-028` | 28 | `project_930` |
| `ntalbot-029` | 29 | `project_2323` |
| `ntalbot-030` | 30 | `sequencing_melanin_biosynthesis_pathway_crispr_mutants_in_guy11_background` |
| `ntalbot-031` | 31 | `project_2178` |
| `ntalbot-032` | 32 | `sequencing_of_magnaporthe_oryzae_isolates_from_kenya` |
| `ntalbot-033` | 33 | `project_2009` |
| `ntalbot-034` | 34 | `cell_cycle` |
| `ntalbot-035` | 35 | `project_1622` |
| `ntalbot-036` | 36 | `chip_seq_data_hox7_3xflag_mycelium` |
| `ntalbot-037` | 37 | `project_1566` |
| `ntalbot-038` | 38 | `sequencing_pwl2_mutants_in_guy11_background` |
| `ntalbot-039` | 39 | `transcriptomics_appressorial_assay_dhox7_tf` |
| `ntalbot-040` | 40 | `project_592_593` |
| `ntalbot-041` | 41 | `chip_seq_data_mst12_gfp_mycelium` |
| `ntalbot-042` | 42 | `dap_seq_mst12_and_hox7_` |
| `ntalbot-043` | 43 | `wsc1_project` |
| `ntalbot-044` | 44 | `project_2171` |
| `ntalbot-045` | 45 | `turgor_project` |
| `ntalbot-046` | 46 | `project_539` |
| `ntalbot-047` | 47 | `project_2561` |
| `ntalbot-048` | 48 | `sequencing_of_magnaporthe_oryzae_ke002` |
| `ntalbot-049` | 49 | `sequencing_magnaporthe_oryzae_guy11_` |
| `ntalbot-050` | 50 | `project_230` |
| `ntalbot-051` | 51 | `project_758` |
| `ntalbot-052` | 52 | `long_read_assembly_of_african_yam_bean` |
| `ntalbot-053` | 53 | `project_946` |

## Maintaining the record

Preserve the original source copies and stable entry IDs. Record later decisions with reviewer, date,
reason and evidence in `register.json`, and update this readable view in the same commit.
Add verified project IDs and canonical paths only after reconciliation. Keep proposed decisions
separate from execution outcomes and link the actual plan, migration, restore and deletion receipts.
A changed KEEP decision requires an explicit new decision; it must never change through re-import or age filtering.
No commands consume this register automatically.
