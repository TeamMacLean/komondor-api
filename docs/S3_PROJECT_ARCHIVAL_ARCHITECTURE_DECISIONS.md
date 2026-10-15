# Komondor S3 archive — architecture decisions

Status: Accepted design; repository safeguards implemented; real deployment acceptance outstanding.
Date: 10 September 2026; implementation review updated 15 October 2026.
Decider: George Deeks.

This is a standalone record of what we agreed and why. It supersedes earlier
choices about bucket layout, storage classes and authentication in the archive
specification and runbook. It does not replace their detailed migration workflow
or certify that the implementation is ready for production.

Operational entry points: [first deployment and acceptance](S3_PROJECT_ARCHIVAL_DEPLOYMENT.md)
and [semi-annual operator runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md). Neither the
architecture nor a passing unit suite authorizes deletion without those checks.

## Context and priorities

Old Komondor projects need to leave the HPC datastore without losing either the
files or the website's record of where they live. Retrieval will be rare,
deliberate and potentially expensive. Automatic retrieval is out of scope.

The priority is a small, reliable system that an administrator can operate a few
times a year. Preserve understandable paths, verify the copy, make interruption
recoverable, and keep deletion a separate human decision. Do not build unattended
infrastructure or elaborate edge-case machinery for this manual workflow.

Only `DATASTORE_ROOT` is in scope. `HPC_TRANSFER_DIRECTORY` is temporary staging
and is not archived or audited by this system.

## 1. Bucket layout: groups at the root

Use a dedicated Komondor archive bucket, with this layout:

```text
s3://<archive-bucket>/
├── <group>/
│   └── <project>/
│       └── <sample>/<run>/...
├── _control/       # Manifests and verification records
└── _smoke/         # Disposable test data
```

The bucket name is not fixed by this decision. Configure the archive root as the
bucket root so that the payload mirrors the hierarchy below `DATASTORE_ROOT`.

Why: this matches the existing flat layout of `tsl-cryoem-raw` and makes HPC and
S3 paths easy to compare. An extra `data/` level has no essential archival
function.

Trade-off: `data/` would provide one convenient prefix for permissions or
lifecycle rules covering all payload files but excluding manifests and tests.
With flat groups, those rules need more care. Direct uploads into the chosen
storage class remove the immediate need for a payload-transition rule.

Reserve `_control` and `_smoke` explicitly, and check existing group paths before
use. An underscore is a naming convention, not proof that collisions are
impossible. Do not add a bucket-wide cold-storage transition that would also
archive the control manifests.

Implementation consequence (**done, 15 October 2026**): the prefix builders no
longer add a `data/` level, the control prefix is `_control/`, and the
recovery path's hardcoded `control/` assumption is gone — the abandoned-manifest
prefix is now derived from the same builder. `reservedTopLevelSegment` is the
single source of truth for the reserved names: `lib/s3-archive/preflight.js`
refuses a project whose group is one of them, and `dataPrefixFor` refuses to
build such a key at all, so neither path can be bypassed by the other. Tests,
the runbook, the specification and `.env.example` were updated with it.
The current website reads records from the database; it does not depend on
listing groups from the S3 bucket root.

## 2. Storage: individual files directly into Deep Archive

| Item | Decision | Reason |
|---|---|---|
| Project files | Upload directly to S3 Glacier Deep Archive | Rare retrieval; no Standard-storage grace period or later transition needed |
| File packaging | Keep individual files, not project tarballs | Browse recognizable paths and retrieve individual files without an extra unpacking layer |
| Control manifests | Keep in S3 Standard | Verification and recovery must not require a cold-storage restore |
| Versioning | Enabled, with no expiry rule for current or noncurrent versions | Retain recovery options; do not silently discard historical archive data |
| Transport | HTTPS-only bucket policy | Reject unencrypted transport |
| Object Lock | Off for now | Keep the initial operating model simple; immutability controls are not part of this build |
| Incomplete multipart uploads | Abort after seven days | Clear abandoned upload parts without deleting completed objects |

Accept the per-object overhead of individual files. Browsability and a simple
retrieval procedure matter more here than minimizing every storage charge.
Versioning can retain additional copies after overwrites, so avoid unnecessary
re-uploads. No automatic expiry also means those copies can accumulate.

The mover permits only multi-AZ payload classes: `DEEP_ARCHIVE`, `GLACIER`,
`GLACIER_IR`, `INTELLIGENT_TIERING`, `STANDARD` and `STANDARD_IA`. Verification
rejects `ONEZONE_IA`, `REDUCED_REDUNDANCY` and unknown classes even if their bytes
match. That is a deletion safeguard for irreplaceable data: byte equality does
not establish resilience against losing a storage location. A mismatch between
two approved classes is reported in the sealed report and warned in copy and
deletion output; investigate its cause and cost before approval.

