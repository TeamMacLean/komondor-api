# Project naming review — 26 November 2026

**Partially executed on 26 November at 17:35 UTC: 14 titles, 15 short descriptions and nine long descriptions updated. Seven Projects remain deferred.** [Execution and verification](batches/2026-11-26/project-wording/README.md). The proposals below preserve the reviewed before/after wording; current names for completed entries are in the execution receipt. Stored paths and files were unchanged.

The first pass covers the 22 Projects registered during the October archive reconciliation: 16 Talbot numbered directories, Courville and five extra Saunders directories. Their descriptions are administrative placeholders, confirmed by the 26 November live read. The proposed wording below uses retained scientific notes where available and keeps old project numbers in descriptions/history and stored paths. George requested omitting the parenthetical project numbers from display titles; distinguishing batch identifiers remain in the Saunders proposals.

Nine proposals have strong supporting notes; two more have useful but incomplete note evidence. Three are tentative filename-based suggestions. Two numbered Projects need more information. The five Saunders proposals reformat existing labels, and Courville keeps its name.

## Evidence and freshness

- Actual Project names and descriptions come from the 362-record MongoDB backup taken **23 October 2026, 10:14:18–10:14:20 UTC**. They are not names inferred from the earlier preview.
- The backup file is `~/.codex/artifacts/archive-batch-20261023/backup-paused-r2/projects.bson`; SHA-256: `08951145de250c0ffc3f51c1d8c0eb6147b24b77c91d357549c34ac14c833868`. Its companion manifest records the same digest.
- Scientific evidence comes from the [22 October extracted notes](batches/2026-10-16/reconciliation-preview-2026-10-22/live-evidence/ownership-notes.json) and [file inventory](batches/2026-10-16/reconciliation-preview-2026-10-22/live-files.jsonl). The [structured shortlist](evidence/project-name-review-20261126/candidates.json) preserves all 22 identities, previous wording, proposed wording, source paths/hashes and uncertainties.
- After access was restored, a read-only query succeeded on **26 November 2026 at 16:14:18 UTC**. All **371 live Project names** were checked. All 22 candidate names, short/long descriptions, safe names and paths match the saved catalogue. [Live check receipt](evidence/project-name-review-20261126/live-name-check-20261126T161418Z.json).
- The revised proposals are distinct and have no exact or punctuation/case-normalized collision with the other 349 live Project names. This does not prove scientific distinctness. Recheck immediately before a later write.

## Style taken from existing metadata

Existing examples include “Wheat Blast - Zambia 2023”, “RNA-Seq data from N. benthamiana WT and NRC234 KO mutants”, and “Study of pmk1AS mutant in presence and absence of an inhibitor”. Their short descriptions identify the material or comparison; their long descriptions explain the experiment. The proposals follow that pattern: a concise subject and assay, a factual one-sentence summary, and a longer account only where the notes support it.

Keep historical numbers in descriptions/history rather than parenthetical title suffixes, as George requested on 26 November. Preserve scientific letter case. Do not infer an organism, treatment, original scientist or study purpose from a custodian account. Administrative provenance should remain in the audit record; it should not stand in for a scientific description.

## Proposed titles and short descriptions

“Strong notes” and “Review notes” describe the evidence supporting the draft, not authorisation to write. Filename-based wording needs confirmation. The two “Hold” titles are neutral fallbacks; leave their current names unchanged until the missing context is checked.

