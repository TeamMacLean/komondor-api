# HPC retention follow-up — review, 16 November 2026

Claude reviewed ChatGPT/Codex's implementation of the
[follow-up spec](SPEC_HPC_RETENTION_FOLLOWUP_2026-11-16.md), using a Standards
review and a Spec review run separately, plus a check of the API/web contract.
Both branches were merged to master on 16 November, at George's instruction,
after the fixes below.

| Repo | Reviewed range | Fix range | Merged head |
| --- | --- | --- | --- |
| komondor-api | `d165b1a...75d8337` | `75d8337...7225374` | `7225374` |
| komondor-web | `a82a65d...ed9be93` | `ed9be93...1e9f04f` | `1e9f04f` |

Both branches were rebased first: the API onto the keep-dates table and
16 November deployment record, the web onto the home sidebar and the
three-column project layout. Both rebases kept those changes.

## Findings and fixes

All were fixed in the fix range, each with a regression test.

| Axis | Finding | Fix |
| --- | --- | --- |
| Spec | Clearing a hold reused the saved reason as the release reason | Separate release-reason field, empty until filled in |
| Spec | A failed due-date lookup made the whole project page return 500 | The page loads with the dates marked unavailable |
| Spec | The report silently dropped projects with an unreadable `createdAt` or `s3VerifiedAt`, or an invalid storage state | ObjectId fallback; the rest are listed as "eligibility unknown" |
| Spec | The email subject counted invalid rows as due | The subject counts only dated projects; attention rows are counted in the body |
| Standards | No `BREAKING_CHANGES.md` entry for the stricter `PUT /project/hpc-preservation` | Entry added: deploy API and web together, API first |
| Standards | `HPC_RETENTION_YEARS` was checked only at first use | Checked at startup; an invalid or empty value refuses to start |
| Standards | `openapi.yaml` descriptions out of date | Corrected |
| Standards | `--out` overwrote existing files | Refuses to overwrite and creates the file with mode 0600; the documented schedule emails without writing a file |
| Accessibility | Disabled-action wrapper had no role or name | `role="button"`, `aria-disabled`, labelled by the action text |

## Left as they are (optional)

- Archived projects also show an "age-based AWS move date".
- When two administrators edit the requester or reason at the same time, the
  second save overwrites the first; only the date is fenced, as specified.
- Release history entries do not record who asked for the release.
- Duplicated logic between the report and the project page, and the four
  preservation fields not grouped into one object, are deferred refactors.

## Validation at the merged heads

Claude reran these in isolated worktrees, with a throwaway `mongod` that had
its own data directory:

| Check | Result |
| --- | --- |
| API unit and contract | 2,287 passed |
| API integration | 115 passed |
| Web unit | 641 passed |
| Web production build | passed |
| Lint on the changed web files | clean |

## Not verified

- No browser or screen-reader check of the rendered page, so tooltip behaviour
  on keyboard focus and how the disabled actions are announced are unchecked.
- No real email was sent.
- The report has not been run against production data. Its first run may list
  more attention rows than expected, for example projects with an invalid
  storage state.
