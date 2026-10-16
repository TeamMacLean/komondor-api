# Stage 3 application rehearsal — 16 October 2026

**In progress, not production acceptance.** The operator explicitly approved
Stage 3: deploy the reviewed Nudge change, exercise a fresh disposable project
through the archive workflow and check the applications. Real-project archival
and deletion require a later approval. The final disposable-root deletion also
remains a manual operator checkpoint.

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
web or unrelated services. No API/Power stop has yet been performed in Stage 3.

Power's live database was identified from its open file descriptors as
`/storage/www/komondor-power/db/production.db`. It held 10 completed and 12 error
entries, with no unfinished tracking rows. Its production URL is
`https://power-sequences.tsl.ac.uk`, routed to port 3026.

SHA-256 matched the tested local versions of all four checked Power sources:
`komondorApiClient.ts`, `insertMetadata.ts`, `entry-monitor.ts` and
`validatePreExistingEntities.ts`. This resolves the earlier unreadable-source
gap. Live authenticated behaviour still needs verification; source identity
alone is not proof that every deployed bundle behaves correctly.

## Nudge release: files transferred, activation pending

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

At the latest process check, the old PID 23856 was still running. The operator
has been given the exact Nudge restart command. Activation and post-restart
health/configuration checks are still pending. If the new release fails,
restore `944868b` only after verifying the checkout contains no intervening
changes, restart only Nudge as `tsldata`, then inspect its health. Do not reset
application records or archival state as a rollback.

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
MD5/SHA-256 recorded. They are staged for attachment to the new project, not
archived. The planned project name is
`DISPOSABLE archive deployment rehearsal 20261016`. It will explicitly prohibit
ENA publication and temporarily enable nudge eligibility for dry-run checks;
disable that fixture's nudges again before closing the rehearsal.

**No project has yet been created or locked.** Normal project creation sends
one overseer notice to the configured ENA administrators. Approval for that
single synthetic-project notice is pending. No bulk nudge or other email is
authorized. The Power login and Nudge restart are also pending operator input.

After creation, retain `plan` and verify the exact project root before any
mutation. Exercise the documented dry runs, lock, pre-copy abort, relock,
copy/interruption/resume, refusal of deletion with an added file, manual
disposable-root deletion and `confirm-absent`. Check API/Web/Power/Nudge in all
four states. See the [deployment procedure](../S3_PROJECT_ARCHIVAL_DEPLOYMENT.md#6-disposable-project-then-first-real-pilot)
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
AWS removal record/screenshot, production health/access results and fixture
preparation log. The service inspector contains only read-only operations and
prints selected non-secret fields, not PM2 environments.

Server fixture receipts:

```text
/storage/komondor-archive-rehearsals-deeks/stage3-20261016/
```

The readable release bundle and service inspector are under
`/storage/komondor-archive-stage3-20261016/`. These local/server records still need
the agreed durable shared evidence destination before operational handover.
