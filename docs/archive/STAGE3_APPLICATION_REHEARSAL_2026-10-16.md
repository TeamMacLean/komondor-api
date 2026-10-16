# Stage 3 application rehearsal — 16 October 2026

**Disposable-project rehearsal passed. Real-project pilot not yet approved.**
Stage 3 exercised the approved Nudge release, archive lifecycle, interrupted-copy
recovery and application checks through all four storage states. The operator
manually deleted only the synthetic project's verified HPC root; absence was
confirmed at **16:18:07 UTC**. API, Web, Power and Nudge were healthy afterward.
The coverage limits below remain part of the next pilot's acceptance scope.

## Readiness and service control

At 15:23–15:34 UTC, API readiness and Nudge health passed. The read-only database
checks found 3,981 runs, no duplicate `{ sample, name }` pairs and no unfinished
ingest jobs. Before an actual pause, repeat the work/queue checks: this snapshot
does not establish that later requests have drained.

The operator ran the service-account inspector directly as `tsldata` at
15:34:22 UTC. All four checkouts were clean:

| Service | Checkout before change | PM2 ID | PID observed |
| --- | --- | --- | --- |
| API | `c6b9d77` | 9 | 1345537 |
| Web | `beb0b95` | 0 | 829862 |
| Power | `d98fab1` | 8 | 826467 |
| Nudge | `944868b` | 2 | 23856 |

The PM2 daemon belongs to `tsldata`, with `PM2_HOME=/storage/.pm2`. Do not use
another user's daemon or `pm2 stop all`; unrelated applications share this
daemon. The API has a 30-second PM2 kill timeout. Its shutdown can refuse while
transfers run, but PM2 can subsequently kill it: inspect and drain work before
stopping it, rather than relying on this refusal as protection.

`deeks` cannot directly control the service socket. The operator reported that
`sudo -u tsldata` from their `deeks` shell was unreliable; direct commands in an
already authenticated `tsldata` shell worked. Use that shell for service
operations. Keep archive commands under `deeks`, which owns the SSO session.

The exact service-command prefix, run as `tsldata`, is:

```bash
export PM2_HOME=/storage/.pm2
pm2_archive() {
  /storage/.nvm/versions/node/v24.11.1/bin/node \
    /storage/.nvm/versions/node/v24.11.1/lib/node_modules/pm2/bin/pm2 "$@"
}
```

The verified names are `komondor-api`, `komondor-web`, `komondor-power` and
`komondor-nudge`. Use `pm2_archive restart komondor-nudge` for the reviewed
Nudge update. For the later lock window, establish fresh quiescence first, stop
Power and the API by those exact names, perform the approved lock/abort/relock
as `deeks`, then start the API and Power and verify readiness. Do not stop the
web or unrelated services. The approved lock-window pause and restart are recorded below.

Power's live database was identified from its open file descriptors as
`/storage/www/komondor-power/db/production.db`. It held 10 completed and 12 error
entries, with no unfinished tracking rows. Its production URL is
`https://power-sequences.tsl.ac.uk`, routed to port 3026.

SHA-256 matched the tested local versions of all four checked Power sources:
`komondorApiClient.ts`, `insertMetadata.ts`, `entry-monitor.ts` and
`validatePreExistingEntities.ts`. This resolves the earlier unreadable-source
gap. The live authenticated checks recorded below additionally establish the
tested behaviour of the running bundle.

## Nudge release: activated and healthy

The reviewed `a311f293f00d68736b58c4f471b7622710ecde1c` commit was transferred
in a verified Git bundle and fast-forwarded from clean `944868b`. The bundle's
SHA-256 is
`78822319dfc5045c49abf7f367662a78dd3e862f4206bed978b34dc5dff2228d`.
All three changed executable JavaScript files passed syntax checks on v1333.
No dependency installation was needed and no Git push occurred.

Before transfer, Nudge reported `dryRun: true`, cron `0 10 * * 1-5` in GMT,
24-month initial and six-month repeat intervals, and no recent running job.
Those settings must remain unchanged. Starting Nudge schedules the cron; it
does not immediately run it.

