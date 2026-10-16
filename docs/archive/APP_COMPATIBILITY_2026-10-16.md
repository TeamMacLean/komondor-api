# Archive application compatibility — 16 October 2026

Stage 1 was approved for application checks while the operator copied a database
dump. Local automated checks passed. Production checks were read-only. This is
evidence for proceeding to the next approved rehearsal stage, not completed
production acceptance or permission to delete source data.

## Versions and results

All local checks used Node `v24.11.1`, matching v1333. No production database,
live email delivery or S3 transfer was used by the tests.

| App | Production checkout | Locally tested code | Result |
| --- | --- | --- | --- |
| API | `c6b9d77` | `1ad0bec` (documentation-only change after `c6b9d77`) | 436 tests, 8 suites |
| Web | `beb0b95` | `d1b96a0` (tests only) | 74 tests, 7 suites |
| Power | `d98fab1` | `d98fab1`, unchanged | 118 tests, 5 suites |
| Nudge | `944868b` | `a311f29` | 114 tests, 7 suites |

The web and Nudge commits are local on `master`; neither was pushed or deployed.
Power remains unchanged on `main`. API changes in this stage are documentation.
The Nudge checkout was cloned from v1333 because no local copy existed. Its
`origin` is the production checkout, not GitHub; do not push to it.

## Behaviour checked

**API:** storage summaries and legacy defaults, Project storage persistence,
write refusal for locked/archived projects, skipped ingest/checksum work, and
project/sample/run routes. These focused suites use mocked dependencies; they
do not establish authenticated acceptance against the running service.

**Web:** valid summaries for `migrating`, `aws_pending_hpc_deletion` and `aws`
block the new-sample/new-run pages and prevent live run polling. Project, sample
and run detail views retain database file records when HPC reconciliation is
inapplicable. Mounted file-list components show recorded checksum history,
copy the authoritative HPC path or S3 URI, expose no direct download links in
the tested locked states, and do not describe empty archived lists as missing
HPC data. Storage badges, invalid summaries and API errors are also covered.
Tests run in jsdom with mocked API responses and stubbed UI widgets; a live
browser walkthrough remains part of disposable-project acceptance.

**Power:** CSV validation rejects all three non-HPC states for existing projects
and samples. Tests cover contradictory/unknown storage summaries, a storage
409 after initial validation, stopping further creates and run polling, and
avoiding retries or unsafe resubmission advice for these failures. The CSV
pipeline tests use a mocked API, not a production CSV submission.

**Nudge:** first and repeat publication reminders remain eligible in all four
storage states under the existing rules; `nudgeable: false` still suppresses
them. Real MongoDB fixtures verify storage fields, unknown future metadata and
`archiveMigration` survive nudge updates unchanged. Reading, saving or creating
a legacy project does not insert storage defaults. Email delivery is mocked.

Nudge previously omitted storage state from its audit records and hydrated
Project read model. The local change declares optional read fields with no
defaults, records the observed state on decisions, and displays it in the audit.
It does not change eligibility or email content. Old decisions retain no claimed
historical state. The six new tests initially reproduced the missing fields;
the final full suite passed. After making fixture timestamps consistent with
each lifecycle state, those six tests were rerun and passed again.

## Read-only production evidence

Observed at `2026-10-16T10:21:26Z` using the existing SSH connection as `deeks`:

- API `http://127.0.0.1:3061/ready`: HTTP 200; MongoDB, datastore, transfer and
  upload directories, and ingest worker checks passed.
- Nudge `http://127.0.0.1:3128/health`: HTTP 200; database connected, no stuck
  runs, last successful scheduled run at `2026-10-16T10:00:00Z`. The check did
  not trigger a nudge run or email.
- SHA-256 matched all ten selected web source files: the storage helper,
  badge/notice, both file-list components, three detail pages and two create
  pages. The deployed client bundles contain archive labels and the storage
  read-only error handling.
- Power's existing-entity validator source matched. `deeks` cannot read
  `server/utils/komondorApiClient.ts` or
  `server/services/csvOrchestrator/insertMetadata.ts`. The readable compiled
  `chunks/nitro/nitro.mjs` contains the storage read-only error, unknown-state
  refusal and stop-create/polling handling. This is partial deployment evidence,
  not a complete source/build identity check; some bundled dependency files
  are also unreadable.

No project was locked, uploaded, archived or deleted. No service was restarted,
no code was deployed, no production nudge command was run, and no production
database test fixture was created. The operator's database dump was not used.

Local evidence is retained at:

```text
/Users/deeks/.codex/artifacts/archive-stage1-20261016/
```

It contains `production-read-only.json`, four test logs and Nudge's final
targeted rerun log. This is local operator evidence, not yet a durable shared
acceptance archive.

## Reproduce the local checks

Use Node `v24.11.1` and each repository's installed lockfile dependencies. Run
from each named checkout. Nudge uses a disposable MongoDB started by its test
helper with MongoDB `5.0.19`; do not supply production database configuration.
An initial test attempt hit a MongoDB startup timeout; subsequent full and
targeted runs passed. No production restart or database workaround was used.

API:

```bash
node_modules/.bin/jest --runInBand \
  __tests__/lib/storage-state.test.js \
  __tests__/models/ProjectStorage.test.js \
  __tests__/lib/ingest-queue.test.js \
  __tests__/lib/md5-verification.test.js \
  __tests__/routes/runs.test.js \
  __tests__/routes/samples.test.js \
  __tests__/routes/projects.test.js \
  __tests__/routes/_utils.test.js
```

Web:

```bash
node_modules/.bin/vitest run \
  tests/components/StorageBadge.test.js \
  tests/components/archive-file-lists.test.js \
  tests/unit/pages/archive-details.test.js \
  tests/unit/pages/storage-read-only.test.js \
  tests/unit/pages/run-verification.test.js \
  tests/unit/utils/storageState.test.js \
  tests/unit/utils/apiError.test.js
node_modules/.bin/eslint tests/components/archive-file-lists.test.js \
  tests/unit/pages/archive-details.test.js \
  tests/unit/pages/storage-read-only.test.js
```

Power:

```bash
node_modules/.bin/vitest run \
  tests/unit/preExistingEntities.test.ts \
  tests/unit/insertMetadata.storageReadOnly.test.ts \
  tests/unit/komondorApiClientRetry.test.ts \
  tests/unit/komondorApiErrorMessage.test.ts \
  tests/integration/csvValidationPipeline.test.ts
```

Nudge:

```bash
MONGOMS_VERSION=5.0.19 node_modules/.bin/jest --runInBand --silent
```

## Next approval boundary

The operator asked for a green light before each new stage. Stop after these
checks. The Nudge audit improvement awaits an explicitly approved deployment.
The next separate rehearsal is real S3 conditional-write refusal, interrupted
transfer/resume and credential renewal across expiry (allow roughly two to
three hours, mostly unattended, subject to obtaining a separate test profile).
Do not shorten the production role's session duration for that test.

Live checks through every storage state belong to a newly created disposable
project with an agreed writer pause. See the
[remaining production acceptance gates](PRODUCTION_ACCEPTANCE_2026-10-16.md#still-required).