Every new upload uses the class recorded in its source manifest. Changing
`AWS_ARCHIVE_STORAGE_CLASS` after sealing does not redirect resumed files to a
different class. Legacy v1 manifests without this optional field retain their
original bytes/digest and use the configured class for new uploads; actual
object durability is still checked. Adding the field did not change the
manifest serialization contract. The separate old-layout change is **not**
resume-compatible: stored destination/control URI mismatches fail closed.

Every command checks versioning is Enabled and rejects enabled lifecycle
expiration or transition rules anywhere in the dedicated bucket. Seven-day
multipart cleanup is allowed; other retention changes require a new reviewed
design. The mover role has read access to this configuration, never permission
to change it.

## 3. Operation: manually selected batches, manually deleted HPC data

At a semi-annual review (approximately every six months), the administrator identifies old, unarchived projects,
reviews a batch and starts the archive commands. Age helps identify candidates;
it is not permission to archive or delete them automatically.

The project lifecycle remains:

```text
hpc → migrating → aws_pending_hpc_deletion → aws
```

The copy must pass verification before entering `aws_pending_hpc_deletion`.
Only then may the tool provide the exact HPC deletion command for human review.
The administrator checks the archive and runs deletion separately. A subsequent
check must prove the original project root is absent before recording `aws`.

The archive command never deletes HPC files. Keep the source unchanged while a
migration is incomplete so that it can be resumed safely.

The website must distinguish migration, verified archive awaiting HPC deletion,
and completed migration. Projects, samples and runs inherit the project's
storage state. API, web, Power and Nudge must respect that state so archived
projects are not treated as broken HPC files or sent through obsolete local
checksum checks.

Historical database/filesystem discrepancies are reported, not treated as a
requirement to repair the entire database before archiving. Inventory the actual
project tree: include unexpected regular files and record skipped symlinks or
special files. Any genuinely unreadable data needs an explicit, recorded
decision; do not silently treat it as successfully copied.

## 4. Authentication: SSO, not unattended credentials

Use AWS IAM Identity Center SSO and a dedicated archive-mover permission set.
Allow the listing, upload, verification and incomplete-upload-abort operations
the mover needs, including `s3:RestoreObject` for rehearsals and retrieval. Do not allow deletion of completed S3 objects or their versions.

`AWS_ARCHIVE_PROFILE` and `AWS_ARCHIVE_EXPECTED_ROLE_ARN` are required alongside
the account fence. All AWS subprocesses receive the explicit profile; ambient
static access keys are removed from their environment. STS must identify the
configured assumed role, not merely someone in the right account. Keep
cleanup/administration in a separate profile and role.

Roles Anywhere is **not needed**, not a deferred implementation task. Do not
build certificate management or unattended authentication now. Revisit the
authentication choice only if unattended operation is deliberately adopted.

