# Unattended S3 archive copying

Updated 27 November 2026. The October batch finished copying on 3 November;
manual source removals are complete for 174 of its 175 Projects. Gargy alone
remains on HPC and AWS through 26 November 2027. The separate six Kamoun
no-S3 disposals are also complete. See [current status](archive/STATUS.md) and
the [completion record](archive/batches/2026-11-27/PUBLICATION.md).

This guide records the proven copy-stage design for a **new, separately reviewed
batch**. It does not describe an active transfer or authorize rerunning October
workers. AI checks are manual/ad hoc; the old hourly, daily and 15-minute
monitoring schedules are superseded. The old server observer and credentials
have not been revalidated or retired by this documentation update.

Use this procedure for an approved batch that must keep copying for days without
repeated AWS sign-ins, an open laptop or AI monitoring. The priority is verified
completion with little intervention; throughput comes second. Project selection,
the maintenance window and HPC deletion remain operator decisions.

This documents the approach activated on **26 October 2026**. The native archive
CLI is in this repository. The batch queue, credential cache and server observer
are **reviewed operational scripts in the dated evidence pack**, not a general
batch command installed by this repository. Reuse the design for a new batch;
do not replay its one-time launchers, old scope, credentials or retry budgets.
The [operator runbook](S3_PROJECT_ARCHIVAL_RUNBOOK.md) still owns the archive
lifecycle; [deployment](S3_PROJECT_ARCHIVAL_DEPLOYMENT.md) owns acceptance.

## What runs without a person

| Component | Responsibility | Human involvement |
| --- | --- | --- |
| Detached queue on the datastore host | Native copy/resume, verification, bounded retries and completion receipts | Start a reviewed batch; investigate failures outside the retry policy |
| Certificate credential provider | Obtain and renew temporary AWS credentials | Provision once; renew the certificate before expiry or retire it after use |
| Server observer | Record worker/session activity and problems every five minutes | Read health during manual checks; it does not restart stopped queues or send alerts |
| Laptop, VPN and SSH | Setup, inspection and evidence collection | Needed for remote access, not for the server-to-S3 data path |
| AI checks | Optional interpretation and inspected recovery | Not required for copying or credential renewal; disabled for the October batch |

The server still needs its datastore mount, database, institutional proxy and
AWS access. A detached process survives an SSH disconnect; this is not a service
that automatically restarts after a host reboot. A failure requiring inspection
can wait until the next manual check. Do not promise a notification while the
laptop is asleep or monitoring is disabled.

## 1. Record scope and freeze the source

Prepare a durable, access-controlled batch record outside `DATASTORE_ROOT`.
Record exact Project/migration IDs, canonical HPC roots, S3 destinations,
approved plans and anomalies, file counts/bytes, deployed commits, operator,
database backup, AWS identity and the deletion policy. Keep KEEP/excluded entries
outside the queue. S3 preserves `GROUP/PROJECT/...` under the configured prefix.

For a later batch, first apply the current deletion-review date and keep-date
policy in the runbook; the initial supplied list was a separate explicit scope.
Use the runbook's guarded maintenance procedure to quiesce services and external
writers, check readiness and acquire the approved locks. Website/API locks do
not stop an external HPC job writing directly to disk. Keep nominated trees
unchanged throughout copying and review. Restore compatible applications after
the lock window; payload copying can then proceed with the applications online.
This guide does not authorize additional locks or service operations.

## 2. Give the server a renewable workload identity

Human SSO can refresh role credentials while its login remains valid. It still
has an interactive login boundary: the October transfer stopped when that token
expired and could no longer refresh. A longer role session or tmux does not
remove that dependency.

For the on-premises v1333 worker, use **IAM Roles Anywhere** with a dedicated
archive role, trust anchor, profile and server certificate. The official
[AWS signing helper](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html)
supports `credential_process`, obtaining temporary credentials from the
certificate. Keep human administration in a separate profile; an administrator
login on the Mac is for provisioning, not credentials to copy onto v1333.

Before first use or renewal:

1. Inspect the intended account, current mover permissions, bucket policy and
   any existing workload resources. Provision only the agreed resources. Retain
   the mover's bucket-scoped permissions and explicit denial of completed-object,
   version and bucket deletion; do not grant the server administrator access.
2. Restrict role trust to the exact trust anchor, account, certificate subject
   and issuer. Use the Roles Anywhere service principal and required STS actions
   described in the [AWS trust model](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html).
   Validate the policy, read back every resource and test allowed/denied actions.
3. Generate the server private key on the server. Transfer only its certificate
   request/public certificate. Keep the signing CA's private key separately in
   protected administrator storage. Record certificate identity, fingerprint,
   expiry and who will renew or retire it. The October setup used a dedicated
   locally signed CA; it did not provision an AWS Private CA service.
4. Download the official helper for the actual OS/architecture and verify its
   published checksum before execution. Put the helper, certificate, key and
   credential configuration in a private directory owned by the worker account.
   Use directory mode `0700`, files `0600` and executable helper mode `0700`.