| Current name / identifier | Proposed title | Proposed short description | Evidence |
| --- | --- | --- | --- |
| `Courville` | Courville | Infection RNA-seq data stored under the Courville project label. | Keep name |
| `project_2370` | LacO insertion-site analysis | Mapping of LacO insertion sites, with GFP–LacI–NLS construct information. | Review notes |
| `project_2035` | PKC1 inhibition RNA-seq | RNA-seq of M. oryzae pkc1AS mycelium with and without the inhibitor 1NA-PP1. | Strong notes |
| `project_945` | Wheat blast isolate sequencing | Sequence alignments and assemblies from wheat blast isolates. | Review notes |
| `project_2012` | Project 2012 | Sequence assemblies, read alignments and predicted protein/transcript files for multiple strain labels. | Hold |
| `project_809` | Smo1 mutant and progeny sequencing | Sequence analysis of the Smo1 mutant parent and wild-type and mutant progeny bulks from a cross with TH3. | Strong notes |
| `project_930` | Wheat blast isolate sequence analysis | Wheat blast isolate sequence analysis, with assembly statistics and gene-prediction outputs. | Strong notes |
| `project_2323` | pmk1AS leaf-sheath infection RNA-seq | RNA-seq of leaf sheaths infected with pmk1AS mutants, with and without the inhibitor 1NA-PP1. | Strong notes |
| `project_2009` | Smo1 bulk segregant analysis | Smo1 mapping and candidate-variant analysis using bulk segregant analysis and linked markers. | Strong notes |
| `project_1622` | Nim1 mutant and revertant sequencing | Sequence comparison of Nim1 mutants and revertants against the 70-15 reference genome. | Strong notes |
| `project_1566` | Project 1566 | A read alignment labelled MG bulk; the study identity is unconfirmed. | Hold |
| `project_592_593` | Buf mutant bulk segregant analysis | Read alignments and a report labelled as bulk segregant analysis of the Buf mutant. | Filename only |
| `project_2171` | Guy11 paired-end read alignment | A paired-end read alignment labelled Guy11_v3. | Filename only |
| `project_539` | Guy11 36-base paired-end genome sequencing | Guy11 paired-end sequencing and alignment summary against the version 6 reference genome. | Strong notes |
| `project_2561` | Lichen genome annotation | Lichen assemblies and gene prediction, including Cladonia portentosa and Xanthoria parietina. | Strong notes |
| `project_230` | Mycelium RNA-seq expression tables | Expression tables labelled M. oryzae mycelium and Guy11 CM/GMM. | Filename only |
| `project_758` | M. oryzae T-DNA insertion-site analysis | Analysis of T-DNA insertion sites using pCAMBgfp border sequences in an M. oryzae insertional mutant library. | Strong notes |
| skamoun-extra-001 — `Project_TCS_ClareLewis_JIC.CL.20130409.01` | P. striiformis TCS (JIC.CL.20130409.01) | P. striiformis files labelled Clare Lewis, TCS and JIC.CL.20130409.01. | Existing labels |
| skamoun-extra-002 — `TCS_DianeSaunders_TSL.DS.20130809.01_113` | P. striiformis TCS (TSL.DS.20130809.01, 113) | P. striiformis files labelled Diane Saunders, TCS and TSL.DS.20130809.01, with identifier 113. | Existing labels |
| skamoun-extra-003 — `TSL.DS.20130722.01_TCS_99` | P. striiformis TCS 99 (TSL.DS.20130722.01) | P. striiformis files labelled TCS 99 and TSL.DS.20130722.01. | Existing labels |
| skamoun-extra-004 — `TSL.DS.20130730.01_TCS_105` | P. striiformis TCS 105 (TSL.DS.20130730.01) | P. striiformis files labelled TCS 105 and TSL.DS.20130730.01. | Existing labels |
| skamoun-extra-005 — `TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144` | P. striiformis TCS 144 (TSL.DS.20131010.01rev2) | P. striiformis files labelled TCS 144, TSL.DS.20131010.01rev2 and 1x Rapid Lane. | Existing labels |

## Similarity review after live access was restored

No exact title conflicts were found, but two cases deserve more specific wording:

- **Guy11:** an existing Project, “Sequencing Magnaporthe oryzae Guy11”, describes a MinION/hybrid assembly. The proposed **Guy11 36-base paired-end genome sequencing** uses a documented feature of the old experiment to distinguish it.
- **Wheat blast:** the proposals for 930 and 945 remain too similar to each other, and there are several other wheat-blast Projects. Their table entries are provisional. Defer these two titles until a supported isolate/cohort distinction is established; do not invent a location or year.
- **pmk1AS:** keep “leaf-sheath infection” in the proposed title. The existing inhibitor study explicitly describes leaf-spray infection, which supplies a useful distinction. This is metadata evidence, not proof that the datasets have no overlapping files.
- The two Smo1 proposals distinguish mutant/progeny sequencing from bulk segregant analysis. Shared scientific subject alone is not evidence of duplicate datasets.

## Longer description example

**PKC1 inhibition RNA-seq**

RNA-seq of M. oryzae carrying an analogue-sensitive PKC1 allele (pkc1AS). Mycelium was sampled with and without 1NA-PP1 at time points up to 24 hours to examine transcriptional responses to PKC1 inhibition. Historical project number: 2035.

The structured shortlist contains draft long descriptions for all eleven note-supported proposals. Other long descriptions are deliberately left for review. The old administrative text is preserved in that shortlist and must be retained in the audit trail if later replaced.

## Evidence and unresolved points by Project

### Courville

Project ID: `6ada6c4457c017ae1712264e`. Stored path: `/two_blades/Courville`.

