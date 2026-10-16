# Real S3 transfer resilience — 16 October 2026

The operator approved Stage 2 after completing the database dumps. This stage
tests conditional control writes, interrupted multipart recovery and renewable
SSO role credentials. It does not authorize application deployment, a project
archive or source deletion.

## Scope and execution

The unchanged production uploader at API commit `c6b9d77` runs on v1333 as
`deeks`, with Node `v24.11.1` and AWS CLI `2.38.1`. No application database is
connected by the harness. The real bucket is `tsl-hpc-reads` in `eu-west-1`, with
AES256 encryption and payloads in Deep Archive. Each new fixture is isolated
under its own `_smoke/<UUID>/` prefix.

The operator harness and evidence directory is:

```text
/storage/komondor-archive-rehearsals-deeks/stage2-20261016T120802Z
```

The recovery runner was launched at `2026-10-16T12:08:02Z` in a detached process
session with file logs, an exclusive lock, reduced CPU priority and a 90-minute
timeout. Its AWS settings are in a private copy of the configuration inside the
scratch directory. The normal AWS configuration and role settings are unchanged.
The test copy limits transfers to `16MB/s`, uses two concurrent requests and
selects the classic transfer client.

The laptop and VPN are needed to set up the runner and inspect its results.
They are not on the server-to-S3 data path. Closing the laptop or losing SSH
does not stop the detached runner. Chat follow-ups require the local app to be
available and a working connection; delayed observation does not imply a failed
server job.

## Conditional control write: passed

At `2026-10-16T12:08:11Z`, a conditional PUT to the existing smoke control key
`_smoke/176d73d4-9aba-4515-89c3-c99405a0297c/source-manifest.v1.json` returned
S3 `PreconditionFailed`. Its version ID and exact downloaded bytes were unchanged.
The harness called the production `putControlObject` method, including
`If-None-Match: *`; it did not substitute an unconditional write.

Evidence: `conditional-write-passed.json`.

## Interrupted upload and restart: passed

The new smoke prefix is
`_smoke/646c910a-0db2-4b4a-8ed5-a5fdeea9754a/`. Its fixtures are 1 KiB, 16 MiB
and 6 GiB, each inventoried and sealed by the production smoke preparation path.

At `2026-10-16T12:10:12Z`, the harness observed five completed 8 MiB parts of
the 6 GiB object, then sent SIGTERM to that exact AWS upload child. At
`12:10:16Z` it verified that:

- The upload failed and no passing upload receipt existed.
- No completed object existed at the interrupted key.
- No incomplete multipart uploads remained under this smoke payload prefix.
- Both smaller files were already complete; their version IDs were saved.

The runner then repeated `upload` with the original manifest and unchanged
source files. At `2026-10-16T12:17:51Z` it passed final verification: only the
interrupted file appeared among new upload calls, both completed files retained
their exact version IDs, and no incomplete multipart uploads remained. The
production verifier checked lengths, FULL_OBJECT CRC64NVME checksums, ownership
metadata, Deep Archive storage class and the exact payload key set.

Evidence: `interruption-trigger.json`, `interruption-passed.json`,
`recovery-verified.json` and
`interruption/upload-verified-1792153069026.json`. The recovery runner finished
successfully. This is file-level recovery: the interrupted file was uploaded
again from byte zero, while completed files were verified and reused.

## Credential renewal: running, result pending

After explicit operator approval, the separate permission set
`KomondorArchiveRenewalTest` was created at `2026-10-16T13:00:21Z` with session
duration `PT1H`. Its ARN is
`arn:aws:sso:::permissionSet/ssoins-7223af30a9102cc1/ps-7223ea4e40678341`.
The only assignment is the existing `georgedeeks-archive` user in account
`958120753368`. Read-back checks confirmed the exact approved inline policy,
one-hour duration and absence of AWS/customer managed policies. The policy allows
bucket inspection and object upload/read/multipart operations only under
`tsl-hpc-reads/_smoke/*`, and explicitly denies deleting completed objects,
versions and the bucket.

The generated role ARN is:

```text
arn:aws:iam::958120753368:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_KomondorArchiveRenewalTest_7fbed92445ebec4b
```

On v1333, `komondor-archive-renewal-test` references the existing renewable
`komondor-archive` SSO session in the private `aws-renewal-config` file under
the evidence directory. STS confirmed the expected test role and archive user.
No administrator credentials were copied to v1333. The normal configuration,
12-hour production role and SSO session settings remain unchanged.

`stage2-renewal.cjs` was launched at `2026-10-16T13:01:43Z` in detached process
session `1635527`, with a three-hour timeout, exclusive lock and file log. The
test profile uses the classic transfer client, two concurrent requests and
`max_bandwidth = 1MB/s`. Preparation hashes fresh 1 KiB, 16 MiB and 6 GiB fixtures;
the upload is expected to take about two hours. Launching is not a passing result.
Preparation completed under `_smoke/e19b44f4-bfc2-4d65-9e40-e0e4a19b045f/`,
and the runner entered its upload phase at `13:03:24Z`. The initial credentials
expire at `14:01:02Z` (15:01 UK time), before the expected upload completion.

The renewal runner uses another smoke UUID and a transfer throttled to
last beyond the actual initial credential expiration. It observes the
private CLI credential cache without logging credentials or making refresh
requests during the upload. Passing requires newly issued role credentials to
be observed while one continuous AWS upload process is alive, that process
finishing after the original credentials expire, and final checksum verification.
Time elapsed alone, or a fresh login after an interrupted transfer, is not proof.

Inspect `renewal-status.json`, `renewal.log` and `renewal-launch.json` in the
evidence directory. A passing run must produce `renewal-verified.json`, which
references the final upload receipt. `renewal-cache-observations.jsonl` records
only expiration times and one-way access-key fingerprints, never credentials.
Do not run AWS commands with this test profile during the upload: a separate
process refreshing its credential cache would compromise the renewal evidence.

The existing chat follow-up now checks this runner every four hours, quietly
skipping ordinary laptop/VPN disconnections. It reports a verified result,
actual runner failure/timeout or required authentication, then pauses when
complete or blocked on authentication. It cannot run while the local app is
unavailable; the server job continues independently.

Local runner sources and evidence copies are retained in
`/Users/deeks/.codex/artifacts/archive-stage2-20261016/`. The test assignment does
not expire after one hour; each issued role session does. Remove the isolated
test assignment after acceptance and retain the evidence. Do not change the
production mover assignment or delete retained smoke objects during that cleanup.

## Remaining approval boundary

After this stage completes, obtain another operator green light for the next
deployment or disposable-project stage. Do not deploy the pending Nudge change,
restart services, run a production nudge, create/archive a real project, remove
HPC originals or delete completed S3 smoke objects as part of these tests.

Smoke data is retained; this test incurs upload/request and archive storage
charges. It does not request another restore. Account for retained versions and
minimum storage duration when planning later reviewed cleanup; see
[S3 pricing](https://aws.amazon.com/s3/pricing/).