5. Use an isolated AWS configuration and shared-credentials file. Set
   `AWS_ARCHIVE_PROFILE`, `AWS_ARCHIVE_EXPECTED_ACCOUNT_ID` and
   `AWS_ARCHIVE_EXPECTED_ROLE_ARN` to the workload identity; keep the exact role
   fence enabled. Remove inherited static keys. Use absolute provider paths,
   TLS verification and the host's approved proxy settings.

The October provider requested one-hour credentials and returned their
`Expiration`. The CLI can then rerun the provider before expiry. AWS does not
provide shared caching for external-process credentials, so the reviewed wrapper
uses a private file cache, an exclusive lock and atomic writes. It requests a
replacement when invoked with 20 minutes or less remaining, and checks file
ownership/modes, helper digest and resource identity. It makes at most three
attempts for recognized temporary connection/service failures; authorization
failures stop immediately. See [AWS external credential processes](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sourcing-external.html).

Credential JSON goes only to the requesting CLI. Never run the provider directly
to display its output, or collect keys, token caches, credential JSON, secret
environment variables or unrestricted helper stderr as evidence. Record only
issuance time, expiration, method and attempt count. The server key is a secret
even though each AWS credential is short-lived.

### Prove renewal before switching the queue

Use the isolated profile to check STS account/role, native project status and an
already verified object's size, full checksum, ownership, version, storage class
and encryption. Confirm the sealed manifests and retained source match.

Use a separate short-duration credential test/cache, wait for its credentials
to **actually expire**, and prove that a new invocation obtains different valid
credentials under the same expected role without SSO. Save only non-secret
results. Also test cache reuse, concurrent access, renewal failure, bounded
network retries and refusal of unsafe files/configuration. Simulated expiry
tests alone do not prove real AWS renewal.

On 26 October, the first test credentials expired at **20:54:14 UTC**; fresh
credentials authenticated successfully at **20:54:31 UTC** without another
login. This proves renewal after real expiry. It does not claim an uninterrupted
multi-day batch or every long-upload condition has already been tested.

Certificate renewal is separate from temporary credential renewal. The October
certificate's recorded expiry is **24 January 2027 at 20:36:45 UTC**. Revalidate
its present status before any later batch; renew it through review or retire it
when no longer needed. The historical runner seals certificate and configuration hashes: replacing those files requires a reviewed update and
handover, not an in-place edit beneath an active queue. Do not fall back silently
to personal SSO or disable identity checks.

## 3. Launch or hand over without overlapping workers

Prepare and review the queue against the exact deployed CLI and current batch.
Seal the scope, scripts, configuration and adopted receipt digests. Test its
retry classifications, attempt limits, graceful stop and supervisor decisions.
Use canonical path normalization consistently; stored leading-slash formats
must not conceal a different source or destination.

For a handover, use the existing queue's **documented graceful-stop handler** to
finish its active native operation. Do not assume an arbitrary program handles
SIGTERM this way, and do not signal upload children. Prove the old queue and all
session children have exited before launching a replacement.

Read each completed receipt and verify its exact Project/migration, paths,
database state, `storage.s3VerifiedAt` and sealed evidence digests. Adopt matching
completions without reuploading or changing their dates. Inspect unfinished
Projects individually and preserve previous attempts; a new runner revision is
not a fresh retry allowance. Run a read-only preflight, then launch exactly one
detached queue with fresh logs, an exclusive launch intent and a worker receipt.
Confirm the active selector, actual PID/process and first operation agree.

The r10 handover adopted 118 completed bulk Projects and accepted only 56
untouched locked Projects. Its failed r9 preflight and corrected r10 launch are
preserved in the batch history. Those scripts are not a generic way to resume
arbitrary partial Projects.

## 4. Prefer bounded recovery over high concurrency

The tested October settings are one Project at a time, AWS CLI `classic` S3
client, two concurrent S3 requests, standard request retry mode and eight
maximum request attempts. These are measured operating choices for this host
and proxy, not universal fastest settings. Keep them until sustained evidence
justifies a change; change one factor at a time.

The queue uses only the deployed native `copy`/`resume` commands. It preserves
source sealing, checksum/ownership/version checks, database fences and exact
destination checks. Its additional read retries cover recognized proxy failures
only. Fresh Projects have at most six queue attempts, with 30–60 second waits;
these sit above the bounded AWS request retries. Previously attempted Projects
retain their inspected remaining budget.

| Observation | Queue/recovery action |
| --- | --- |
| Recognized transient proxy connection failure | Retry within the recorded budget after inspecting the native state; sealed partial copies require valid ownership/checksums/versions and no unfinished multipart uploads |
| Proxy budget exhausted for one Project | Record it as quarantined and continue other eligible Projects; the batch remains incomplete and that Project needs inspection before another attempt |
| Authentication/authorization failure, changed source, unexpected identity/state, foreign object, checksum/version mismatch or failed database fence | Stop; preserve evidence and investigate. Do not clear database errors or reset the budget |
| Incomplete multipart upload after interruption | Establish exact upload ownership and stopped writer; follow the runbook's reviewed recovery, not blind queue restart |
| No new completed Project during a long file | Check active progress and process/session I/O; completion count alone cannot establish a stall |

