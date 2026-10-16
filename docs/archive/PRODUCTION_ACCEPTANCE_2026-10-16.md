# Production archive acceptance progress — 16 October 2026

This records observed deployment evidence, not approval to delete production
sources. Continue with [first deployment and acceptance](../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md)
and use the [operator runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md) for each batch.

## Environment and release

- Host: `v1333.nbi.ac.uk`; archive operator: `deeks`.
- Node `v24.11.1`; AWS CLI `2.38.1`.
- Bucket `tsl-hpc-reads`, region `eu-west-1`, account `958120753368`;
  profile `komondor-archive-mover`, SSE-S3 (`AES256`), no base prefix.
- Versioning enabled; only seven-day incomplete multipart cleanup; public
  access blocked; bucket-owner-enforced ownership; HTTPS-only bucket policy.
  Settings were read back during setup on 15 October.
- Datastore `/mnt/reads` is the mounted NFS reads share. `deeks` could list the
  mount and inspect the three project trees below. This does not establish
  access to every project or permission to delete files.
- Production API checkout is clean at `c6b9d77`; the CLI fixes were transferred
  as Git bundles and fast-forwarded without pushing to GitHub. Services were
  not restarted. API readiness returned HTTP 200 with all checks passing at
  `http://127.0.0.1:3061/ready` before the CLI-only updates.
- Observed consumer checkout commits: web `beb0b95`, Power `d98fab1`,
  Nudge `944868b`. All four service processes run as `tsldata`. Some Power files
  are unreadable to `deeks`, so its working-tree cleanliness and deployed build
  contents have not been fully verified. Selected compiled archive guards were
  subsequently confirmed during the app checks below. Noninteractive sudo is
  unavailable.

## Passed smoke recovery

The isolated rehearsal directory on v1333 is:

```text
/storage/komondor-archive-rehearsals-deeks/run-20261015T182516Z
```

It uploaded 1 KiB, 16 MiB and 6 GiB fixtures through the production upload path
to `_smoke/176d73d4-9aba-4515-89c3-c99405a0297c/payload/`. Cold-object verification
passed before restore. Standard restore was requested with two-day availability.
The detached verifier completed at **2026-10-16 03:17:00 UTC (04:17 UK time)**.
All three downloaded sizes, SHA-256 values and CRC64NVME values matched the
sealed source manifest. The receipt's source-manifest digest was also checked
against the saved manifest on 16 October.

Evidence in that directory:

- `source-manifest.v1.json`
- `upload-verified-1792089288552.json`
- `restore-verified-1792120620123.json`
- `background-verify.log` and `background-status` (`verified`)

Copies of the three JSON files are retained on the operator Mac under
`/Users/deeks/.codex/artifacts/archive-rehearsal-20261015T182516Z/`.
The detached runner exited after success. The chat follow-up is paused; its
configured four-hour cadence quietly retries ordinary network/VPN failures.

## Production read-only checks

- Run-index preflight checked 3,981 runs: no duplicate sample/name pairs and no
  reported blocking index conflict.
- Ingest inspection found zero unfinished jobs.
- No stored project paths collided with the reserved `_control`/`_smoke` roots.
- `693d56ceaeb7e7fd45212b09`: plan succeeded, but its only file is zero bytes and
  untracked in MongoDB. An existing test-named project is not presumed disposable.
- `6a561a8428866e6f1f712f0c` (TPX0036): plan succeeded; two tracked files,
  718,491,200 bytes, no missing files, untracked files or checksum anomalies.
  This is a structural plan, not a new byte-integrity check or owner approval.
- `689c922c08b2f88cfa735818` (TPX0014): plan returned 1 because three Read records
  lack destination MD5 values. Do not infer corruption, waive these anomalies,
  or select this project for the first pilot without investigation.

Plans and initial diagnostic failures are saved as `plan-*.log` in
`/storage/komondor-archive-rehearsals-deeks/`. Successful populated-project plan
logs have the `-20261016-c6b9d77.log` suffix. No project was locked, moved or deleted.

## CLI fixes discovered during deployment

- `a0ab056`: normalize ANSI bold escapes as well as groff overstrikes in CLI
  capability help; retain exact CRC64NVME and flag checks.
- `5b8bda4`: disable implicit MongoDB collection/index creation in archive CLI
  connections, including read-only plans.
- `c6b9d77`: register the File model needed to populate tracked Read and
  AdditionalFile references in the standalone CLI.

Each defect was reproduced before its fix. Final focused validation: 164 archive
unit tests and four real-Mongo CLI integration tests passed. The latter cover
unchanged collections/indexes during planning, tracked file references, the
archive lifecycle and interrupted-transfer recovery. Integration tests used a
disposable local MongoDB, never the production database.

## Application compatibility checks

Stage 1 code checks passed on 16 October: API 436 tests, web 74, Power 118 and
Nudge 114. See the [application compatibility evidence](APP_COMPATIBILITY_2026-10-16.md)
for exact versions, scope, commands and limitations. The additional web tests
are committed locally at `d1b96a0`; Nudge's archive audit visibility and tests
are committed locally at `a311f29`. Neither commit has been pushed or deployed.

The deployed API readiness and Nudge health endpoints returned HTTP 200. The ten
selected web source files match the tested sources, and compiled web/Power
bundles contain archive handling. These read-only checks do not replace a live
disposable project's end-to-end acceptance. No production project state was
changed, email triggered or service restarted by this stage.

## Still required

1. Deploy the reviewed Nudge audit improvement with explicit operator approval,
   then verify API/web/Power/Nudge through every state of a fresh disposable
   project. Local code checks have passed; live authenticated application
   acceptance and complete Power deployment provenance remain outstanding.
   Archival must not suppress publication nudges.
2. Real conditional control-write refusal and interrupted multipart/resume checks
   **passed at 12:17 UTC on 16 October**; see the
   [transfer resilience evidence](TRANSFER_RESILIENCE_2026-10-16.md). These checks
   do not establish credential renewal, which remains the next gate.
3. A separate test role/profile with one-hour credentials and a throttled transfer
   crossing expiry. Overnight restore completion does not prove renewal within a
   continuously running upload. Do not shorten the production role session.
4. A newly created disposable project exercised through the application's full
   archive workflow. Establish exact writer stop/start commands and a maintenance
   window before lock; preserve the `deeks` SSO identity for archive commands.
5. Record database backup/recovery, evidence retention, cost ownership, project
   selection ownership and the deletion review interval. Then obtain owner
   agreement on one small real pilot and retain its HPC originals through review.

Passing this smoke restore alone does not authorize production source deletion.
The operator requires a separate green light before each further deployment or
rehearsal stage. Stage 2 transfer tests were explicitly approved after the
database dumps completed. The credential-renewal test awaits administrator SSO
authentication to create the separate test access; later application deployment
and disposable-project work still need their own green light.