**Review point:** The subdirectory Infection_RNAseq_data supports a broad description, but provides no organism or experiment identity; retain Courville pending stronger evidence.

**Sources:** `Infection_RNAseq_data/allruns/raw/AH1_S25_L003_R1_001.fastq.gz` (inventory line 451).

### project_2370

Project ID: `6ada6c4457c017ae1712264f`. Stored path: `/ntalbot/project_2370`.

**Review point:** Notes describe insert locations, but do not establish the complete experiment or a scientific owner.

**Sources:** `/mnt/reads/ntalbot/project_2370/additional/GFP_LACI_NLS.docx` (SHA-256 `e0378e121c18de2a598018f7e51b790ba090eb16306b7d6bc9198d7514ec1149`); `/mnt/reads/ntalbot/project_2370/additional/LacO_summary.docx` (SHA-256 `097693624c43e88ebc7f14b69a197c150de377668d916f6a9a43246b9a487ef3`); `/mnt/reads/ntalbot/project_2370/additional/insertion_diagram.docx` (SHA-256 `5b1cb0fec52400d9d9e9cfd3f8e130dccb203aa63c6e1fa12d424c63cb8d6211`).

### project_2035

Project ID: `6ada6c4457c017ae17122650`. Stored path: `/ntalbot/project_2035`.

**Review point:** The readme says three biological replicates while pkc_summary.docx says two per timepoint; omit a replicate count. No owner attribution is inferred.

**Sources:** `/mnt/reads/ntalbot/project_2035/additional/Project_2035_readme.txt` (SHA-256 `c6f9dab2bef7f1b6c5220e916da554371ee4752d088ee94afc2f0b1415eec78f`); `/mnt/reads/ntalbot/project_2035/additional/pkc_summary.docx` (SHA-256 `ca89740a23c2d8f3c2661fb9db6aa10be0fe0ecdcc58b35cefda1387cdeafbce`); `/mnt/reads/ntalbot/project_2035/additional/sample_summary_pkc.docx` (SHA-256 `3ffe0214b0e605d97f09fc718d1eec02a5d6ba36e5ac3c9d9aa1d7918ed29485`).

### project_945

Project ID: `6ada6c4457c017ae17122651`. Stored path: `/ntalbot/project_945`.

**Review point:** Scientific subject comes from a note stored under Project 930, which explicitly identifies Project 945 and matching sample labels. Cross-check before a write.

**Sources:** `/mnt/reads/ntalbot/project_930/additional/Wheat blast sequences summary.docx` (SHA-256 `4a525a43078844bae9630e31de4f86ae03b69a6e38fca6776101a705683c310a`); `sample_945/sample_945/processed/PY0925_contigs.fa` (inventory line 13578); `sample_945/sample_945/processed/Sample_PY0925_out.sorted.rmdup.bam` (inventory line 13586).

### project_2012

Project ID: `6ada6c4457c017ae17122652`. Stored path: `/ntalbot/project_2012`.

**Review point:** Filenames support file types only. The strain_summary.xlsx and de_novo_assembly_stats.xlsx contents were not examined; no organism or scientific purpose is established.

**Sources:** `additional/de_novo_assembly_stats.xlsx` (inventory line 13773); `additional/strain_summary.xlsx` (inventory line 13774); `sample_all/sample_all/processed/Br62_contigs_2.all.maker.proteins.fasta` (inventory line 13795).

### project_809

Project ID: `6ada6c4457c017ae17122653`. Stored path: `/ntalbot/project_809`.

**Review point:** The note describes the cross and three sequenced samples; retain Project 809 separately from Project 2009 rather than assuming they are one project.

**Sources:** `/mnt/reads/ntalbot/project_809/additional/Sequence differences between Smo1 mutant and parental types.docx` (SHA-256 `91c77c6bc1077f58fa6f75a5bf07232ab03267227abdaa47d7efe770fdc938c8`); `/mnt/reads/ntalbot/project_809/additional/Smo1.docx` (SHA-256 `856b9522194515d06e5566f6d4e6ccc05ef992f872198b55d8d4c894a5c26831`).

### project_930

Project ID: `6ada6c4457c017ae17122654`. Stored path: `/ntalbot/project_930`.

**Review point:** The summary also covers Project 945; retain both historical numbers and avoid implying every listed isolate belongs exclusively to Project 930.

**Sources:** `/mnt/reads/ntalbot/project_930/additional/Wheat blast sequences summary.docx` (SHA-256 `4a525a43078844bae9630e31de4f86ae03b69a6e38fca6776101a705683c310a`).

