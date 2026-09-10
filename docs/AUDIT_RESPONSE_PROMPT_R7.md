# Release gate — seventh pass

This round is different from the six before it, and the difference matters more than anything
else in this document: **it is a release gate, not a bug hunt.**

The aim is to get this release into production **as soon as it is safe to**, accepting that small
bugs may remain. Six rounds of audit have already found and fixed everything that reproduced as
data loss, corruption, or a broken workflow. What is left is the risk that comes from the size of
the change itself, and the only way to retire that risk now is to ship carefully and watch — not
to keep changing things. So the bar for "blocking" is deliberately high, and the bar for "make a
change" is higher still.

**You may write and make changes this round.** If you do, you must report every change back to me
in the format in section 8, because I will verify each one before it ships. Read section 7 before
touching anything.

---

## 1. What I need

A **GO / NO-GO for a supervised production deployment of all three apps together**, judged by one
question only:

> Will this break on day one, or lose or corrupt data, for the people who actually use it?

"Blocking" means exactly that. A finding that is real but would not fire in the first week of
ordinary use goes in the deferred list (section 8), not in front of the deploy. If you are unsure
which side of that line something falls, **report it, do not fix it.**

---

## 2. Operating context — the lens

Small single-institution research API on a private network. Three consuming apps
(komondor-web, komondor-power, komondor-nudge). Users are research scientists — **not
adversaries**. **One PM2 fork-mode process**, pinned in `ecosystem.config.js`. Small team.

Weight everything by what fires **by accident in normal use**: an ordinary upload, an ordinary
paired run, an ordinary CSV through Power, a token expiring, a scientist re-sending a file. Do not
raise speculative hardening. Do not propose refactors. Do not widen scope.

---

## 3. Current state

```
komondor-api    branch security/gates-1-2-3            HEAD 4ced214
komondor-web    branch fix/tus-authentication          HEAD 10b5d73
komondor-power  branch fix/ingest-completion-contract  HEAD 8c3595b
```

All three worktrees are **clean**. Nothing is pushed or merged. Deploy order is **web first**,
then the API, then Power — the runbook explains why and it has been independently confirmed.

Independently re-measured on the tree above, not taken from records:

|                                                    | Result                                  |
| -------------------------------------------------- | --------------------------------------- |
| API unit, macOS                                    | 53 suites / 1782                        |
| API unit, Debian / Node 24                         | 1780 passed + 2 platform skips          |
| API integration, real MongoDB 7.0.29               | 7 suites / 38, macOS **and** Linux      |
| API CI coverage gate (`yarn test --coverage --ci`) | passes — 75.81 / 81.67 / 66.27 / 75.86  |
| Web                                                | 16 files / 513, production build green  |
| Power                                              | 16 files / 260, `yarn run verify` green |
| `git diff --check`                                 | clean ×3                                |

---

## 4. What has already been reproduced by execution — do not redo it

A final adversarial review drove each of these on **both macOS and Linux**, against real
MongoDB 7, from the actual code rather than the tests. They are settled unless you can show
otherwise with a reproduction:

- **File copies.** A same-inode rewrite with mtime restored exactly (`cp -p` semantics) is
  refused with no destination and no leftover partial; single chmod / added hard link during a
  copy is tolerated; occupied destinations are never clobbered; the digest is of the exact
  copied bytes, compared against a positional read that never moves the caller's handle.
- **Upload cleanup.** An open request protects an upload from the abandoned sweep however stale
  it looks; complete uploads are never swept; cleanup ownership and resume exclude each other
  synchronously, with 410 on the losing side.
- **The client contract.** The **exact** payloads komondor-web and komondor-power emit pass the
  API's validator and its LibraryType rules in every direction. `rowID` (a contract that only
  ever existed in this API's own tests) is rejected; `md5: null` is accepted; an empty HPC
  `relativePath: ""` resolves to the root; duplicate basenames in one list are refused and the
  same basename across raw/additional is allowed.
- **Reingest.** R1 delivered / R2 + I1 failed: retrying only R2 retains I1; an explicit full
  replacement omitting I1 is refused by the LibraryType rule; delivered descriptors are immutable
  except for relationship metadata; the worker re-validates before moving any byte.
- **Worker invariants.** Empty raw-file lists, self-siblings, non-reciprocal pairs, duplicate
  names and missing Reads all throw rather than complete.
- **Index preflight.** Agrees with the server on all 16 variants — generated vs custom names,
  default vs explicit collation, hidden, storageEngine, partial, sparse, non-unique.
- **Backlog inspector.** Model-free (importing it compiles nothing); a strict superset of the
  worker's refusals across orphan Runs, missing/ambiguous LibraryTypes, legacy booleans, and
  case variants under a default collation. No false greens.
- **Web.** Pairing map is a `Map` (prototype-safe); controls lock during and after validation;
  the additional-uploads gate is real rather than hard-coded.

---

## 5. Known, accepted, and out of scope for this release

