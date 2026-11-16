# Spec: HPC retention follow-up — 16 November 2026

Written by Claude from George's decisions, for ChatGPT/Codex to implement. It
builds on the `preserveOnHpcUntil` feature, which was merged and deployed on
16 November: production runs API `f2e464c` and web `5e7bcf2`
([record](DEPLOYMENT_2026-11-16.md)).

**Status:** implemented, reviewed and merged to master on 16 November
([review](HPC_RETENTION_FOLLOWUP_REVIEW_2026-11-16.md)); deployment pending
([procedure](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)).

Read first: [HPC_RETENTION.md](HPC_RETENTION.md), the
[feature review](HPC_PRESERVATION_REVIEW_2026-11-14.md) and the
[deletion checklist](HPC_DELETION_CHECKLIST.md).

## Policy (George, 16 November)

1. **Back up to AWS early, delete from HPC cautiously.** A keep date
   (`preserveOnHpcUntil`) blocks HPC deletion only. It never blocks copying to
   AWS. Copying makes a project read-only in Komondor, and that is intended.
2. **Projects move to AWS once five years old.** Age counts from the later of
   the Project's `createdAt` and the `createdAt` of its newest Run (Run → Sample
   → Project). If `createdAt` is missing, use the ObjectId timestamp. Make
   "five years" a single setting (`HPC_RETENTION_YEARS`, default 5).
3. **Exceptions are keep dates set by an administrator.** People email George;
   he approves by hand and records the date, who asked and why. There is no
   self-service request or approval flow.
4. **Expiry permits deletion review only.** Nothing is deleted automatically.
5. **One email to George, twice a year,** listing every project whose HPC copy
   is due for deletion within six months or already overdue. George writes any
   owner emails himself; the system emails nobody else.

## 1. Read-only projects: disabled buttons that explain why (web)

Today a read-only project shows `StorageReadOnlyNotice` on the project, sample
and run pages, and *hides* its action buttons:

- New sample: `components/samples/SampleList.vue:34`
- New run: `components/runs/RunList.vue:34`
- Clone data for new Run: `pages/run.vue:84`
- Other controls hidden by `!readOnly` (audit `AdditionalFileList.vue`,
  `ReadList.vue` and the pages for any more)

Change the action buttons to show **disabled**, with a tooltip that gives
`storageReadOnlyMessage(storage)` (`utils/storageState.js:108`). Keep the
banner. Hint text that only describes how to add files may stay hidden.

- A disabled button emits no mouse events, so put the `b-tooltip` on a wrapper.
  A `nuxt-link` cannot be disabled, so render a disabled `b-button` instead.
- Make the reason reachable without hovering, for touch screens and screen
  readers, for example with `aria-describedby`.
- Keep the existing refusals: `pages/samples/new.vue:193`,
  `pages/runs/new.vue:338`, and the API's `assertProjectAcceptsHpcWrites`. The
  buttons only improve the interface; they are not the safeguard.

## 2. Record who asked for a keep date and why (API + web)

Add two top-level Project fields beside `preserveOnHpcUntil`:

| Field | Type | Rule |
| --- | --- | --- |
| `hpcPreservationRequestedBy` | String, ≤ 200 characters | Komondor username, or a name for someone without an account. Required (non-blank) when setting a date |
| `hpcPreservationReason` | String, ≤ 1000 characters | Required (non-blank) when setting a date |

- The administrator is already recorded from the token as `by` in
  `hpcPreservationHistory`. Each history entry also records `requestedBy` and
  `reason`.
- Clearing a date clears both fields and requires a reason, which is kept in
  the history entry only.
- An administrator may change the requester or reason without changing the
  date, for example to backfill existing holds. The update keeps the existing
  check on the expected date (409 if stale) and writes a history entry.
- `PUT /project/hpc-preservation` adds both fields to its allow-list. Update
  `openapi.yaml`.
