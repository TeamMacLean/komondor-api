# Deployment — 16 November 2026

George deployed the merged HPC preservation feature to v1333 on 16 November,
using the commands Claude supplied. George reported the deployment complete.
Claude has not seen the post-restart logs, so the checks below are what to look
for, not observed results.

| Repo | Before | After | Restarted |
| --- | --- | --- | --- |
| komondor-api | `4bb4f36` | `f2e464c` (master) | yes |
| komondor-web | `e9e183c` | `5e7bcf2` (master) | yes, after `yarn build` |
| komondor-power | `d98fab1` | unchanged | no |
| komondor-nudge | `3791969` | unchanged | no |

## What changed

- **API.** The `preserveOnHpcUntil` keep date, the read-only HPC/AWS location
  observations and the CLI deletion refusals (`41284ef`). Also included:
  - the consolidation CLI option check (`26429e1`);
  - the transfer completion evidence;
  - the review, checklist and spec documents.
- **Web.** Separate HPC and AWS boxes on the project page, and the
  administrator keep-date form (`5e7bcf2`).
- **No dependency or lockfile changes, and no new required settings.** The
  presence check uses the existing `DATASTORE_ROOT`. Displayed HPC paths use
  `READS_ROOT_PATH`, which is unset, so they use the default `/tsl/data/reads`.
- **No data was changed by the deployment.** No keep date has been set yet.

## Procedure

As `deeks`:

1. Check that no archive command is running: `pgrep -af move-project-to-s3`.
2. Run `git pull --ff-only` in both checkouts.

As `tsldata`, with the PM2 prefix from the
[Stage 3 record](STAGE3_APPLICATION_REHEARSAL_2026-10-16.md#readiness-and-service-control):

1. `restart komondor-api`.
2. `yarn build` in komondor-web, then `restart komondor-web`.

Power, Nudge and `images` were not touched.

## Checks to record

- API log shows `Connected to MongoDB` and `API running on 0.0.0.0:3061`, with
  no new errors.
- Web log shows `Listening on: http://localhost:3060/`.
- An archived project page shows "Verified in AWS". The HPC box says either
  "On HPC (directory present)" or "HPC presence unknown". If it says *unknown*
  everywhere, check the mount roots, as in the
  [checklist](HPC_DELETION_CHECKLIST.md).
- George sees the keep-date form as an administrator.
- The checklist's read-only type check returns `[]`.

## Rollback

1. As `deeks`: `git checkout 4bb4f36` in komondor-api and `git checkout e9e183c`
   in komondor-web.
2. As `tsldata`: restart the API, rebuild the web, and restart the web.

Keep dates already saved stay in the database, but the old code ignores them.