### project_2323

Project ID: `6ada6c4457c017ae17122655`. Stored path: `/ntalbot/project_2323`.

**Review point:** The note explicitly names Project 2323 and pmk1AS treatment; leaf-sheath host species is not supplied in this title or description.

**Sources:** `/mnt/reads/ntalbot/project_2323/additional/Project 2323 summary.docx` (SHA-256 `4c9a222eb7f27d4c1c8ae073fa3cf2935347931d498ba84b0b42d02c9d1b2cae`).

### project_2009

Project ID: `6ada6c4457c017ae17122656`. Stored path: `/ntalbot/project_2009`.

**Review point:** The retained report supports Smo1 mapping; it does not establish that this is identical to the separately registered Project 809.

**Sources:** `/mnt/reads/ntalbot/project_2009/additional/Smo1 summary for paper figure.docx` (SHA-256 `7ce1c15515595219e5d7a847094119b5696a81da21904101ba67a93e5bafade1`).

### project_1622

Project ID: `6ada6c4457c017ae17122657`. Stored path: `/ntalbot/project_1622`.

**Review point:** The document explicitly describes mutants, revertants and SNP comparisons; no scientific ownership is inferred.

**Sources:** `/mnt/reads/ntalbot/project_1622/additional/Nim1 revertants.docx` (SHA-256 `a9ed475aa9e0631e2377f2557fb08e8652fd7741f9b49f546dcbe4cccbf3b951`).

### project_1566

Project ID: `6ada6c4457c017ae17122658`. Stored path: `/ntalbot/project_1566`.

**Review point:** The only inventoried file is Sample_MG_bulk_out.sorted.rmdup.bam. Do not expand MG, infer an organism, or invent a study title.

**Sources:** `sample_mg/sample_mg/processed/Sample_MG_bulk_out.sorted.rmdup.bam` (inventory line 14146).

### project_592_593

Project ID: `6ada6c4457c017ae17122659`. Stored path: `/ntalbot/project_592_593`.

**Review point:** The subject is from Bulk segregant analysis of Buf mutant.doc filename only; the document text has not been examined. Keep both numbers.

**Sources:** `additional/Bulk segregant analysis of Buf mutant.doc` (inventory line 14152).

### project_2171

Project ID: `6ada6c4457c017ae1712265a`. Stored path: `/ntalbot/project_2171`.

**Review point:** The only file is Guy11_v3_PE_align_sorted.bam; the label supports Guy11 and alignment, but not a full study identity or equivalence with Project 539.

**Sources:** `guy11/guy11/processed/Guy11_v3_PE_align_sorted.bam` (inventory line 14185).

### project_539

Project ID: `6ada6c4457c017ae1712265b`. Stored path: `/ntalbot/project_539`.

**Review point:** The note explicitly names Guy11 sequencing and genome alignment; do not equate it with other Guy11 projects.

**Sources:** `/mnt/reads/ntalbot/project_539/additional/Summary of Guy11 sequencing.docx` (SHA-256 `46251a3732ff2a041f3678d7ec5432003b9e8eaec4adafe14647a12fa1690624`).

### project_2561

Project ID: `6ada6c4457c017ae1712265c`. Stored path: `/ntalbot/project_2561`.

**Review point:** The stored tree includes cp, xpa and pa-prefixed outputs. Do not map every prefix to a species or imply only two organisms without further verification.

**Sources:** `/mnt/reads/ntalbot/project_2561/sample_all/sample_all/processed/Cladonia portentosa gene calling.docx` (SHA-256 `184318dc6c506bd6f2078e0276c83d4ec5dd3d63c9313e226074f4862f5cfa7f`); `/mnt/reads/ntalbot/project_2561/sample_all/sample_all/processed/Xanthoria parietina gene calling.docx` (SHA-256 `a5eb3cb9c20333ec72889dcdc53d422c37457d47797b5c78b0f5214a1fbc1c9f`); `additional/Lichen DNA sequencing 2.pdf` (inventory line 14202); `sample_all/sample_all/processed/pa_combined_contigs.fasta` (inventory line 14222).

### project_230

Project ID: `6ada6c4557c017ae1712265d`. Stored path: `/ntalbot/project_230`.

**Review point:** Descriptions are based on filenames only. The contents and meaning of CM/GMM and AL1–AL3 were not inspected; do not infer conditions or experiment design.

**Sources:** `additional/Guy11_CM_FPKM.txt` (inventory line 14243); `additional/Guy11_GMM_FPKM.txt` (inventory line 14245); `additional/dmsoanes_moryzae_mycelium_RNA-Seq.xls` (inventory line 14246).

