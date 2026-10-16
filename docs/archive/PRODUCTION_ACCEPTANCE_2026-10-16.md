# Production archive acceptance progress — 16 October 2026

This records observed deployment evidence, not approval to delete production
sources. Continue with [first deployment and acceptance](../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md)
and use the [operator runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md) for each batch.

**Stages 1–3 have passed within their recorded scope.** Cold restore, interrupted
transfer/resume, credential renewal and the disposable-project application
rehearsal are complete. No real-project pilot has been approved or started.

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
  as Git bundles and fast-forwarded without pushing to GitHub. The initial
  CLI-only updates required no service restart. Stage 3 later paused/restarted
  API and Power for the approved lock test; final API readiness passed at
  `http://127.0.0.1:3061/ready`.
- Final consumer checkout commits: web `beb0b95`, Power `d98fab1`,
  Nudge `a311f29`. All four service processes run as `tsldata`. Its operator
  inspector confirmed clean checkouts and matched the previously unreadable
  Power sources to the tested versions. Live checks subsequently verified the
  tested archive guards. Direct `tsldata` terminal commands worked; sudo from
  `deeks` was unreliable. Preserve `deeks` for SSO/archive operations.

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
The detached restore runner exited after success. The chat follow-up was paused
on completion and has since been repurposed for the Stage 2 renewal test below.

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
logs have the `-20261016-c6b9d77.log` suffix. No project was locked, moved or deleted
by these read-only checks. Later Stage 3 mutations concerned only the newly
created synthetic fixture.

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
are committed locally at `a311f29`. Neither commit has been pushed. Nudge was
subsequently deployed by verified Git bundle and restarted during Stage 3;
the web commit adds tests only and was not deployed.

The deployed API readiness and Nudge health endpoints returned HTTP 200. The ten
selected web source files match the tested sources, and compiled web/Power
bundles contain archive handling. These read-only checks do not replace a live
disposable project's end-to-end acceptance. No production project state was
changed, email triggered or service restarted by this stage.

## Stage 2 transfer checks

Real conditional control-write refusal and interrupted multipart/resume checks
**passed at 12:17 UTC on 16 October**; see the
[transfer resilience evidence](TRANSFER_RESILIENCE_2026-10-16.md).

The operator approved creating `KomondorArchiveRenewalTest`, restricted to
smoke object access and bucket inspection, with one-hour role credentials.
Its assignment and exact policy were verified. The detached renewal test started
at **13:01 UTC (14:01 UK time)**, using a private test profile throttled to
`1MB/s`, and **passed at 14:49:52 UTC (15:49 UK time)**. The same 6 GiB upload
process ran for 105.9 minutes, observed two credential renewals and finished
after the original credentials expired. All three fixtures passed final
full-object checksum, length, metadata, storage-class and key-set verification.

The passing receipt is `renewal-verified.json` under
`/storage/komondor-archive-rehearsals-deeks/stage2-20261016T120802Z/`. Evidence
copies were independently checked locally, including the sealed manifest digest
and every entry's checksum and length. The completed runner has exited and the
follow-up is paused. The production mover role duration is unchanged.

## Stage 3 disposable-project checks

Stage 3 passed; see its
[application rehearsal record](STAGE3_APPLICATION_REHEARSAL_2026-10-16.md).
The isolated renewal-test assignment has been removed and the empty assignment
listing verified. Production mover access and retained test objects remain.

The synthetic project `6ad24adfe34eae4923a3cda4` passed plan, lock, pre-copy abort,
relock, interrupted multipart copy/resume, deletion refusal on local drift, the
operator's manual root deletion and `confirm-absent`. Its three additional files
total 83,887,104 bytes; final state is `aws` / `completed` at 16:18:07 UTC. All
four apps passed the recorded project-level checks across all four storage
states. Nudge's eligibility was unchanged by archival; dry runs sent no emails.
The single authorized creation notice was addressed only to `deeks@nbi.ac.uk`
and SMTP accepted it. The fixture's future reminders are now disabled.

API and Power were paused for 75 seconds, then restarted successfully. Final
API/Nudge health and Web/Power HTTP checks passed at 16:18:55 UTC. The fixture
has no samples/runs; Power checks stopped at validation/review. Live inherited
sample/run screens and representative Read trees remain pilot checks, and Web
clipboard contents could not be independently read back. These limits are
recorded explicitly rather than counted as passed.

## Still required

1. Record database backup/recovery, durable evidence retention, cost ownership,
   project selection ownership and the deletion review interval. The operator
   reported the database dumps complete before Stage 2; recovery has not been
   rehearsed by this work.
2. Obtain a separate green light and project-owner agreement for one small real
   pilot. Recheck its plan and active work, agree a writer pause, and retain HPC
   originals through review. Inspect its existing sample/run/read views and S3
   locations in addition to the project-level checks already exercised.
3. Restore and verify a representative file from that real pilot, then review
   its sealed evidence and agreed retention interval before any separately
   approved manual source deletion. Complete the operational handover before
   scheduling semi-annual batches.

Passing this smoke restore alone does not authorize production source deletion.
The operator requires a separate green light before each further deployment or
rehearsal stage. Stage 2 transfer tests were explicitly approved after the
database dumps completed. All three Stage 2 transfer checks have passed. Stage 3
application deployment and disposable-project work are complete within the
scope above; a real-project pilot still requires its own green light.
