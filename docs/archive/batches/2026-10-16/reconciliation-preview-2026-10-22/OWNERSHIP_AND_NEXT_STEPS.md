# Ownership decisions and way forward — 22 October 2026

**Step 1 implementation update:** [registration runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md)
and [exact 23-target input](registration-targets.json). The administrative registration
command and creation-history safeguards are implemented locally and tested on a
scratch database. Production is unchanged. File-path corrections, classification,
retirement and archival remain later steps; the earlier investigation below is
retained as evidence rather than an execution-completion claim.

**All ten Saunders entries use `winj` (Joe Win):** retain the five existing
owners and assign `winj` to the five new registrations, as George explicitly
instructed. The 17 Talbot directories and Courville use `shrestha` (18 new
registrations). New assignments identify the administrative custodian, not the
original scientist. Filesystem ownership stays unchanged.

George accepts the registration/path correction approach. The proposed retention
mechanism is in [Original values and corrections](ORIGINAL_VALUES_AND_CORRECTIONS.md).
No production changes have been applied. The earlier all-shrestha proposal is
retained in [decision history](decision-history/ownership-before-winj-20261022.json).

## What the evidence supports

- **Talbot:** the database has no direct Project match for the 17 directory names.
  The 17 small notes inspected cover ten of those directories. Document properties
  mostly name Darren Soanes; one names Miriam Oses Ruiz and two use the generic
  label Biosciences. This supports retaining research/analysis clues, not assigning
  ownership from the author of a report. Related scientific subjects are also
  insufficient to equate a legacy numeric directory with a registered project.
  Use George's `shrestha` fallback for all 17; retain `tsldata` as observed Unix provenance.
- **Five existing Saunders records:** every one has `owner=winj` (Joe Win),
  `secondaryOwner=kamouns`. Retain those fields and their linked Sample/Run ownership.
  Their five associated physical directories remain the original explicit disposal
  targets; this ownership review does not change that disposition.
- **Five additional Saunders directories:** the `saunderd` prefix and named
  Diane Saunders/Clare Lewis project titles are useful historical clues. Neither
  those labels nor neighbouring projects establish an exact catalogue-owner match.
  George has now explicitly selected `winj` as administrative custodian because
  he is an established, reliable group contact. Preserve/archive all five as instructed.
  Retain Unix `root` in the evidence, not as the proposed research owner.
- **Courville:** propose the same `shrestha` custodian; its observed Unix owner
  already has that identifier. The match is not proof of original scientific ownership.

A fresh read-only User lookup confirms `shrestha` is Ram-Krishna Shrestha in
Komondor, and `winj` is Joe Win. The selected lookup returned no User document for
`saunderd`; that is not proof that a legacy or directory-service account never existed.
Existing records using legacy identifiers are retained even if no User document exists.
No new secondary owner is invented. No recursive `chown` is needed or proposed for
catalogue registration; operational access is checked separately at archival.

The bounded lookup read 117 relevant Project records plus selected User records.
It did not search old external databases or exhaust every document format. These
limits are why uncertain attribution uses the explicit fallback rather than a guess.

## Exact registration proposals

| Entry | Existing physical directory | Proposed catalogue owner | Role |
|---|---|---|---|
| two_blades-003 | `two_blades/Courville` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-012 | `ntalbot/project_2370` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-013 | `ntalbot/project_2035` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-018 | `ntalbot/project_945` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-024 | `ntalbot/project_2012` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-025 | `ntalbot/project_809` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-028 | `ntalbot/project_930` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-029 | `ntalbot/project_2323` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-031 | `ntalbot/project_2178` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-033 | `ntalbot/project_2009` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-035 | `ntalbot/project_1622` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-037 | `ntalbot/project_1566` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-040 | `ntalbot/project_592_593` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-044 | `ntalbot/project_2171` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-046 | `ntalbot/project_539` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-047 | `ntalbot/project_2561` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-050 | `ntalbot/project_230` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| ntalbot-051 | `ntalbot/project_758` | `shrestha` | Administrative custodian; original scientific owner unresolved |
| skamoun-extra-001 | `skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130409.01` | `winj` | Administrative custodian; original scientific owner unresolved |
| skamoun-extra-002 | `skamoun/saunderd_pstriiformis_TCS_DianeSaunders_TSL.DS.20130809.01_113` | `winj` | Administrative custodian; original scientific owner unresolved |
| skamoun-extra-003 | `skamoun/saunderd_pstriiformis_TSL.DS.20130722.01_TCS_99` | `winj` | Administrative custodian; original scientific owner unresolved |
| skamoun-extra-004 | `skamoun/saunderd_pstriiformis_TSL.DS.20130730.01_TCS_105` | `winj` | Administrative custodian; original scientific owner unresolved |
| skamoun-extra-005 | `skamoun/saunderd_pstriiformis_TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144` | `winj` | Administrative custodian; original scientific owner unresolved |