These are real and are **not** to be fixed now. If you disagree that one of them can wait,
argue it in the report — do not change it.

- **Coverage margin is thin.** The application figure sits 0.8 statements / 0.27 functions above
  threshold after `scripts/` was excluded from the ratchet. The next untested file reddens CI.
  A conscious re-baseline or new tests is a follow-up, not a release change.
- **No runtime single-process guard.** `ecosystem.config.js` pins fork mode / one instance, but
  nothing asserts it at boot. Adding one against PM2 semantics I cannot verify on production is
  riskier than the documented pin.
- **Indexed LibraryTypes cannot be created through the app** — `routes/options.js:114-118`
  never maps `indexed`. Pre-existing and documented in `openapi.yaml`. The release is
  self-consistent without it (no indexed type → no indexed uploads emitted); enabling the feature
  is a product decision for later.
- **Power waits its full 30-minute poll window** before surfacing some terminal errors.
  Correctness is preserved; latency only.
- **Nested `entryFingerprint`** does not see inside `data.*`. Nested data is not used to identify
  or move bytes.
- **19 pre-existing web lint errors** on files this branch does not touch.
- **Mongoose 5 → 7** deferred.

---

## 6. Where to actually look — day-one reliability across all three apps

The value you can add now is at the seams, exercised the way a real user would hit them on the
first day. Concretely, and in this order:

1. **Boot.** Does the API start, against a database in the state production is actually in?
   Index-build failure is fatal at startup by design. The runbook's step 0 (preflight + backlog
   inspector) exists for this; check that following it literally, as someone who has never seen
   this codebase, cannot leave the API down.
2. **The coordinated cutover.** Web first, then API. What does a user with an old web tab open
   see at each moment? Is anything that used to work silently broken _between_ the two deploys,
   beyond what the runbook already says (unowned staged uploads, reload old tabs)?
3. **The first real upload.** Through komondor-web, with a real browser: preflight, 201, PATCH,
   completion, and the 401-with-CORS on an expired token. Then the first **paired** run — both
   Reads must end up with a non-null `sibling`. That path was silently broken for a long time
   and loudly broken until recently; it is the single thing most worth seeing with your own eyes.
4. **The first Power CSV.** A paired run and an unpaired run through the whole Power pipeline
   against the new API. Power's payload shape is verified against the validator; what is not
   verified is the end-to-end run against a live API with polling.
5. **The first reingest correction.** One mate of a pair with a bad upload id, corrected through
   `POST /runs/:id/reingest` with only that file. 200, then a completed run with both siblings.
6. **Rollback.** Follow the runbook's §7 as written. Is it actually enough for an operator who
   is panicking at 5pm? In particular: after `--fix` renamed the index, after web is deployed
   but the API rolled back, and after a Power deploy.

If you have a way to run any of 3–5 against a real deployed pair rather than in isolation, that
is worth more than any amount of further code reading.

---

## 7. Rules if you make a change

You may fix something **only** if it meets the section-1 bar — it would break day one or lose
data. Then:

- **Smallest change that closes it.** No refactors, renames, reformatting, dependency changes,
  threshold changes, or "while I'm here" tidying. If the smallest change is not small, stop and
  report instead.
- **One fix per commit**, with a message that says _why_, not just what. Do not amend or squash
  anything already on the branch.
- **Do not change a cross-repo contract.** If the fix would alter what one app sends or another
  accepts, stop and report. A coordinated contract change is exactly the kind of risk this round
  exists to avoid.
- **Run the gates you touched**, and always the API coverage gate if you touched the API at all:
  `yarn test --coverage --ci`, then `MONGODB_URI=... yarn test:integration` if you touched anything
  under `lib/`, `models/`, `routes/` or `scripts/`. Web: `yarn test:unit`. Power: `yarn run verify`
  (not `yarn check` — that is a yarn builtin that shadows the script).
- **Update the runbook** if the fix changes anything an operator does.
- If a change makes a section-4 claim false, say so explicitly.

I will re-verify every change you report before it ships. A change you make and do not report
will be treated as an unreviewed change to a release branch, which is worse than the bug it fixed.

---

## 8. What to return

1. **GO or NO-GO**, in one line, against the section-1 question.
2. **Blockers**, if any — severity, exact file and line, an executable reproduction, expected
   versus actual, and why the existing tests missed it.
3. **Every change you made**, each as:
   - repo, commit hash, files
   - the reproduction that motivated it
   - what changed and why that was the smallest change
   - the exact gates you ran and their counts
   - whether any section-4 claim or runbook step is now out of date
4. **Deferred findings** — real, but not day-one — as a plain list for the follow-up milestone.
   This is where most of what you find should go.
5. **Confirmation or correction of the deploy and rollback order**, and of whether the runbook is
   sufficient for an operator who has never seen these changes.

If nothing meets the bar, say GO plainly and put everything else in the deferred list. That is a
good outcome, not a weak one.