SSO avoids long-lived access keys and certificate rotation in this workflow.
It does not mean there are no secrets: temporary authentication tokens are
cached on the HPC and must be protected. Use the restricted mover profile for
archive work, not an administrator profile. See [AWS's SSO configuration guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).

AWS permissions protect S3, not the HPC filesystem. The local deletion boundary
comes from the tool never performing that deletion and the administrator taking
a separate manual action.

## 5. Long transfers: renewable credentials, not a 12-hour deadline

There are two separate session settings:

| Setting | Console location in IAM Identity Center | Selected value |
|---|---|---|
| Mover role credentials | Permission sets → mover permission set → General settings → Edit → Session duration | 12 hours |
| SSO login | Settings → Authentication → Session duration → Configure → User interactive sessions | 3 days / 72 hours / 4,320 minutes |

The operator confirmed both values in the AWS console on 2026-10-15 and chose
to retain them. The Identity Center instance in `us-east-1` uses the Identity
Center directory, with password authentication and direct provisioning.

The role-session maximum is 12 hours; the SSO-login maximum is 90 days. A valid
SSO login lets the CLI obtain fresh role credentials during a longer transfer.
Keep the confirmed three-day login window for manual archive batches. See the AWS instructions for
[role sessions](https://docs.aws.amazon.com/singlesignon/latest/userguide/howtosessionduration.html)
and [SSO login sessions](https://docs.aws.amazon.com/singlesignon/latest/userguide/user-interactive-sessions.html).

The console also shows seven-day user background sessions. That setting is for
[supported AWS managed applications](https://docs.aws.amazon.com/singlesignon/latest/userguide/user-background-sessions.html)
and does not extend the archive CLI's login window.

Important: the SSO-login setting applies across the Identity Center instance,
not just the mover permission set. Review that wider effect before changing it.
It applies to new logins; an external identity provider or Active Directory
policy can impose a shorter limit.

Use a current AWS CLI v2 with the modern `sso-session` configuration. Do not use
the legacy non-refreshable configuration or manually exported temporary keys
for this workflow. Automatic renewal depends on using the renewable credential
provider. See [AWS's session and refresh requirements](https://docs.aws.amazon.com/singlesignon/latest/userguide/user-session-duration-prereqs-considerations.html).

For a browserless HPC, use device-code login and complete authorization in the
laptop browser:

```bash
aws sso login --profile komondor-archive-mover --use-device-code
```

Here `komondor-archive-mover` is the chosen local profile name. See
[AWS's login instructions](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).

## 6. Recovery: resume the project, restart an unfinished file

Resume is at **file level**, not at the last uploaded byte of an unfinished file.

- Completed files are checked against the manifest's identity, size and checksum
  and skipped when they match.
- An interrupted file starts again from byte zero, using a new upload.
- If credentials cannot be renewed, stop with an error. Do not record successful
  verification, authorize deletion or remove HPC data.
- After logging in again, use Komondor's `resume` command for the same migration,
  with the original source files unchanged. Do not substitute a raw `s3 sync`
  for the database-aware workflow.

The existing uploader already has file-level verification and reuse. It does
not retain multipart checkpoints. AWS explicitly documents that its high-level
`aws s3` commands cannot resume a failed multipart upload. See
[AWS CLI multipart behaviour](https://docs.aws.amazon.com/cli/latest/userguide/cli-services-s3-commands.html).

Keep seven-day incomplete-upload cleanup. If expired credentials also prevent
immediate cleanup, the lifecycle rule can remove the abandoned parts later.
Completed objects and control records remain, so a project can still resume
after more than a week; an unfinished file starts again anyway.

The seven days are measured from upload **initiation**, not last activity.
Cleanup is asynchronous, and a single multipart upload running beyond seven
days could be aborted. This is not expected for the intended jobs. See
[AWS's incomplete-upload cleanup rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html).

## 7. Guardrails and proportionate testing

Do not impose a hard TB-per-batch limit. Size alone cannot predict duration:
network speed, file count, hashing and verification all contribute. Show total
size and largest file before starting; a rough duration warning is sufficient.
Reliable resume is the important safeguard.

Add these targeted checks to the existing upload and verification tests:

1. **Interruption and credential failure:** after file A completes, interrupt
   file B or simulate credential expiry. Confirm no successful archive status
   or deletion authorization. Resume and prove A is reused, B restarts and the
   final verification passes. Include the case where B's abandoned parts have
   already been removed; there is no need to wait a week.
   **Done, 15 October 2026:** `__tests__/lib/s3-archive/upload.test.js`
   ("interrupted copy and resume") covers the uploader, and
   `__tests__/lib/s3-archive/cli.test.js` ("archive CLI interrupted copy and
   resume") covers the recorded error, the withheld deletion command and the
   resumed run that reaches `verified`.
2. **Real credential renewal:** on the actual HPC, use a separate test permission
   set with a one-hour session and a throttled transfer lasting across renewal.
   Prove the installed CLI refreshes without another login. Do not shorten the
   production permission set just to run this test.
3. **Restore rehearsal before the pilot:** upload representative disposable files
   to Deep Archive, request a restore, download them and compare their checksums
   with the originals. An upload-only test is not sufficient evidence before
   deleting the only HPC copy of real data.

## Verification boundaries and acceptance evidence

A source manifest seals bytes (SHA-256 and CRC64NVME), file identity and intent.
The uploader opens the sealed file without following its final symlink, checks
identity, hashes the stream actually sent, and verifies S3 HEAD metadata and
full-object CRC64NVME. A successful project requires the exact payload key set,
matching local tree, passing immutable report and a fenced Mongo transition.
`deletion-command` repeats object and local-tree checks before printing anything
destructive. It never deletes. `confirm-absent` verifies absence of the original
root and records completion; it is not another full payload verification.

The local comparison uses inode/size/timestamps and other manifest metadata;
it does not hash all source bytes a second time at deletion. The datastore mount
must remain available, external writers must remain frozen, and no other actor
may overwrite the destination during verification/deletion. There is no atomic
transaction between Mongo, the HPC filesystem and S3. Versioning retains a
recovery path but is not Object Lock or protection from a privileged operator.
Treat any disagreement as a refusal, not grounds to edit the state manually.

Automated coverage now includes independent negative tests for each checksum,
ownership and durability check, both verification/deletion refusal gates, and
real CLI subprocesses using a temporary Mongo database and filesystem with only
the S3 service boundary simulated. The latter exercises plan → lock → copy →
verified → manual fixture removal → confirm-absent, and failed transfer/resume.
The smoke helper uses the production uploader for a mandatory >5 GiB cold object
and streams restored bytes through SHA-256/CRC64NVME before issuing a receipt.

The [deployment checklist](S3_PROJECT_ARCHIVAL_DEPLOYMENT.md) still requires real
account policy validation, real cold single/multipart HEAD checks, conditional
PUT refusal, interruption handling, an actual restore/download comparison,
credential renewal across expiry, and API/web/Power/Nudge acceptance on the
installed versions. None of those real-environment results is asserted here.

The accepted operational costs are human login, restarting an interrupted
individual file, per-file overhead, restoration latency and retained versions.
Use the [runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md) for selection, evidence,
review intervals, separate deletion approval and the twice-yearly audit trail.
