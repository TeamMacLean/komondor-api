# Changelog

## 2026-10-22 — Administrative archive registration

- Added a prepare/apply/inspect command for registering existing, unclaimed archive
  directories with their exact spelling and approved custodian. The current target
  list contains 23 registrations: 18 `shrestha`, five `winj`.
- Added atomic creation history, retained source/Unix ownership evidence, sealed
  plans, independent-plan-copy checks, BSON exports and per-operation receipts.
  Interrupted runs verify existing results before resuming without duplicate rows.
- Protected registered Project identities/history from normal model/API mutation
  and deletion, preserved mixed-case roots on later saves, and added an admin-only
  history endpoint. Existing ordinary projects keep their normal creation behaviour.
- Added refusal checks for changed evidence, claimed roots, unfinished work and an
  expired or absent quiescence receipt. No extra payload checksum sweep is required.
- This release implements registration only. No production registration, path
  correction, notification, S3 transfer or deletion was performed during development.

Deployment and operation: [registration runbook](docs/ARCHIVE_PROJECT_REGISTRATION.md).
