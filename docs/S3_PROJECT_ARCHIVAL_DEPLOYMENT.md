# S3 archive: first deployment and acceptance

Use this once before the first production archive, and repeat affected checks
when the host, AWS CLI, credentials, encryption, bucket policy or mover changes.
For each six-monthly batch use the [operator runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md).
The [architecture record](S3_PROJECT_ARCHIVAL_ARCHITECTURE_DECISIONS.md) explains
the design; this document owns the deployment procedure.

**Repository tests do not constitute production acceptance.** The real AWS,
HPC mount, credential-renewal and consumer checks below must have dated evidence
before deleting the first real project's source. No production AWS rehearsal is
claimed by this repository change.

## 1. Record the deployment inputs

Create an access-controlled release record outside `DATASTORE_ROOT`. Record:

| Input | Required decision/evidence |
| --- | --- |
| Releases | Exact API, web, Power and Nudge commits; clean checkouts |
| AWS destination | Dedicated general-purpose bucket, region, account ID, optional immutable base prefix |
| AWS identity | Named modern SSO profile, mover IAM role ARN, role/login session settings |
| Host | Canonical datastore mount, operator OS identity, Node and AWS CLI versions |
| Services | Exact commands to stop/start **all** API instances and other writers; real readiness URL |
| Database | Confirm the intended MongoDB database; current backup and restore procedure |
| Data policy | Who may select projects, approve anomalies/exclusions and delete sources; chosen review interval before deletion |
| Evidence | Durable location for plans, command logs, manifests/digests, restore receipts and approvals |
| Retention/cost | No completed-object expiry; restore/storage/transfer budget and cost owner |

Do not invent a project age cutoff or deletion grace period at execution time.
Agree and record these before the pilot. An unexpired review interval is a
reason to leave the project in `aws_pending_hpc_deletion`.

