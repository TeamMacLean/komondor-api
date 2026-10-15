# Archive hardening validation — 15 October 2026

This records repository verification for the commit containing this document,
on macOS with Node 24.11.1 and MongoDB 7.0.2.
It is not production acceptance; complete the
[deployment checklist](../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md) separately.

- Full unit suite: **69 suites, 2,041 tests passed** with coverage thresholds
  unchanged. Coverage: statements 82.73%, branches 75.77%, functions 76.63%,
  lines 83.18%.
- Focused archive suite: **9 suites, 154 tests passed**.
- Full integration suite on a dedicated temporary local MongoDB:
  **9 suites, 50 tests passed**. The new archive tests spawn the real CLI and
  AWS wrapper, use real filesystem bytes and Mongo fences, and substitute only
  the S3 service process. They exercise deletion refusals, exact control digests,
  streamed uploads, manual test-fixture removal and interrupted-copy resume.
- Eight isolated source mutations were all detected by failing tests: disabling
  the remote deletion check, local deletion check, failed-report sealing check,
  ownership check, missing-CRC check, unsafe-class check, versioning check or
  lifecycle check. The working source was never mutated for this exercise.
- Installed AWS CLI **2.36.44** version/help checks passed through the actual
  wrapper. Account and bucket calls were simulated for that capability check.
- Changed JavaScript parses; policy JSON parses; local documentation links and
  whitespace checks pass.

Coverage configuration now excludes test source/fixtures and nested worktrees.
Previously excluded integration suites entered the unit coverage denominator as
zero-covered application files. No production module was newly excluded and
no coverage threshold was lowered.

An earlier full-suite attempt encountered an HTTP `socket hang up` failure and
exited 139. Subsequent complete runs passed, including the final run above.
The repository already documents intermittent HTTP test transport failures;
these archive changes do not claim to fix that separate test-runtime issue.

Real cold single/multipart HEAD behaviour, IAM/KMS permissions, credential
renewal, restored-download integrity on AWS, the production mount and deployed
web/Power/Nudge behaviour remain explicit acceptance gates. No real archive
upload, production deletion, deployment or Git push was performed here.