### project_758

Project ID: `6ada6c4557c017ae1712265e`. Stored path: `/ntalbot/project_758`.

**Review point:** The folder has analysis documents rather than the sequencing reads mentioned in those documents; the title describes analysis and does not promise raw reads.

**Sources:** `/mnt/reads/ntalbot/project_758/additional/Searching for insertion reads.docx` (SHA-256 `8900131500537194c3c53f950cdc913d2ab49ed89735f544cdcea9fffd37ad5e`); `/mnt/reads/ntalbot/project_758/additional/Sequence of the pCAMBgfp.docx` (SHA-256 `db8cccb2999da2f6cb0176ced659bdbca84f66b439776df20f3a287ab4806d1b`).

### saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130409.01

Project ID: `6ada6c4557c017ae1712265f`. Stored path: `/skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130409.01`.

**Review point:** This is a readable rendering of existing path labels; Clare Lewis is a historical label, not an ownership assignment. TCS is left unexpanded.

**Sources:** 23 October Project name/path snapshot.

### saunderd_pstriiformis_TCS_DianeSaunders_TSL.DS.20130809.01_113

Project ID: `6ada6c4557c017ae17122660`. Stored path: `/skamoun/saunderd_pstriiformis_TCS_DianeSaunders_TSL.DS.20130809.01_113`.

**Review point:** Existing name supplies the labels. Do not silently convert trailing 113 into a confirmed TCS batch number or assign scientific ownership.

**Sources:** 23 October Project name/path snapshot.

### saunderd_pstriiformis_TSL.DS.20130722.01_TCS_99

Project ID: `6ada6c4557c017ae17122661`. Stored path: `/skamoun/saunderd_pstriiformis_TSL.DS.20130722.01_TCS_99`.

**Review point:** Readable formatting of the existing label only; TCS meaning, scientific purpose and original ownership remain unconfirmed.

**Sources:** 23 October Project name/path snapshot.

### saunderd_pstriiformis_TSL.DS.20130730.01_TCS_105

Project ID: `6ada6c4557c017ae17122662`. Stored path: `/skamoun/saunderd_pstriiformis_TSL.DS.20130730.01_TCS_105`.

**Review point:** Readable formatting of the existing label only; retain all historical date and batch identifiers.

**Sources:** 23 October Project name/path snapshot.

### saunderd_pstriiformis_TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144

Project ID: `6ada6c4557c017ae17122663`. Stored path: `/skamoun/saunderd_pstriiformis_TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144`.

**Review point:** The title retains rev2; the proposed short description retains 1x Rapid Lane. The label alone does not establish experiment design or scientific ownership.

**Sources:** 23 October Project name/path snapshot.

## Scope exclusions

- `project_2178` was consolidated into existing Project `5fc012bda3efcb29338b7cf7`, which already has a descriptive pmk1AS title. It is not a twenty-third new registration.
- The five older Saunders Projects assigned to manual disposal are not these five `skamoun-extra-*` Projects. This draft does not expand the naming pass to those disposal records.
- Gulnara’s new destination, the four reassignment sources and HPC keep dates are unchanged by this review.

## Procedure for any remaining wording changes

1. Review the proposed wording. Confirm or defer the filename-based suggestions; inspect `strain_summary.xlsx` for Project 2012 and seek context for the single MG bulk alignment in Project 1566. No owner-contact task is created by this draft.
2. Refresh the live Project records and compare their IDs, current names/descriptions, registration and reconciliation identities, paths and archive state with this snapshot. Any later edits must be incorporated, not overwritten.
3. Choose and review a path-preserving implementation. There is currently no separate display-title field or general rename endpoint. `Project.name` is part of registered/reconciled identity, and ordinary model validation derives `safeName` and `path` from it. An ordinary name edit/save is therefore not an appropriate execution method. The relevant code is `models/Project.js`, `lib/project-registration-history.js` and `lib/reconciliation-state.js`.
4. Preserve Project IDs, safe names, HPC/S3 paths, file associations, ownership, keep dates, archive state and immutable historical receipts. Record old/new wording and the evidence supporting it. Do not bypass identity guards or hand-edit `storage.*` / `archiveMigration.*`.
5. Prepare a fresh exact before/after preview and proportionate checks, then apply only the approved wording through the reviewed implementation. Verify the project page and file links afterwards.

The structured shortlist is retained as the historical input. Use the execution record for completed scope; do not replay it against current records.