The operator restarted Nudge directly as `tsldata`: new PID 1655595, restart
count 6. At 16:01:58 UTC, `/health` and `/status` returned 200; Mongo was
connected, no stuck run was reported and all settings above were unchanged.
The checkout was clean at `a311f29`. API readiness also passed. If rollback
becomes necessary, restore `944868b` only after verifying there are no
intervening changes, restart only Nudge as `tsldata`, and recheck health. Do
not reset application records or archival state as a rollback.

## Disposable fixture preparation

The administrator session on Sequences was verified. The web group screen is
read-only, so the new group was created through the normal authenticated API
using its existing administrator login, without synthesizing a token or writing
directly to MongoDB. No password or token is saved in the evidence.

- Group: `archive_rehearsal_20261016`
- ID: `6ad2448f6516ae8815dc7559`
- Created: `2026-10-16T15:36:47.736Z`
- LDAP memberships: empty; ENA group submission: disabled.
- Root: `/mnt/reads/archive_rehearsal_20261016`; initially empty and accessible
  to `deeks` using the existing permissions.

Three synthetic files (1 KiB, 16 MiB and 64 MiB) were uploaded through the
authenticated tus endpoint, with complete offsets checked and independent
MD5/SHA-256 recorded. They were attached to the new project through the deployed project-creation
route. The project explicitly prohibits ENA publication and temporarily enabled
nudge eligibility for dry-run checks. Its nudges were disabled again after the
final AWS-state check.

- Project: `DISPOSABLE archive deployment rehearsal 20261016`
- ID: `6ad24adfe34eae4923a3cda4`
- Exact root: `/mnt/reads/archive_rehearsal_20261016/disposable_archive_deployment_rehearsal_20261016`
- Total payload: 83,887,104 bytes; three tracked additional files.

The operator authorized the single project notice **only to `deeks@nbi.ac.uk`**.
The deployed route has no per-request recipient override, so an isolated
one-shot process loaded the unchanged route and normal JWT middleware, used a
genuine live administrator login, and set `ENA_ADMIN_EMAILS` only in that
process before loading the mail module. Its listener was a private Unix socket
in the operator-only evidence directory, accepted exactly the approved request,
and then closed. No background workers or index maintenance were started.
The live service configuration was not changed. SMTP accepted one message, ID
`<8673ca21-1ab5-0751-e592-2fd12e5d1446@tsl.ac.uk>`; mailbox delivery is not
independently confirmed. No bulk nudge or other email was authorized.

## Initial HPC-state acceptance

All four applications passed the initial live checks:

- **API:** the normal running service returned the project, all three files,
  writable HPC storage and `All files present`. Independent SHA-256 checks of
  the files matched the synthetic originals.
- **Web:** the signed-in administrator saw the project, its ENA prohibition,
  all three files, HPC path/copy controls and an enabled new-sample link.
- **Power:** the operator logged in. A synthetic CSV referring to this existing
  project passed **Validate and review** and displayed zero new projects, one
  hypothetical sample/run/read. Final submission was not pressed: no child
  records or notification were created. Its 61-byte gzip input is retained at
  `/mnt/tempWebUploadToSequences/archive-rehearsal-20261016/synthetic.fastq.gz`.
- **Nudge:** deployed code ran with both environment sending disabled and an
  explicit `dryRun: true`. The injected date was 16 November 2028, making this
  new fixture old enough to test eligibility without altering its creation
  date. Audit `6ad24b2629cae84d1cf47c11` recorded `storageState: hpc`,
  `NUDGED_FIRST`, `emailSent: false`, `nudgeRecorded: false`. The complete
  fixture document was unchanged. The routine considers all projects but only
  writes its dry-run audit; no reminder email was sent.

`plan` exited zero with no anomalies: three regular files, no missing or
untracked database files, no links or special entries. The largest file is
64 MiB. Inventory content hashing is deferred to executing copy as designed.
Before the lock window, the duplicate checker again examined 3,981 runs and
found none; the backlog inspector found zero unfinished jobs.

## Lock, abort and relock: passed

The operator started the bounded pause helper under `tsldata`. It checked for
accepted Power work and API ingest/run/MD5 activity, stopped Power before the
API and confirmed both processes stopped. The pause began at 16:09:00 UTC.
The archive commands ran under `deeks` with the existing Komondor username
`admin` recorded by the CLI:

