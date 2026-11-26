# Gulnara execution — 26 November 2026

**Staged copy complete; database reassignment awaits the operator window.**
George authorized execution and confirmed no external writers are active. The
five affected project trees remain frozen. No database changes, service stop,
source deletion, S3 change or ENA submission has happened at this checkpoint.

The independent staged copy ran from **12:14:12 to 12:45:18 UTC** on v1333:
**40 files / 41,432,635,417 bytes**. Every source and separately reread staged file
matched the sealed SHA-256 and CRC64NVME values. The before/after selected
records were unchanged. All originals remain intact; no hardlinks were used.

- Operation: `c1f78c6d-3a3f-4165-abe5-706ded74bf99`
- Reviewed plan SHA256: `6c45e852a95f4ebd768b3afc473cc4da3a403431fe651f74c8f598fab2ca2b51`
- Prepared BSON plan SHA256: `70cc7e48bbddf541d505949365b314c3d6d60b950c52ab0608c3ffe35af7e4c1`
- Runtime seal SHA256: `774c5f2792655dd2203ae26147eb91a8f7944f811778ec356bc8d0f2c086b23e`
- Copy verification receipt SHA256: `d9d62d7686775b5d859adc5ff86f926d0f139de29e3c5fdbc16b9adf88121c06`
- Operator readiness SHA256: `3b5df8d7a5ad54776b159c3adf8e71d57ab2e8f7ae65d841a6caa555165e7af4`

The final read-only reopening probe found all 64 documents in their original state,
no differing fields, all 40 copies wholly staged and consistent, and no active
mutation. The fresh prepared plan contains BSON-preserving before-images of the
complete affected graph. Runtime inputs are now frozen; do not edit them or
recreate the prepared plan in place.

The server pack is `/storage/komondor-gulnara-20261126`. The private Mac directory
is `/Users/deeks/.codex/artifacts/gulnara-preflight-20261126/`; its
`ready-snapshot-01` contains 68 server files, with all received hashes checked.
Raw database before-images and source observations remain in those restricted
evidence locations. The selected portable copy/readiness receipts are preserved
here under [evidence](evidence/), with a [SHA256 register](evidence/SHA256.json).
The sealed runtime records some private input filenames; those are server-pack
paths, not a claim that every raw database file is published in this repository.

## Validated tooling

[Validation receipt](executor-validation.json): **70 focused tests passed**.
A separate isolated real-Mongo rehearsal using the actual scoped records passed
64 conditional updates, repeat adoption and reversal, plus interruptions after
writes 5 and 17 followed by continuation or rollback. The actual deployed ENA
serializer was rehearsed against the scoped record snapshot with the reviewed
changes applied only in memory. Independent reviewers checked copy publication,
typed database/journal recovery, operator-window fences and the ENA export.

The database executor changes only 12 Samples, 12 Runs and 40 Files, advancing 16 old
identity pins and establishing 48 new ones while preserving history. No Project,
Read or AdditionalFile document is written. `storage.*`, `archiveMigration.*`,
accessions, original HPC trees and sealed S3 archives stay unchanged.

## Operator window and recovery

George must operate the reviewed controller as `tsldata`, with the exact
readiness digest above. It verifies the files, code heads, unchanged graph,
actual effective access to the evidence/source/staging paths and unfinished work
**before stopping any service**. Then it pauses API, Web, Power and Nudge and
writes its bound lease. The agent publishes verified copies and applies the 64
conditional changes as `deeks`; the controller reopens only after an independent
consistent-graph and physical-copy check. A deadline alone cannot reopen a
partial graph. Keep other production deployments paused during this window.

The effective NFS access check matters: `/mnt/reads` mode bits alone do not
establish access (the server permits deeks despite the displayed root-owned
0770 mode). The controller's actual `tsldata` probe is the access gate. No payload
or mount permissions were broadened. Evidence directories use the existing
shared operator group 115234.

Inspected database recovery requires exact stale-lock hashes, exited prior
processes, preserved evidence and a newly sealed operator window. Resume and
rollback are supported only for recognized record states. A failure during
publication that leaves private 0700 claimed directories deliberately requires a
separate inspected recovery; the controller will not reopen or grant access
blindly. No recovery action is needed or has been run at this checkpoint.

## Remaining verification

After reassignment, verify the live project/sample/run navigation and a small
file download, then produce the scoped ENA CSV. It must contain 12 rows and 24
paired FASTQs, excluding only the seven known MD5 Read entries from the export
while preserving all records and 40 files. George confirmed HPC `/tsl/data/reads`
is mounted on the VM as `/mnt/reads`; likely transfer consumer is HPC. The
export is a reviewed preparation file, not an ENA submission.

The destination remains `hpc` with normal archive-age eligibility expected on
30 October 2031 at 14:41:13.635 UTC, to be recomputed after reassignment. The four
source holds remain active pending separate release/archive-revision review.
Gargy's preservation and all other archive work remain separate.