Use the repository's [general deployment checks](PRE_DEPLOY_MANUAL_CHECKS.md)
as well. They cover database indexes and ingest compatibility that this archive
procedure does not replace. Use Node 24 on the operator host (the tested
runtime), the lockfile's package manager and a current AWS CLI v2 (minimum
**2.23.0**). Preflight checks this version floor, upload flags and the
`put-object` CRC64NVME capability. Current `s3 cp help` omits algorithm choices,
so its flags alone cannot prove support. AWS documents the version boundary in
[CLI v2 checksum changes](https://docs.aws.amazon.com/cli/latest/userguide/cliv2-migration-changes.html).

On AlmaLinux, AWS CLI help can contain ANSI bold escapes. Preflight normalizes
these as well as groff overstrikes before checking capability tokens. If an older
checkout reports missing CRC64NVME despite the algorithm appearing in CLI help,
deploy the formatting fix; do not bypass the checksum check or upgrade blindly.

## 2. Provision the dedicated bucket and roles

Use an infrastructure administrator for this section. The mover must not have
bucket-policy, versioning or lifecycle administration permissions.

Create the bucket in the recorded account/region with:

- Object Ownership **Bucket owner enforced**; all four Block Public Access
  settings enabled; Object Lock off for this design.
- Versioning **Enabled**. Retain current and noncurrent versions indefinitely.
- Default encryption SSE-S3, or an explicitly approved customer-managed KMS key.
- HTTPS-only policy from [bucket-policy.template.json](archive/bucket-policy.template.json).
  Replace `REPLACE_BUCKET`, review and apply through the normal infrastructure
  process; merge deliberately if an existing policy is present.
- Only [lifecycle.json](archive/lifecycle.json): abort incomplete multipart
  uploads seven days after initiation. No expiration or transition rules,
  including noncurrent versions. This is a dedicated bucket; the CLI rejects
  enabled expiration/transition rules anywhere in it, even outside a base prefix.

The default layout is `s3://BUCKET/GROUP/PROJECT/...`,
`_control/projects/PROJECT_ID/MIGRATION_ID/` and `_smoke/UUID/`. A configured base
prefix goes before all three. Choose it once. Never move it beneath an active
migration. Groups named `_control` and `_smoke` cannot be archived.

Create an IAM Identity Center mover permission set using
[mover-policy.template.json](archive/mover-policy.template.json). Substitute the
bucket. For a base prefix, narrow the **Allow** object resource to
`arn:aws:s3:::BUCKET/BASE/*`; keep the delete deny bucket-wide. The template
contains no wildcard API actions, permits `RestoreObject` for rehearsals and
retrieval, and explicitly denies deletion of completed objects and versions.
Do not attach administrator policies to this permission set.

Bucket listing is deliberately bucket-wide in this dedicated bucket:
`HeadBucket` needs `s3:ListBucket` without an `s3:prefix` condition. Prefix-only
listing policies can make preflight fail. `GetBucketVersioning` and
`GetLifecycleConfiguration` are required on every archive command. Object
permissions cover upload/multipart, HEAD/control reads and restore. These are
mapped from the CLI operations in `lib/s3-archive/aws.js`, using the
[AWS operation-to-permission reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html).
This implementation invokes the AWS CLI; it has no AWS SDK calls for SDK-based
policy generators to analyse.

If using SSE-KMS, grant the mover `kms:GenerateDataKey` and `kms:Decrypt` on
**that key ARN** in both the effective IAM permissions and the key policy as
appropriate. Keep the key enabled and retained for the lifetime of the archive.
Verify checksum HEAD and restored downloads with that exact encryption setup;
[S3 documents the checksum/KMS requirements](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

Provision a **separate cleanup role**, available only for reviewed recovery or
smoke cleanup. It needs listing, `GetObject`, `PutObject`, `DeleteObject` and
`AbortMultipartUpload` for the specific affected prefixes (and relevant KMS
rights); add `RestoreObject` if recovering cold data. Do not grant
`DeleteObjectVersion` for routine cleanup: a versioned deletion hides a current
object but retains its history. Removing historical versions is a separate
retention decision. The archive CLI must continue using the mover role.

Record who can change retention, policies and keys. Configure account cost
alerts and audit access through the organisation's CloudTrail process; enable
S3 object data events if object-level access auditing is required (charged).
Versioning is recovery protection, not immutability: exclusive archive writers
and stable bucket policy are operating requirements.

## 3. Configure SSO and the operator shell

Configure a modern `sso-session` profile with `aws configure sso --profile
komondor-archive-mover`. Select the recorded account, mover permission set and
bucket region. Use 12-hour mover role sessions and the confirmed three-day
(72-hour) SSO login window. The latter affects the Identity Center instance,
so coordinate any future change. See the [architecture's session settings](S3_PROJECT_ARCHIVAL_ARCHITECTURE_DECISIONS.md#5-long-transfers-renewable-credentials-not-a-12-hour-deadline).

In a fresh restricted operator shell, fill in and export the approved values:

```bash
export AWS_ARCHIVE_PROFILE=komondor-archive-mover
export AWS_PROFILE="$AWS_ARCHIVE_PROFILE"
export AWS_ARCHIVE_EXPECTED_ACCOUNT_ID=123456789012
export AWS_ARCHIVE_EXPECTED_ROLE_ARN='arn:aws:iam::123456789012:role/REPLACE_WITH_ACTUAL_ROLE_PATH_AND_NAME'
export AWS_ARCHIVE_S3_ROOT='s3://REPLACE_WITH_BUCKET'
export AWS_ARCHIVE_STORAGE_CLASS=DEEP_ARCHIVE
export AWS_ARCHIVE_SSE=AES256
export DATASTORE_ROOT='/REPLACE/WITH/CANONICAL/DATASTORE'
export KOMONDOR_READY_URL='http://127.0.0.1:REPLACE_PORT/ready'
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
aws sso login --profile "$AWS_ARCHIVE_PROFILE" --use-device-code
aws sts get-caller-identity --profile "$AWS_ARCHIVE_PROFILE"
```

Replace **every** placeholder before continuing. Do not guess the permission
set's generated role name: copy its full IAM ARN (including the Identity Center
path) from the administrator. STS returns an assumed-role ARN whose role name
and account must correspond to it. The tool checks both on every invocation.
It passes `--profile` on every AWS subprocess and removes ambient static keys.
`aws sso login` alone does **not** select a profile for later commands.

The archive commands load repository `.env`; exported values take precedence.
The raw `aws` commands do not load `.env`, hence the explicit exports/profile
arguments here. Keep credentials out of `.env`, logs and Git. Protect the
operator's SSO cache. Set the intended MongoDB connection in the existing
application configuration; never paste a credential-bearing URI into evidence.

For KMS replace `AWS_ARCHIVE_SSE` with `aws:kms` and export
`AWS_ARCHIVE_SSE_KMS_KEY_ID` to the approved key ARN. Do not change encryption
policy partway through a migration without reviewing the consequences.

## 4. Deploy compatible consumers and inspect production read-only

Run unit/coverage and real-Mongo integration gates using a **disposable** test
database (integration tests drop it). Commands:

```bash
npm run test:archive
npm run test:coverage -- --runInBand
# Only with MONGODB_URI explicitly pointing to a scratch database:
npm run test:integration
```

Deploy the API and compatible web/Power/Nudge versions using the general
release procedure. Before any lock, prove on staging/disposable data that:

- `migrating` projects reject storage writes with the storage-state 409 error;
  ingest, MD5 and reconciliation workers do not alter their trees.
- Pending/deleted archives remain readable through API/web, display S3
  locations and no longer expose active HPC download/write actions.
- Power and Nudge respect `acceptsHpcWrites` and the archived states. Record
  their exact versions and observed behaviour; this API checkout cannot prove
  that the installed copies are compatible.

Audit **stored project paths**, not just group display names. The API normally
stores a leading slash; this query handles both forms. In an authenticated
Mongo shell connected to the intended database:

```javascript
db.projects.find(
  { path: /^\/*_(control|smoke)\// },
  { _id: 1, name: 1, path: 1 }
)
```

Expected: no projects selected for archiving collide. Resolve any collision
through the application's supported rename/move process before locking it.
Do not simply edit Mongo to conceal a mismatched filesystem path.

Run `node scripts/move-project-to-s3.js plan --project-id PROJECT_ID` on several
real candidates while the API is running. Read-only: inspect source/destination,
file count, total bytes, largest file and anomalies. Exit 1 may mean serious
anomalies to review; it is not a completed plan approval. Confirm the canonical
mount and that all existing data is reachable with the operator's identity.
The archive CLI disables automatic MongoDB collection and index creation for
every command. Index maintenance remains part of application deployment, not
planning or an archive transfer.

## 5. Rehearse cold upload and full restore on the actual host

This uses the production pinned-file-descriptor/stdin uploader, with
`--expected-size`, CRC64NVME and ownership metadata. It creates a 1 KiB, 16 MiB
and **6 GiB** disposable file; the last forces multipart regardless of the
configured threshold. Sparse local fixtures still send and retrieve all bytes.
Budget for hashing, >6 GiB upload/download, requests, retrieval, temporary
restored storage and retained archive versions. Deep Archive minimum storage
charges apply even to short-lived tests; review [S3 pricing](https://aws.amazon.com/s3/pricing/).

Choose a new directory under an existing scratch parent, outside the datastore:

```bash
export ARCHIVE_SMOKE_DIR='/REPLACE/EXISTING/SCRATCH/PARENT/archive-rehearsal-2026-10'
node scripts/archive-s3-smoke.js prepare --work-dir "$ARCHIVE_SMOKE_DIR"
node scripts/archive-s3-smoke.js prepare --work-dir "$ARCHIVE_SMOKE_DIR" --execute
node scripts/archive-s3-smoke.js upload --work-dir "$ARCHIVE_SMOKE_DIR" --execute
node scripts/archive-s3-smoke.js restore --work-dir "$ARCHIVE_SMOKE_DIR" --execute
# Return after S3 finishes restoring, normally hours later:
node scripts/archive-s3-smoke.js verify-restore --work-dir "$ARCHIVE_SMOKE_DIR"
```

Do not put the source into a real project. The script uses only
`<root>/_smoke/<UUID>/` and never connects to Mongo or deletes data. An upload
interruption is recovered by repeating **upload with the same work directory**;
completed files are checked and reused. Never re-run prepare in that directory.
An interrupted prepare has no uploaded data: choose a fresh directory.

Pass evidence consists of `source-manifest.v1.json`, `upload-verified-*.json`,
and `restore-verified-*.json`, plus logs and CLI version. The upload report must
verify each cold object's CRC64NVME, FULL_OBJECT checksum type, byte length,
metadata and exact key set **before restore**. The restore receipt exists only
after all downloads match the original SHA-256, CRC64NVME and length. A pending
restore exits 1 without a passing receipt; return later. An expired restore can
be requested again. Errors exit 2; preserve evidence and investigate.

Restore uses Standard retrieval and a two-day availability window. Deep Archive
has no Expedited restore; permission `s3:RestoreObject` is mandatory.
[AWS's restore contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html)
describes the expected delay and temporary copy. Preserve the receipt in the
release record before cleaning scratch data.

Also test the real service boundaries, recording evidence:

1. Take the rehearsal's exact Standard control key from its manifest's UUID.
   With the actual bucket and key filled in, run this **only on that disposable
   key**, which must already exist:

   ```bash
   export ARCHIVE_BUCKET='REPLACE_WITH_BUCKET'
   export ARCHIVE_SMOKE_CONTROL_KEY='REPLACE_WITH_EXACT_BASE/_smoke/UUID/source-manifest.v1.json'
   aws s3api put-object --profile "$AWS_ARCHIVE_PROFILE" --bucket "$ARCHIVE_BUCKET" --key "$ARCHIVE_SMOKE_CONTROL_KEY" --body "$ARCHIVE_SMOKE_DIR/source-manifest.v1.json" --if-none-match '*' --checksum-algorithm CRC64NVME --storage-class STANDARD --server-side-encryption "$AWS_ARCHIVE_SSE"
   ```

   For KMS append `--ssekms-key-id "$AWS_ARCHIVE_SSE_KMS_KEY_ID"`. Omit the
   `REPLACE_WITH_EXACT_BASE/` component if the root has no base prefix. Expect
   **412 PreconditionFailed**, never replacement, and retain the nonzero result.
2. On a second smoke upload, interrupt the AWS child while the 6 GiB file is
   transferring. Expect nonzero exit and no success report. Inspect multipart
   uploads scoped to that smoke UUID; the wrapper attempts cleanup while
   credentials work. A hard kill may leave parts; record them and confirm the
   seven-day lifecycle backstop, or abort those exact upload IDs manually.
   Re-run upload and prove completed files are reused.
3. With a **separate test permission set/profile**, one-hour role credentials
   and a transfer throttled to last longer than an hour, prove renewal occurs
   without another login. Set the expected role ARN to that test role. Capture
   start/end times and successful completion across expiry. Do not shorten the
   production role or treat simulated ExpiredToken tests as evidence of real
   renewal. Restore the production profile/role settings afterwards.

## 6. Disposable project, then first real pilot

Create a dedicated disposable group/project through the application. Confirm its
exact local root with `plan`, put representative disposable files there and
follow the [per-project runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md#archive-one-project).
Exercise dry runs, lock, pre-copy abort, lock again, copy, an interruption/resume,
delete-command refusal on a deliberately added file, manual deletion of **only
that disposable root**, and `confirm-absent`. Check API/web/Power/Nudge in all
four storage states. Save logs and Mongo/S3 evidence.

Only after sections 1–6 pass, select one small real project with its owner. Run
the same procedure; leave it pending for the agreed review interval. Inspect the
manifest and any exclusions. Request and verify a representative real file's
restore using the runbook. Have the named reviewer approve the evidence before
manually deleting that first real source. Expand to batches only after the pilot
is complete and the operator can follow the recovery procedure unaided.

Cleanup of smoke objects uses the separate role and an exact reviewed UUID
prefix. Retain evidence first; account for retained versions and minimum storage
charges. There is intentionally no automatic recursive S3 cleanup command.

## Rollback boundary

Before lock, the API release may be rolled back using its normal procedure.
After lock, preserve the tree and use `abort-before-copy` only while the tool
allows it. After sealing, finish/resume or follow reviewed cleanup/restart;
never reset Mongo storage fields to make an old release accept writes. After
HPC deletion, recovery means restoring from S3, not rolling back a database
flag. Do not switch between the legacy `data/`/`control/` layout and the current
layout during a migration; URI checks intentionally refuse that mismatch.