Recovery reuses **verified complete files**, not partially uploaded bytes. An
unfinished file can restart from byte zero, so large files can cost more time
after an interruption. Never replace native recovery with raw `s3 sync`,
overwrite foreign keys or bypass a guard to keep the queue moving.

## 5. Observe and retain evidence

The October five-minute server observer checked the active selector, PID/session, log
position and process I/O. Two hours without observed I/O or log progress raises
an attention record. It never blindly restarts a queue. Manual checks should
inspect its health alongside native status, current attempt/error receipts and
the active queue summary; an old error from a superseded attempt is not a new
failure.

Keep timestamped observations on disk, not just in chat: verified Project and
byte counts, current Project/phase, log offset/event signature, worker I/O,
errors, latest verified transfer and certificate expiry. Source hashing can be
active while the upload log is quiet. I/O bytes are **not uploaded bytes**.
Estimate completion from sustained verified-byte throughput across substantial
Projects, including hashing/verification and downtime; early small-Project
counts are misleading.

Mirror new completion receipts, source manifests, verification reports and
execution receipts to separate durable storage under fresh snapshot names.
Verify archive/member hashes and previously indexed receipt hashes before
advancing the mirror index. Preserve all earlier evidence and
`storage.s3VerifiedAt`. A Project can exist on both HPC and AWS while its state
is `aws_pending_hpc_deletion`; the October receipts also record both locations.

## 6. Complete copying, then review deletion separately

The October copy-completion gate required `allCopied: true`, **174 complete
bulk receipts**, all **175 Projects including the pilot** verified in
`aws_pending_hpc_deletion`, a successful active summary and no unresolved issues.
It passed on 3 November. After the later manual removals and native confirmations,
174 are now `aws`; Gargy remains pending under its keep date. Do not require the
completed Projects to return to their earlier pending state. Reconcile a future
batch against its own approved scope.

The live pilot restore passed on **23 October 2026 at 16:49:16 UTC**, with the
downloaded real file matching its sealed size, SHA-256 and CRC64NVME. One
representative restore is required by this batch's review policy; there is no
per-Project cold restore requirement. Before HPC deletion, check every Project's
identity, paths, source and sealed reports against fresh native archive/source
checks; investigate discrepancies and perform deeper object checks on selected
Projects, including the largest and one with many files.

The operator removed this batch's seven-day hold on 23 October. Historical
`earliestDeletionReviewAt` values are retained unchanged as superseded planning
dates. The seven-day incomplete-multipart cleanup rule is unrelated to the
deletion hold or the time AWS needs to restore an archived object. Future batches
must record their own review policy. Follow the runbook to generate and review
fresh deletion commands; **only the operator executes HPC deletion**. The queue
and observer never delete or finalize archives.

## October 2026 implementation and evidence index

These are historical deployment references, not portable defaults or a live
health report. For a future authorised inspection, check the actual selector and
process state before assuming any queue or observer is still running.

| Item | Recorded location/value |
| --- | --- |
| Batch history | [Production bulk copy record](archive/batches/2026-10-16/bulk-copy-2026-10-23/README.md) |
| Pilot history | [Live pilot record](archive/batches/2026-10-16/pilot-production-2026-10-23/README.md) |
| Server / worker account | `v1333` / `deeks`; Node `/storage/.nvm/versions/node/v24.11.1/bin/node` |
| Server operational pack | `/storage/komondor-archive-batch-20261023` |
| Mac evidence pack | `/Users/deeks/.codex/artifacts/archive-batch-20261023` |
| Workload role | `arn:aws:iam::958120753368:role/KomondorArchiveV1333` |
| Private credential directory | `/usr/users/TSL_20/deeks/.aws/komondor-archive-workload-20261026` — exclude from evidence collection |
| Queue / observer at the October handover | `copy-batch-r10.cjs` / `supervisor-workload-r10.py` |
| Public authentication proofs | `workload-auth-verified.json`, `unattended-auth-20261026/activation-complete.json` |
| Mirrored launch evidence | `workload-r10-evidence-20261026T210935Z` and its `-verification.json` |
| Status and history | `status-batch.cjs`, `supervisor-health.json`, `monitor-state.json`, `monitor-observations.jsonl` |
| Manual evidence helpers on Mac | `collect-monitor-workload-r10.py STAMP`, then inspected `mirror-monitor-evidence-v7.py STAMP`; always use a new stamp |

For a read-only batch check on v1333 as `deeks`:

```bash
/storage/.nvm/versions/node/v24.11.1/bin/node /storage/komondor-archive-batch-20261023/status-batch.cjs
```

This operational status wrapper selects the isolated workload credentials and
identity fences. Raw AWS calls need that same isolated configuration and profile;
the old `komondor-archive-mover` profile still uses human SSO. Never dump the
private credential directory to diagnose authentication. Preserve public error
and health records and inspect expiry, permissions, proxy access and resource
identity instead.
