# Review: HPC preservation feature — 13–14 November 2026

Independent review by Claude of the `preserveOnHpcUntil` feature, run locally on
the Mac mini in detached worktrees. Review only: nothing was merged, deployed or
changed in production.

| Repo | Branch | Reviewed head |
| --- | --- | --- |
| komondor-api | `codex/archive-hpc-retention-20261113` | `41284ef` (plus docs commits `0eaeffe`, `d7160fe`) |
| komondor-web | `codex/project-hpc-preservation-20261113` | `5e7bcf2` |

Both branches were based on the then-current `origin/master` (API `ef14cba`,
web `e9e183c`), and none of their commits were merged at review time.

**Verdict: no merge blockers.** One operational step is required before deletion
review begins, and four optional improvements are listed below. The
[per-Project deletion checklist](HPC_DELETION_CHECKLIST.md) turns these findings
into gates.

## Checks run

| Check | Result |
| --- | --- |
| API unit/contract suite (`jest`, `MONGODB_URI` unset) | 2,193 passed, 79 suites |
| Integration: `archive-cli`, `project-hpc-preservation` | 13 passed |
| Web tests (`vitest run`) | 599 passed, 25 files |
| Web production build (`nuxt build`) | passed |
| Probes of stored-value handling through the real `Project` model | findings 2 and 3 |

Dependencies came from the existing lockfiles (`yarn install --frozen-lockfile`);
neither lockfile changed. Integration tests and probes used a throwaway `mongod`
on `127.0.0.1:27999` with its own data directory, never the Homebrew or
production database.

## Required before deletion review

**1. The five manual holds are not enforced by code.** `hpc-retention-holds.json`
is read by people only. Until each held Project carries a preservation date,
`deletion-command` prints a command for it. Fix: after deployment, set
`preserveOnHpcUntil` on Gargy and the four Gulnara sources (far-future dates for
open-ended holds) and keep the register as the reason. This is an operational
step, not a code change.

## Optional improvements

**2. A malformed stored date is invisible in the UI and cannot be repaired there.**
`models/Project.js:67` and `lib/storage-state.js:144` serialise it as `null`, so the
web's "needs administrator attention" notice (`components/storage/ProjectStorage.vue:54`)
can never show. An administrator's save sends `expected: null`, which does not
match the stored non-date value (`routes/projects.js:239`), so it always returns
409. The CLI still refuses deletion, so it fails safe. Fix: expose an `invalid`
flag to the web, and allow an administrator to overwrite a non-date value.

**3. Mongoose casts some hand-edited values instead of rejecting them**
(`lib/hpc-preservation.js:22`). Probed through the real model:

| Stored value | Resolves as |
| --- | --- |
| `""` | no hold |
| `0` | expired (1970) |
| `"2027-01-01"` | active until midnight, not end of day |
| `"not-a-date"`, `true`, `false`, `{}`, `[]` | invalid: deletion blocked |

Only a manual database edit can produce these. Fix: have the CLI check the raw
BSON type (date or absent) before printing a deletion command. The checklist's
`$type` query covers this meanwhile.

**4. The API accepts any canonical timestamp**, including past dates and times
other than end of day (`routes/projects.js:230`). Only the web enforces "through
23:59:59.999 UTC". A scripted call with `T00:00:00.000Z` ends the hold a day
early. Fix: require the `T23:59:59.999Z` suffix, or state it in `openapi.yaml`.

**5. "Contact George Deeks" gives no contact method**
(`components/storage/ProjectStorage.vue:46`). An email link would help readers.

## Verified correct

- **Authorisation and integrity.** Only `isAdmin === true` users may write,
  stricter than the shared middleware. Unknown fields return 400; timestamps
  must be canonical UTC and real calendar dates. The update is conditional on
  the previous value (409 on a stale page) and appends a private history entry
  (`select: false`, removed by `toJSON`). The reconciliation guards permit it,
  and retired Projects return 404. Project creation accepts a fixed field list,
  so neither the date nor its history can be injected there.
- **Visibility.** Every reader sees the date and the notice; only administrators
  see the form.
- **Archive lifecycle.** A top-level field, independent of `storage.*` and
  `archiveMigration.*`; no archive transition writes it.
- **Dates.** The web turns a calendar date into `T23:59:59.999Z` and formats with
  `timeZone: "UTC"`, so British Summer Time cannot shift the displayed day.
  Expired dates are labelled without implying deletion.
- **HPC indicator.** "Present" means a directory exists, and the page says file
  contents were not checked. A missing path, unreadable mount or path outside
  storage is *unknown*. *Absent* appears only in state `aws` with a recorded
  `hpcVerifiedAbsentAt`. Project paths that differ from the sealed
  `sourceRelativeRoot` also show *unknown*.
- **AWS indicator.** "Verified" requires state `aws` or
  `aws_pending_hpc_deletion`, a recorded `s3VerifiedAt` and an `s3://` URI. The
  page never contacts S3.
- **Deletion safeguards.** Only `lib/s3-archive/cli.js` writes
  `hpcVerifiedAbsentAt` or prints `rm`.
  - `deletion-command` refuses at the start, before any AWS call, then reloads
    the Project after its long checks and refuses again if the date or archive
    identity changed.
  - `confirm-absent` checks at the start, rechecks, and includes the date in its
    final conditional update.
- **Archived-project write restrictions.** Unchanged; `routes/runs.js` only adds
  the field to a projection.
- **Gargy test instructions** ([GARGY_HPC_PRESERVATION_TEST.md](GARGY_HPC_PRESERVATION_TEST.md)).
  Identity matches the 3 November register. The date is saved before the
  optional refusal test, and the refusal happens before any AWS call or tree
  walk.

## Not verified

- What the presence check reports on v1333: that `DATASTORE_ROOT` is the reads
  mount, and that `/mnt/reads` and `/tsl/data/reads` hold the same tree.
- That George's production token carries `isAdmin: true`. Without it the form
  does not appear; the API returns 403.
- The page in a browser. Only component tests and the production build ran.
- The contents of the transfer evidence files added in `d7160fe`.

## Deployment note

Deploy the API before the web. Against the old API, the new page's save returns
an error and the location box falls back to *unknown*.
