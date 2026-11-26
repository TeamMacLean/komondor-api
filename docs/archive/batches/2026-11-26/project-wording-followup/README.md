# Remaining seven project names — completed 26 November 2026

George explicitly approved all seven conservative names. Completed at **18:03:10 UTC**: seven titles, seven short descriptions and two long descriptions. This completes the 22-project naming review: 21 renamed Projects, 22 improved short descriptions and 11 long descriptions; Courville kept its name. [Completion receipt](evidence/completed.json).

| Previous name | Approved live title |
| --- | --- |
| project_945 | Wheat blast isolate sequencing |
| project_2012 | Sequence assemblies and gene annotations |
| project_930 | Wheat blast assembly and gene analysis |
| project_1566 | MG bulk read alignment |
| project_592_593 | Buf mutant bulk segregant analysis |
| project_2171 | Guy11 paired-end read alignment |
| project_230 | Mycelium RNA-seq expression tables |

The same reviewed administrative method as the [first pass](../project-wording/README.md) was used. Current name pins and wording changed atomically under exact typed BSON before-image conditions; previous names and all existing audit events were retained. Each new event records the approval and source evidence. There were no application deployments, service changes, file moves, deletions, S3 operations or edits to storage/archive state.

Five scoped tests passed locally and against production dependencies. All seven records passed production model validation before and after writes. A separate comparison of downloaded before/after BSON confirmed only the reviewed fields and appended audit events changed. All 156 File documents and 156 associated AdditionalFile documents were unchanged, as were all 156 generated location URIs. All seven HPC directories remain present. There are no Samples, Runs or Reads in this scoped relationship inventory. This checks catalogue/path preservation, not fresh payload checksums or S3 inventory.

The signed-in website visibly displayed **Wheat blast assembly and gene analysis**, its updated descriptions, original `/ntalbot/project_930` HPC/S3 paths and additional-file listing.

Evidence includes full before/after BSON, prepared plan, execution receipt and journal. [Checksums](evidence/manifest.json). Reviewed plan SHA-256: `deb8e1eb804f87f3416f5f57748ada871be257921f4233018b495df6bb8f583c`. Server pack: `/storage/komondor-project-wording-followup-20261126-01`; Mac backup: `/Users/deeks/.codex/artifacts/project-wording-followup-20261126-01`.

Do not replay this execution. Any future correction needs a fresh live preview and new audit event. The approved labels deliberately avoid inventing unknown organisms, cohort locations or experiment details; those uncertainties remain recorded in the input.
