# Project wording correction — completed 26 November 2026

George authorised the reviewed names and descriptions, with historical Project-number suffixes omitted from titles. Completed at **17:35:03 UTC**: **14 renamed Projects, 15 short descriptions and nine long descriptions**. Courville retained its title. [Completion receipt](evidence/completed.json).

No deployment or service changes were needed. Each exact BSON before-image was tested as a conditional filter; each write changed wording, `updatedAt`, the current `registrationProvenance.identity.name` pin when necessary, and appended one `administrative-project-wording` event. The original registration event and all prior history remain unchanged. The new event records previous/new wording, previous/new name pin, source evidence and the before-image digest. Normal application identity guards remain in force. This is the reviewed administrative-correction route described by those guards, not an ordinary model rename.

All other Project fields are unchanged, including physical paths, safe names, owners, groups, retention dates, storage and archiveMigration. Full before/after BSON is retained alongside the plan and execution receipt. The checked plan digest is `3269f926cc17847ee5e2d3b2a58e84b022ada6588822224a830aabc7084f04c3`.

## Verification

- Five scoped tests passed locally and against the production dependencies: permitted-field preservation, stale/invalid state rejection, model compatibility and continued ordinary-rename rejection, typed conditional filters, and exclusions.
- All 15 proposed after-images passed the production model's validation before writes; all 15 resulting records matched expected after-images and passed validation after writes.
- A separate local comparison of the downloaded BSON confirmed only the reviewed fields changed and every previous audit event was retained.
- All 763 File documents and 763 associated AdditionalFile documents remained identical. These administrative Projects have no Samples, Runs or Reads in the scoped relationship inventory.
- All 763 generated file-location URIs remained identical; all 15 original HPC root directories were still present. This was a metadata/path check, not another S3 inventory or payload checksum sweep.
- The signed-in Sequences page for [PKC1 inhibition RNA-seq](https://sequences.tsl.ac.uk/project?id=6ada6c4457c017ae17122650) visibly showed its new title, short/long descriptions, retained `project_2035` HPC/S3 paths and additional-file listing after completion.

## Deferred

No changes to 930 and 945 (wheat-blast titles need distinction), 2012 and 1566 (missing scientific context), or 592/593, 2171 and 230 (filename-based suggestions need confirmation). See the [naming review](../../../PROJECT_NAME_REVIEW_2026-11-26.md).

## Evidence and recovery

[Evidence manifest](evidence/manifest.json) lists checksums for six completion files. Server pack: `/storage/komondor-project-wording-20261126-02`; Mac backup: `/Users/deeks/.codex/artifacts/project-wording-20261126-02`. Pack `-01` was preparation only, superseded before any writes to include association-based AdditionalFile verification.

Do not repeat `apply`: its execution sentinel intentionally refuses replay. Any later wording correction or reversal needs a fresh live preview, full before-image, preserved intervening changes and a new audit event. Never restore the full old Project blindly: later storage/retention updates must survive. No HPC/S3 files were moved, renamed or deleted.
