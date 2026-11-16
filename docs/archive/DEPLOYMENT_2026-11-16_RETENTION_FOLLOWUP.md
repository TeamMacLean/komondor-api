# Deployment — HPC retention follow-up, 16 November 2026

**Pending.** This records the procedure Claude supplied for the second
16 November deployment. Update it with what George observes.

| Repo | Before (production) | After (master) | Restart |
| --- | --- | --- | --- |
| komondor-api | `f2e464c` | master: `7225374` plus documentation commits | yes, **first** |
| komondor-web | `5e7bcf2` | `92d6794` | yes, after `yarn build` |
| komondor-power | `d98fab1` | unchanged | no |
| komondor-nudge | `3791969` | unchanged | no |

## What ships

- **API.** The [retention follow-up](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md)
  as [reviewed](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md):
  - requester and reason for keep dates;
  - raw BSON date safeguards and repair;
  - computed archive and deletion-review dates;
  - `scripts/hpc-deletion-due-report.js`;
  - the documents since `f2e464c`.
- **Web.** Four changes:
  - the home page projects sidebar tidy-up (`c80879c`);
  - the borderless three-column project layout (`a82a65d`);
  - the retention follow-up (`ed9be93`, `1e9f04f`);
  - a test-only commit for ENA admin project creation (`92d6794`).
- **Compatibility.** The new API rejects keep-date saves from the old web
  (HTTP 400), so deploy both in one sitting, API first
  ([BREAKING_CHANGES.md](../../BREAKING_CHANGES.md)).
- **Dependencies.** No dependency or lockfile changes since production.
- **No data changes and no migration.** No keep date was set before this
  deployment.

## Settings

| Setting | Where | Needed for | Notes |
| --- | --- | --- | --- |
| `HPC_RETENTION_YEARS` | API `.env` | nothing | Leave unset for 5. An empty or invalid value stops the API starting |
| `HPC_RETENTION_CONTACT_EMAIL` | web `.env` | the `mailto:` contact link | Read when the web starts; unset shows the name without a link |
| `HPC_DUE_REPORT_TO` | API `.env` | report `--email` only | Comma-separated; read when the report runs, so no restart is needed |

`WEB_APP_URL`, which the report uses for project links, is already required by
the API's startup check.

## Procedure

As `deeks`:

1. Check no archive command is running: `pgrep -af move-project-to-s3`.
2. In each checkout, confirm `git status` is clean on `master`, then run
   `git pull --ff-only`.

As `tsldata`, with the PM2 prefix from the
[Stage 3 record](STAGE3_APPLICATION_REHEARSAL_2026-10-16.md#readiness-and-service-control):

1. `restart komondor-api`, then check its log.
2. `yarn build` in komondor-web, then `restart komondor-web`.

## Checks to record

- **API log:** `Connected to MongoDB` and `API running on 0.0.0.0:3061`. No
  `Refusing to start`.
- **Web log:** `Listening on: http://localhost:3060/`.
- **Project page:**
  - the three columns: details, HPC, and AWS when archived;
  - the retention explanation and the AWS-move and deletion-review dates.
- **Archived project:** the New buttons show disabled, with the reason beside
  them.
- **Admin form:** shows Requested by, Reason, and a separate release reason
  for clearing.
- **Type check:** the checklist's read-only check still returns `[]`.
- **Git:** both production checkouts report `## master...origin/master` with no
  other lines.

## Rollback

API and web go back together.

1. As `deeks`: `git checkout f2e464c` in komondor-api and
   `git checkout 5e7bcf2` in komondor-web.
2. As `tsldata`: restart the API, rebuild the web, then restart the web.

Requester, reason and history saved by the new version stay in the database.
The old code ignores them.