[Machine-readable decisions](ownership-decisions.json) retain the exact roots,
source Unix owners, evidence and research clues. The [197-entry table](PROJECT_DECISIONS.md)
uses these proposals and preserves all original dispositions.

## No separate bulk checksum sweep

George cancelled the separate remaining-data audit sweep. The completed **6,771
file observations** remain dated evidence; **8,626 files / 13.44 TB** have not been
measured by that audit. The remaining-file JSON is coverage information, not a job
queue or a prerequisite to starting the pilot. No bulk hashing job is running.

The current archive implementation still does the following **per project**:

1. `plan` and `lock` inspect structure without hashing every byte.
2. `copy --execute` reads the files to seal a source manifest with SHA-256 and
   CRC64NVME checksums.
3. The upload reads the files again, compares the streamed bytes against the sealed
   manifest, and checks the S3 object checksum before archive verification succeeds.

That normal manifest pass remains a full read of each selected project before
its upload. We are removing the extra whole-batch MD5/SHA-256 audit, not claiming
that the present mover transfers in a single read or bypassing its integrity checks.
No additional MD5 pass is required for the remaining files. Current archive
measurements can be referenced from their sealed manifest; they must not fill
original-upload checksum fields or erase historical gaps. Archiving 13.45 TB still
requires transfer time and the normal manifest reads; skipping the audit is not a
promise of a one-hour batch.

Source: `lib/s3-archive/cli.js` (`plan`, `lock`, `prepareAndSealSource`),
`inventory.js` (`createInventory`, `openAndHashEntry`) and `upload.js`
(`uploadOne` / streamed-digest and object verification). No mover code was
changed by this preview.

## Registration and path correction approach accepted

George accepts registration and path corrections. Preserve originals using the
linked design, and prepare/test exact changes against a scratch database before
production execution. Classification and retirement remain related planned work:

1. Register the 23 existing trees with the recorded custodian and original roots,
   without automatic moves or notifications.
2. Make stored physical paths consistent across archive and application consumers;
   propose the three evidenced filename corrections and retain old paths/history.
3. Catalogue supported files and retain uncertain files explicitly as unclassified.
   Do not require exhaustive scientific classification, full decompression checks,
   or a new full-file audit to preserve those files. Metadata/content spot checks
   can support classification; ambiguous cases remain unclassified.
4. Preserve empty/disposed database records and dependents with auditable retirement
   respected by readers and background workers. Do not execute the older hard-delete
   procedure.
5. Produce a concrete migration preview, independent review and rollback plan.
   Obtain George's next-stage approval before any production write. Then run a fresh
   live plan for each of the three agreed pilot projects, lock during a quiescent
   window and use the normal archive/verification path. Manual HPC deletion remains
   a separate checkpoint.

There are **zero additional owner/disposition questions** under this policy.
New conflicting identities, changed paths or unsafe references remain technical
holds. No owners are contacted. This document authorizes neither implementation
on production nor a change of filesystem permissions.

## Evidence

- [Read-only database results](live-evidence/ownership-20261022T171418Z.json) and
  [command receipt](live-evidence/ownership-20261022T171418Z.command.json).
- [Extracted note properties and text](live-evidence/ownership-notes.json),
  [allowlist](live-evidence/ownership-note-targets.json) and
  [read-only command receipt](live-evidence/ownership-notes.command.json).
- [Fresh inventory and associations](LIVE_PREVIEW.md), [policy](policy.json),
  [checksum coverage](current-checksum-summary.json).

The note inspection read 1,541,126 bytes, not sequencing-data payloads. Its document
hashes identify the evidence read; they are not a resumed sequencing checksum sweep.