1. Lock preview passed; executing lock created migration
   `6ad24c4836ea8d5fefe06f38`, state `migrating`, phase `locked`.
2. Abort preview passed; executing `abort-before-copy` returned it to `hpc`,
   phase `aborted`, while the destination was still empty.
3. A second preview/lock created **a different migration**,
   `6ad24c613e5ebe6183c4895f`, state `migrating`, phase `locked`.

The helper restarted the API and Power at 16:10:15 UTC, **75 seconds** after
pause. API readiness passed; API PID was 1663437 and Power PID 1663466, both
online, with no reported restart failure. Web, Nudge and unrelated services
were not stopped. The helper also had a ten-minute automatic-restart deadline
in case the connection was lost. Non-secret window evidence is under
`/var/tmp/komondor-stage3-lock-window-20261016/`.

### Migrating-state acceptance

- API returned the three files and HPC as the current authoritative location,
  with the planned S3 destination explicitly separate. HPC reconciliation was
  `NOT_APPLICABLE`; a normal authenticated sample-creation attempt returned
  409 `PROJECT_STORAGE_READ_ONLY` before any sample creation or email.
- Web displayed **Moving to AWS**, the write-protection explanation, all three
  files and the planned S3 location labelled **not yet verified**. The new
  sample link was absent; accession editing remained available.
- Power rejected the same otherwise-valid CSV specifically because this
  project was `migrating`; it did not reach submission.
- Nudge dry-run audit `6ad24c74b1427462fc316143` recorded the migrating state
  while preserving the same eligibility decision. No email/nudge was written
  and the project document was unchanged.

The copy/interruption/resume test passed under the same migration. Its
private AWS configuration limits only this test upload to 1 MiB/s, one request
at a time and 8 MiB multipart chunks, using the production mover's existing
SSO session. These use the documented
[AWS CLI transfer controls](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html).
The main AWS profile is unchanged. The runner waits for a completed multipart
part, kills only its own dedicated copy process group, verifies no child is
still active, and invokes the normal resume command.

It interrupted the 64 MiB file after one 8 MiB part had reached S3. Resume
completed at **16:13:44 UTC**, verified all three files and moved the project to
`aws_pending_hpc_deletion` / `verified`, with `resumeCount: 1`. The process kill
left its earlier multipart upload behind, as expected when error cleanup cannot
run. The operator evidence identified that exact upload ID and initiator; only
that abandoned upload was aborted. A subsequent listing showed no multipart
uploads. Completed S3 objects were untouched.

The test wrapper initially tried to parse the entire copy output as JSON,
including its human-readable progress line. The real resume command had already
exited zero. Its final JSON and an independent `status` check established the
successful result; no copy or resume was repeated. The wrapper parser was
corrected. This was an evidence-collection error, not an archive failure.

The sealed control records were downloaded and their SHA-256 checked against
Mongo's recorded digests:

- Source manifest: `3fab9573837769006615b7f6a8b56b7996043d8794555430468d9af76962e07c`
- Verification report: `4e68e7e0abc9f1297d4b7f34a2223b03710d9cbb0929350fec36616b58391847`

### Pending-deletion acceptance and manual checkpoint

API returned S3 as authoritative, three retained file records and
`NOT_APPLICABLE` HPC reconciliation; sample creation returned 409. Web showed
**Copied to AWS · HPC cleanup pending**, the S3 root, S3 file-copy controls and
no new-sample link. Power rejected the same valid CSV specifically for
`aws_pending_hpc_deletion`. Nudge audit `6ad24d9a683a51703fabdac7` recorded that
state with unchanged eligibility, no sent email and no recorded nudge.

The Web copy button displayed a success toast, but the browser tool returned
an empty clipboard, so clipboard contents are **not independently verified**.
The displayed root and API file locations were checked; local component tests
cover the file-path construction.

Adding a new synthetic probe file caused `deletion-command` to exit 1 with
`HPC tree drifted after verification` and no deletion command. The operator
removed only that exact self-created probe after checking its contents. A fresh
check then exited zero and printed the exact disposable-root command. The
sealed payload files were untouched during the refusal test.

### Manual deletion and final AWS-state acceptance: passed