- Everyone who can see the project sees the date, requester and reason. Tell
  the administrator so in the form ("Visible to everyone who can see this
  project").
- Deploy API and web together, API first. The new API may reject the older
  web's save, which lacks the new fields.

## 3. Fixes from the 14 November review (API + web)

These are findings 2–5 of the [review](HPC_PRESERVATION_REVIEW_2026-11-14.md):

- **Finding 2: malformed stored value.**
  - Expose an invalid flag in the public storage summary, so the page's
    "needs administrator attention" notice can appear.
  - Let an administrator overwrite a non-date value. One way is an explicit
    `expectedPreserveOnHpcUntil: "invalid"`, whose update condition matches
    only a stored value that is not a date or null.
  - Record the raw previous value in history as a string.
- **Finding 3: casting.** Treat anything other than a BSON date, null or a
  missing field as invalid, by reading the raw stored value rather than the
  Mongoose-cast one. Apply this in the CLI (`deletion-command`,
  `confirm-absent`), the API resolver and the report in section 5.
- **Finding 4: API accepts any timestamp.**
  - When setting a date, accept only `YYYY-MM-DDT23:59:59.999Z`, in the future.
  - Clearing stays a separate action.
  - Document both rules in `openapi.yaml`.
- **Finding 5: no contact method.**
  - Replace the bare "Contact George Deeks" text with a `mailto:` link. Take
    the address from web runtime config `HPC_RETENTION_CONTACT_EMAIL`.
  - Prefill the subject "HPC retention request: <project name>" and a body
    with the project's link.
  - If the setting is unset, show the name without a link.
  - Never hardcode an address. This link is the request process from policy
    point 3.

## 4. When a project is due (API + web)

Compute these; do not store them:

- `archiveDueAt` = age basis (policy point 2) + `HPC_RETENTION_YEARS`.
- `hpcDeletionEligibleAt`, by storage state:

  | State | Value |
  | --- | --- |
  | `hpc`, `migrating` | later of `archiveDueAt` and the keep date; the project must be copied first |
  | `aws_pending_hpc_deletion` | later of `s3VerifiedAt` and the keep date. A verified copy means it was already due when archived; do not recompute its age, so the October batch decisions stand |
  | `aws` | none: the HPC copy is gone |
  | invalid keep date | none, flagged as needing attention |

Show both on the project page from the day a project is created, to everyone
who can see it. Suggested wording:

- Not yet archived: "Due to move to AWS around <Month YYYY>." If that date has
  passed: "Due to move to AWS (awaiting the next archive run)."
- Every page: "Archiving copies the data to AWS. The HPC copy is removed
  afterwards unless a keep date is set. This Komondor record stays."
- With a keep date: "Kept on HPC until <date>. Requested by <who>: <reason>."
  Follow it with the contact link from section 3.

`toJSON` and `publicStorageSummary` are synchronous, so the newest-Run lookup
must live in an async path, such as the storage-locations response used by
`ProjectStorage.vue`.

## 5. Deletion-due report (API script)

Add `scripts/hpc-deletion-due-report.js`. It must be read-only and write
nothing to the database.

- **Selection.** Use normal model queries, which hide retired Projects. Select
  projects whose HPC copy still exists (`hpc`, `migrating`,
  `aws_pending_hpc_deletion`) and whose `hpcDeletionEligibleAt` falls on or
  before now plus the window. Default window: 6 months, set with
  `--within-months`. **Include overdue projects**, so a hold set and expired
  between two reports still appears.
- **CSV, one row per project,** sorted by `eligible_from`:
  - Asked for by George: `owner_username`, `group_name`, `project_name`,
    `project_url` (`WEB_APP_URL` + `/project?id=<id>`), `eligible_from`
    (UTC date).
  - Also: `project_id`, `storage_state`, `on_aws` (verified: yes/no),
    `overdue` (yes/no), `hpc_path` (as the project page shows it),
    `keep_until`, `keep_requested_by`, `keep_reason`, `age_basis_at`, `notes`.
  - In `notes`, show any disposition the reconciliation recorded. The six
    Kamoun manual-disposal entries have no AWS copy and must not look like
    ordinary archive backlog. Investigate how they are recorded; do not add new
    markers without asking.
  - List projects with an invalid keep date in the same file, with
    `notes: invalid keep date`.
- **Output.** By default write the CSV to stdout, or to `--out <file>`.
- **Email.** `--email` sends it as an attachment to `HPC_DUE_REPORT_TO`
  (comma-separated, from the environment).
  - Extend `lib/utils/sendEmail.js` to pass nodemailer `attachments`.
  - Subject: "Komondor: N projects due for HPC deletion review by <date>".
  - Body: counts of overdue, due within the window, not yet on AWS, keep dates
    expiring, and invalid.
  - State in the body that it is a review list, not a deletion instruction.
- **Scheduling.** Document a crontab entry for 1 January and 1 July, run as
  `tsldata` with the nvm Node used by PM2. **Do not install it.**

The first run will be long: the 170 archived projects awaiting review, plus any
project from any group that is over five years old and not yet on AWS. That is
expected.

## 6. Documentation

- Update `HPC_RETENTION.md` and `HPC_DELETION_CHECKLIST.md`: once the new
  fields are populated in production, the Project's keep date, requester and
  reason are the record, and `hpc-retention-holds.json` becomes history.
- Add the report to `S3_PROJECT_ARCHIVAL_RUNBOOK.md`.
- Update `STATUS.md`.

## Constraints

- **Branches.** Start from current master (API at or after `f2e464c`, web
  `5e7bcf2`).
  Create new branches and push them. Do not merge to master and do not deploy.
- **Production.** No production database, credentials or data changes. Do not
  install cron.
- **Email.** Send no real email; tests use the existing development/test
  logging or a mocked transport.
- **Integration tests** run against a throwaway `mongod` with its own data
  directory, because the helpers delete data.
- **George's checkout.** Work in worktrees and leave his uncommitted
  `tests/unit/pages/projects-new.test.js` in the web checkout untouched.
- **Report back:**
  - branch names and head commits
  - test counts: API unit, integration, web, and the web production build
  - what changed for each section above
  - any decision you took that this spec does not cover

## George's steps (not code)

**Now, with the deployed feature (deployed 16 November):**

1. Set keep dates on the five manual holds and the 11 Kamoun KEEP Projects
   ([list with IDs](HPC_RETENTION.md#keep-dates-to-set-george)).
2. Run the checklist's type check.

**After this work deploys:**

1. Backfill requester and reason on those holds.
2. Set `HPC_DUE_REPORT_TO` and `HPC_RETENTION_CONTACT_EMAIL`.
3. Run the report once by hand.
4. Install the twice-yearly schedule.
