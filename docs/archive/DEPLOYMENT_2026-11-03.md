# Production deployment — 3 November 2026

**Completed:** all four Komondor services on v1333 now run their GitHub default
branch, and API, Web and Nudge were restarted onto it. No database, filesystem
data, S3 object or archive/disposal state was changed. The archive mover was not
running at any point.

## Released heads

| Repo | Before (checkout on host) | After | Restarted |
| --- | --- | --- | --- |
| komondor-api | `4bb4f36` on branch `codex/reconcile-archive-catalogue`; local `master` at `c6b9d77` | `4bb4f36` `master` | 15:01:58 UTC, PID 1116505 |
| komondor-web | `e9e183c` on branch `codex/reconcile-archive-locations` (not on GitHub) | `e9e183c` `master` | 15:03:23 UTC after `nuxt build`, PID 1121021 |
| komondor-power | `d98fab1` `main` | `d98fab1` `main` | no (unchanged) |
| komondor-nudge | `a311f29` `master` (not on GitHub; diverged from `origin/master`) | `3791969` `master` | 15:07:09 UTC, PID 1131440 |

The previous API release was `27b9803`, deployed for the
[22 October reconciliation](batches/2026-10-16/reconciliation-production-2026-10-22/README.md)
and retained on GitHub as branch `codex/archive-production-27b9803`.
`git diff 4bb4f36 27b9803 -- . ':!docs'` is empty, so this deployment changed no
API code: models, guards, routes, scripts and dependency files are identical.
`4bb4f36` is the same work rebased onto the published history.

## Unpublished production commits

Two repositories were running commits that existed only on the host.

- **Web** `d1b96a0` and `e9e183c`: archive-view tests, and copy-path buttons in
  `ReadList.vue`/`AdditionalFileList.vue` that use the API's `file.locationUri`
  (set by `lib/physical-file-path.js`) instead of rebuilding `rawUri +
  originalName`. Pushed from the host, reviewed, 564 Vitest tests passing, and
  fast-forwarded into GitHub `master`. The host's `.nuxt` build was dated
  22 October 22:05, after that commit, so the old process was probably already
  serving it; it was rebuilt and restarted anyway.
- **Nudge** `a311f29`: storage state in nudge audit output. GitHub `master`
  `3791969` independently carries the same feature (same read-only schema
  fields, same decision field) plus formatting and more tests, 111 Jest tests
  passing, with no dependency change. The host was reset to `origin/master`.
  `a311f29` is retained on GitHub as branch `prod-nudge-2026-11-03`.

## Repository ownership fix

`git pull` as `deeks` failed with `insufficient permission for adding an object`:
815 files under `komondor-web/.git` were owned by `tsldata:NBIP_GNRC`, a group
`deeks` is not in. The API, Web and Nudge checkouts were changed to a shared
group with setgid directories and `core.sharedRepository=group`, so `deeks` and
`tsldata` can both fetch, pull and check out. Verified afterwards: `.git/objects`
is `drwxrwsr-x` (or wider) in group `linux_admin_v1333`, zero non-group-writable
directories under `.git`, and `git fetch` as `deeks` succeeded in all three.

Git on the host pages `git log` output through `less`; use `--no-pager` in
commands whose output is to be pasted.

## Procedure

Git operations ran as `deeks`. Service operations ran in an authenticated
`tsldata` shell using the PM2 prefix from the
[Stage 3 service-control record](STAGE3_APPLICATION_REHEARSAL_2026-10-16.md#readiness-and-service-control)
(`PM2_HOME=/storage/.pm2`). Order: API first, then Web, then Nudge.

1. Pre-check as `deeks`: `pgrep -af move-project-to-s3` returned nothing.
2. API: `yarn install --frozen-lockfile --production` (adds `bson@1.1.6` from
   this release), `pm2 restart komondor-api`.
3. Web: `yarn build` (Nuxt client and server compiled without errors),
   `pm2 restart komondor-web`.
4. Nudge: `pm2 restart komondor-nudge`.

`images` (PM2 id 3) and `pm2-logrotate` were not touched.

## Post-restart checks

- **API:** `Connected to MongoDB` 15:02:04, cron jobs initialised, ingest worker
  `v1333:1116505:c0fc26a586a41959` started, `API running on 0.0.0.0:3061`,
  initial MD5 verification idle. No errors after the restart. The
  "28 in-flight uploads reserved" line matches the finished-but-unattached blobs
  the nightly sweep already reports.
- **Web:** `Listening on: http://localhost:3060/`, empty error log.
- **Nudge:** connected to Mongo, **dry-run mode** (no email sent, no nudge
  recorded), cron `0 10 * * 1-5` GMT, health on `localhost:3128/health`. The same
  morning's run had considered 366 projects with 0 errors.

Warnings seen, none blocking:

- API: `READS_ROOT_PATH` is unset, so `locationUri` and other HPC display paths
  use the default `/tsl/data/reads`. That is the correct root on this host;
  pinning it in `.env` would remove the dependency on the default.
- API: SMTP TLS verification disabled for `mail.nbi.ac.uk` (pre-existing).
- API and Nudge: Mongoose/driver deprecation warnings (pre-existing).
- Web build: stale `caniuse-lite`/`baseline-browser-mapping` data, bundle-size
  warnings (pre-existing).

## Not done

- No database reconciliation. *Correction:* the first version of this note said
  `reconcile-archive-database.js apply` had not been run. It had: the 26,724-operation
  plan was applied and independently verified on 22 October
  ([receipt](batches/2026-10-16/reconciliation-production-2026-10-22/completed.json)),
  followed by the 69-operation
  [Project 2178 consolidation](batches/2026-10-16/project-2178-consolidation-2026-10-22/README.md).
  That evidence was unpublished when this note was first written. Do not rerun the
  old plan; any further corrections need a fresh preview against live data.
- All 175 batch Projects (13.45 TB) were S3-verified by 2 November 20:55 GMT
  ([completion receipt and supporting evidence](evidence/transfer-completion-20261103/README.md)).
  HPC deletion review is the next archive step; the
  pre-deletion hold was set to zero by George on 23 October once the pilot restore
  passed.
- No HPC deletion and no `confirm-absent`. The four Lichen CoCulture source
  projects stay on HPC until the
  [Gulnara ENA reassignment](GULNARA_ENA_REASSIGNMENT_2026-10-30.md) copy is done.
- The Mac mini's `komondor-web` checkout has an uncommitted change to
  `tests/unit/pages/projects-new.test.js` of unknown origin; it is not part of
  this release.
