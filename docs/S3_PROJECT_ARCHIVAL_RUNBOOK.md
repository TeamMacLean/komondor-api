# S3 project archival runbook

This is the operator checklist for the implementation described in
`S3_PROJECT_ARCHIVAL_SPEC.md`. The mover copies only from `DATASTORE_ROOT`.
It never reads `HPC_TRANSFER_DIRECTORY` and never deletes HPC data.

## Bucket layout

Research groups sit at the archive root, so an HPC path and its S3 key differ
only by the configured prefix:

```text
s3://<archive-bucket>/<optional-base-prefix>/
├── <group>/<project>/<sample>/<run>/...   # payload, in Deep Archive
├── _control/projects/<project>/<migration>/   # manifests, in Standard
└── _smoke/                                # disposable test data
```

`_control` and `_smoke` are reserved at the group level. The mover refuses a
project whose first path segment is either name rather than writing payload
into its own prefixes. Before the first archive, confirm no existing group
would collide:

```bash
mongosh "$DB_CONNECTION_STRING" --quiet --eval \
  'db.projects.find({path: /^_(control|smoke)\//}, {path: 1}).toArray()'
```

An empty result is what you want. If it returns anything, rename that group
before archiving; the mover will refuse it until you do.

## One-time deployment setup

Configure these on the production host:

```text
AWS_ARCHIVE_S3_ROOT=s3://BUCKET/OPTIONAL_BASE_PREFIX
AWS_ARCHIVE_EXPECTED_ACCOUNT_ID=123456789012
# Defaults to DEEP_ARCHIVE; set it only to deviate deliberately:
AWS_ARCHIVE_STORAGE_CLASS=DEEP_ARCHIVE
# Optional for SSE-KMS:
AWS_ARCHIVE_SSE=aws:kms
AWS_ARCHIVE_SSE_KMS_KEY_ID=...
```

Project bytes are written **directly** into Glacier Deep Archive. There is no
Standard grace period and **no lifecycle transition rule for payload**: do not
add one. Control manifests are always written to Standard, because status,
resume, deletion approval and audit must never need a restore. If you ever add
a cold-storage transition to this bucket, scope it so it cannot reach
`<base>/_control/`.

On the bucket, enable versioning with no expiry for current or noncurrent
versions, enforce HTTPS-only transport by policy, and expire incomplete
multipart uploads after seven days. Object Lock stays off for now. Versioning
retains a copy on overwrite and nothing expires it, so avoid needless
re-uploads.

The mover role must be able to list and upload below the configured prefix and
to abort multipart uploads. Do not grant it deletion of objects or versions;
reviewed cleanup uses a separate delete-capable role.

Authenticate with IAM Identity Center SSO using the restricted mover profile,
never an administrator profile and never long-lived access keys. On a
browserless HPC:

```bash
aws sso login --profile komondor-archive-mover --use-device-code
```

A valid SSO login lets the CLI refresh role credentials during a transfer that
outlives the 12-hour role session, so a multi-day copy does not need a second
login. Use a current AWS CLI v2 with `sso-session` configuration; the legacy
non-refreshable setup and manually exported temporary keys will strand a long
copy.

Before the first real project, run the disposable-prefix smoke test in section
16.4 of the specification **and complete the restore rehearsal**: upload
representative files to Deep Archive, request a restore, download them and
compare checksums against the originals. An upload-only test is not sufficient
evidence before deleting the only HPC copy of real data. Deploy the
storage-aware API, web app, Power and Nudge releases together before locking a
production project.

## Archive one project

Always select a project by MongoDB ObjectId. Start with a read-only plan:

```bash
npm run archive:s3 -- plan --project-id PROJECT_ID
```

Review every anomaly. Historical database/filesystem differences are reported
but do not silently omit files: the filesystem inventory is the source of
truth. Symlinks and special files are recorded and skipped; hard-linked files
are copied once under each path. `plan` is a fast structural walk; the full
SHA-256/CRC checksum pass is deliberately done once, by `copy --execute`, when
the source manifest is sealed.

For the short locking window, stop the API and wait for its clean shutdown:

```bash
pm2 stop komondor-api
npm run archive:s3 -- lock --project-id PROJECT_ID --moved-by USERNAME --execute
```

If the plan showed serious known historical anomalies, add
`--acknowledge-known-anomalies` to `lock`. Once lock succeeds, start only the
guard-aware API release and confirm `/ready` is healthy:

```bash
pm2 start komondor-api
```

Preview the copy, then run it. An unreadable regular file can be omitted only
with an explicit path and reason; readable files cannot be excluded.

```bash
npm run archive:s3 -- copy --project-id PROJECT_ID --moved-by USERNAME
npm run archive:s3 -- copy --project-id PROJECT_ID --moved-by USERNAME --execute
```

For an approved unreadable entry, repeat paired options as needed:

```bash
npm run archive:s3 -- copy --project-id PROJECT_ID --moved-by USERNAME \
  --exclude-entry 'relative/path' --exclude-reason 'documented reason' --execute
```

Inspect progress at any time:

```bash
npm run archive:s3 -- status --project-id PROJECT_ID
npm run archive:s3 -- status --project-id PROJECT_ID --json
```

If a sealed copy fails, use the migration id printed by `status`:

```bash
npm run archive:s3 -- resume --project-id PROJECT_ID \
  --migration-id MIGRATION_ID --resumed-by USERNAME --execute
```

## Manual deletion boundary

Only after the state is `aws_pending_hpc_deletion`, ask the tool to re-check
all S3 objects and the unchanged HPC tree and print the deletion command:

```bash
npm run archive:s3 -- deletion-command --project-id PROJECT_ID
```

Read the comments and command carefully, independently check the S3 archive,
then run the printed `rm -rf -- 'exact/path'` yourself. The mover does not run
it. Finally, prove the exact project root is absent and finalize the state:

```bash
npm run archive:s3 -- confirm-absent --project-id PROJECT_ID \
  --confirmed-by USERNAME --execute
```

An empty directory, file, or symlink at that path is not “absent”; finish the
manual removal and retry.

## Recovery before any manifest is sealed

If the migration is only `locked` or `inventoried`, it can return to HPC after
the tool proves that no destination/control objects or multipart uploads exist:

```bash
npm run archive:s3 -- abort-before-copy --project-id PROJECT_ID \
  --migration-id MIGRATION_ID --aborted-by USERNAME --execute
```

After a manifest is sealed, use `resume`. For an irrecoverable sealed attempt,
`status` prints the migration-owned cleanup commands for review: object
deletions, multipart aborts, and one `aws s3 mv` per control object into the
`abandoned/` prefix. A human with a separate delete-capable role runs them.
Then start a new fenced attempt:

```bash
npm run archive:s3 -- restart --project-id PROJECT_ID \
  --migration-id OLD_MIGRATION_ID --restarted-by USERNAME --execute
```

One narrower case sits before sealing: the source manifest was written to S3
but the database update after it failed, and the tree then changed, so a
re-run of `copy` refuses to adopt the object. `status` reports the orphaned
control object and prints the `aws s3 mv` to move it aside. Once it is moved,
re-run `copy` (a fresh manifest is sealed under the same migration id) or use
`abort-before-copy`; `restart` is not needed.

Identity across time: the sealed manifest pins each file by inode, size and
timestamps, not by device number. A remount or reboot of the datastore mount
between sealing, copying and deletion does not invalidate a migration.