The operator ran the generated command in their `tsldata` terminal and reported
completion. An independent check found the exact root absent while its mounted
parent remained accessible. `confirm-absent` preview and execution both passed;
the final state is `aws`, phase `completed`, with `hpcVerifiedAbsentAt` and
`archivedAt` equal to **`2026-10-16T16:18:07.457Z`**. Final `status` confirms three
owned S3 objects, both control records, no foreign objects or incomplete uploads,
and `hpcExists: false`. No scientific project's source was deleted.

- **API:** all three additional-file records remain; S3 is authoritative, HPC
  reconciliation is `NOT_APPLICABLE`, and sample creation returns 409
  `PROJECT_STORAGE_READ_ONLY`.
- **Web:** the project list and detail page show **Archived in AWS**. All three
  file records, S3 location controls and publication metadata remain visible;
  the new-sample link is absent and accession editing remains available.
- **Power:** the same CSV is rejected specifically because project storage is
  `aws`; validation never offers final submission.
- **Nudge:** dry-run audit `6ad24e489eb23280a4df9e7d` records `storageState: aws`
  with the same `NUDGED_FIRST` eligibility, `emailSent: false`,
  `nudgeRecorded: false`, and an unchanged fixture document.

The normal authenticated metadata route then set this synthetic project's
`nudgeable` to `false`, preventing future reminders. Read-back confirmed it
remains ENA-prohibited, archived and retains all three file records. At
**16:18:55 UTC**, API readiness and Nudge health passed, and Web and Power
returned HTTP 200. The bounded maintenance helper and copy runner have exited.

## Coverage limits and next approval boundary

This fixture contains **project additional files, zero samples and zero runs**.
Power exercised validation and review only; no CSV entry was finally submitted.
The live checks therefore establish project-level behaviour in every storage
state, not every inherited sample/run screen or a representative scientific
Read tree. Local tests cover those guards and inheritance. The separately
approved small real pilot must additionally inspect existing sample/run/read
views and their file locations, retaining HPC originals through review. The
clipboard read-back limitation above also remains explicit.

Cold restore and long-transfer credential renewal passed in earlier stages;
this Stage 3 project itself was not restored again. Passing these rehearsals
does not authorize a real-project lock, transfer or deletion. Stop here until
the operator selects and approves the next pilot. See the
[deployment procedure](../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md#6-disposable-project-then-first-real-pilot)
and [per-project runbook](../S3_PROJECT_ARCHIVAL_RUNBOOK.md#archive-one-project).

## Completed AWS test-access cleanup

The sole `KomondorArchiveRenewalTest` assignment was removed after the completed
renewal test. AWS deletion request
`0bfa79ce-cf85-452b-af5a-accd51cfd8e2`, created at
`2026-10-16T15:31:57.879Z`, returned `SUCCEEDED`; a subsequent assignment listing
was empty. This used the documented
[assignment deletion/status workflow](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/delete-account-assignment.html).

The empty permission set and test evidence were retained. No S3 objects were
deleted. The production mover assignment was not changed; at 15:33 UTC its STS
identity and expected-owner bucket check still succeeded. The completed Stage 2
monitor remains paused.

## Evidence locations

Local operator evidence:

```text
/Users/deeks/.codex/artifacts/archive-stage3-20261016/
```

This holds the operator report transcribed from their pasted output (the `tee`
write failed, but the inspector completed), source hashes, release transfer log,
AWS removal record/screenshot, all four API/Nudge state receipts, Web/Power
screenshots, CLI lifecycle logs and final health evidence. The service inspector
contains only read-only operations and prints selected non-secret fields, not
PM2 environments.

Server fixture receipts:

```text
/storage/komondor-archive-rehearsals-deeks/stage3-20261016/
```

The readable release bundle and service inspector are under
`/storage/komondor-archive-stage3-20261016/`. These local/server records still need
the agreed durable shared evidence destination before operational handover.

For repository-only review, [the evidence directory](evidence/stage3-20261016/)
contains byte-preserved copies of both sealed S3 control records, final CLI
status, final health/fixture state, and a compact acceptance summary with hashes
of the supporting operator records and screenshots. This subset contains only
synthetic-project evidence, no credentials; it is not a replacement for retaining
the full operational record. The two control-record digests match Mongo's
recorded values shown above.
