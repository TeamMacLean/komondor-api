# Manual checks before deploying `security/gates-1-2-3`

This is the release-operator checklist. The automated Linux and real-Mongo checks have now been
run in development; the production database, real HPC mount, real browser, and final deployment
still need the checks below. Work through them in order. Each step says what "pass" looks like
and what to do when it doesn't.

**Read step 0 before anything else.** It is the one that can take the API down.

Before starting, copy the three exact commit hashes approved in the final review into the deploy
record. Verify each checkout is at that hash and clean; do not deploy a mutable branch name or
whatever happens to be its HEAD:

```bash
git rev-parse HEAD
git status --short
```

The first command must equal the reviewed hash and the second must print nothing. This matters
especially while sibling repositories are being audited in parallel.

Nothing is pushed. Automated state at the time of writing:

- API: 53 suites / 1782 tests (all passed on Darwin; 1780 passed and 2 platform-skipped on
  Debian), plus 7 suites / 38 integration tests against real MongoDB 7.0.29. Both suites passed
  on Darwin and Debian/Node 24. The CI coverage gate (`yarn test --coverage --ci`, thresholds in
  `jest.config.js`) passes — it is a separate check from the test count, and a release that
  passes every test can still fail it. Run it before pushing; see step 1.
- Power: project `verify` gate green (typecheck, ESLint, Prettier, 260 tests).
- Web: 513 tests and the production build green; touched-file lint has zero errors and three
  pre-existing component-order warnings in `pages/runs/new.vue`.

---

## 0. STOP — this release can refuse to boot

A previous round made an index-build failure **fatal at startup** (`Run.init()` /
`IngestJob.init()` are awaited by `server.js`). That was deliberate: mongoose otherwise only
_logs_ the failure and the app serves traffic with the uniqueness constraint quietly absent.

The consequence is that **if production's `runs` collection has a conflicting index, this deploy
will not start.** I verified against real MongoDB 7.0.29 that `Run.init()` rejects with error 85
even when the existing index is a perfectly good unique index that merely has a different name.
The classifier also distinguishes an inherited collection-default collation from an explicit
`simple` collation (which Mongo omits from `listIndexes`) and treats `hidden` as planner state,
not an index-definition conflict. Those cases are pinned to the server's actual create result.

Run the preflight against production **before** you deploy, from the prod box:

```bash
cd /storage/www/komondor-api && node scripts/check-run-duplicates.js
```

Read-only. Nothing is written, nothing is locked, safe while the API is serving.

| Exit  | Meaning                                                                     | Do                                                          |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **0** | Safe to deploy                                                              | Continue to step 1                                          |
| **1** | Duplicate `{sample, name}` documents or malformed indexed field types exist | **Stop.** Resolve the listed documents by hand, then re-run |
| **3** | A conflicting index is present                                              | **Stop.** See below                                         |
| **2** | Could not connect or query                                                  | **Stop.** Fix that first — do not deploy blind              |

Then inspect the stored ingest backlog, which this release's stricter validation can refuse:

```bash
cd /storage/www/komondor-api && node scripts/inspect-ingest-backlog.js
```

Also read-only. Exit 0 means no unfinished job would be refused — and if the `ingestjobs`
collection does not exist at all, it says so in one line and stops, which is the likely case
since the durable queue postdates the currently deployed master. Exit 1 lists each malformed
payload, orphan Run, missing/renamed/ambiguous LibraryType, legacy option value whose Mongoose
Boolean casting changes its meaning, or paired/indexed contradiction; repair those by hand before
deploying. Do **not** blanket-migrate, and note that a plain no-body reingest does **not** repair
them (BREAKING_CHANGES.md §37).

This first run is an early warning, not a cutover snapshot. Once writes/uploads are quiesced in
step 3, run **both** preflight commands again immediately before reloading the API. A read-only
inspection while the old API is serving cannot see a job accepted one second later.

On preflight exit 3, the output names each conflicting index and why. To repair:

```bash
cd /storage/www/komondor-api && node scripts/check-run-duplicates.js --fix
```

**`--fix` is not safe to run while runs are being created.** It drops and rebuilds, and between
those two steps nothing enforces uniqueness. Do it in the deploy window with the API stopped. If
it prints anything about the collection **STILL** reporting a conflict after rebuilding, stop and
read that message — it means the collection carries index option defaults and re-running `--fix`
will not help.

---

## 1. Repeat the Linux gates in the release environment

The full unit and real-Mongo integration suites passed in Debian/Node 24 during review. Repeat
them in CI or the actual release image because two paths genuinely depend on the host filesystem:

- `copyPinnedSourceTo` now promotes with `link()` + `unlink()` on a path that previously used
  `copyFile()`. The round-3 symlink bug existed _precisely because_ Linux's `link(2)` does not
  dereference a symlink given as `oldpath` and Darwin's does.
- The mid-copy guard no longer trusts timestamps for integrity: it hashes the exact copy stream
  and compares it with a stable positional read of the pinned source. The Linux run is what
  exposed that even bigint `ctimeNs` can stay unchanged across rapid writes.

On an Ubuntu/Debian box with the same Node major as production:

```bash
git rev-parse HEAD
yarn install --frozen-lockfile
yarn jest
```

The hash must equal the exact approved API hash from the deploy record. **Pass:** 53 suites /
1782 tests (1780 passed, 2 skipped). **Fail:** stop and investigate; do not work around it.

Then the coverage gate, which is what CI actually runs and is a **separate check** from the test
count — a release that passes every test can still fail it, and one did during review:

```bash
yarn test --coverage --ci
```

**Pass:** no `coverage threshold ... not met` line. Thresholds live in `jest.config.js`; `scripts/`
is deliberately excluded from the figure because those CLIs are covered by the integration job
below, which this run cannot execute. A single `socket hang up` failure on re-run is the known
supertest transport flake that CI itself tolerates and retries — anything else is real.

Then the integration suites, which need a real mongod:

```bash
MONGODB_URI=mongodb://localhost:27017/komondor-integration-test yarn test:integration
```

**Pass:** 7 suites / 38 tests. The suite now _refuses_ to run without an explicit `MONGODB_URI`
(it used to silently target a different database than the app) — that error is correct behaviour,
not a failure.

---

## 2. Verify the HPC retention path against a real mount

The unit tests use a temp directory on one filesystem. Production's HPC inbox and datastore may
be separate mounts, which is the whole reason the cross-device copy path exists.

With a scratch run on the real mounts, confirm:

- [ ] An `hpc-mv` claim leaves the source **in place** and the datastore copy is a **different
      inode** (`stat -c %i <src> <dst>` — the two numbers must differ).
- [ ] A permitted **symlink** in the inbox is claimed successfully, and the datastore ends up
      with the real bytes, not a link (`stat -c %F <dst>` → `regular file`).
- [ ] Interrupting a large claim mid-copy (kill the API) leaves **no file at the final destination
      name**. A SIGKILL may leave the deterministic `.part-*` file because no cleanup handler can
      run; restart and retry must safely replace/remove that partial and then succeed.

That third one is the crash-safety property, and it is the one worth actually doing rather than
trusting.

---

## 3. Deploy WEB FIRST, then the API

The API requires authentication on the tus mount; the web client only started sending it on
`fix/tus-authentication`. I originally wrote this section with the API first, and an audit
corrected it: **new web against the old API is backward-compatible** — the old upload endpoint is
permissive and simply ignores the extra `Authorization` header — whereas **new API against old
web 401s every upload immediately**. That compatibility is limited to the upload transport. Both
web generations send reciprocal `sibling` names for local paired reads, while the old API looks
for the never-emitted `rowID`; allowing paired submissions during the gap can therefore complete
them with null sibling links. This is the pre-existing bug the new API fixes, but it means the
deploy window is safe only while submissions are quiesced.

Order:

1. **Before deploying any app**, stop new uploads and all Run submissions from Web, Power and
   scripts. Let active uploads finish, then inventory the upload directory. Uploads staged by the
   old unauthenticated endpoint have no owner and cannot be claimed after ownership enforcement;
   finish/attach them with the old API now or deliberately re-upload them later
   (BREAKING_CHANGES.md §29).
2. With writes quiesced, re-run **both** step-0 preflights. Only continue if both are green.
3. Deploy Web, then reload the API immediately. Keep ordinary submissions quiesced: an old browser
   tab does not send upload authentication and will 401 against the new API. Have users reload
   their tabs after the cutover.
4. Deploy Power. Its changes are compatible with either API generation, but putting it after the
   API makes the supervised three-app cutover unambiguous.
5. Check that the API came up, then run the controlled browser, paired-run and Power smokes in
   steps 4 and 5 before reopening submissions.

Check the API actually came up:

```bash
pm2 logs komondor-api --lines 50
```

`[LOGIN]` and `[Background Job]` lines go to **stdout**; the log you usually paste is **stderr
only**. If the process is restart-looping, the index build is the first thing to suspect — go
back to step 0.

---

## 4. Smoke test through the real browser

Not curl. The CORS and preflight behaviour changed, and only a browser exercises it properly.

- [ ] **Upload a small file** through the real web app. It should complete.
- [ ] With devtools open, confirm the `OPTIONS /uploads` preflight returns the tus capability
      headers (`Tus-Max-Size`, `Tus-Version`, `Tus-Extension`). These were missing before this
      release.
- [ ] **Let a token expire, or clear it, and retry an upload.** The response must be a **401 with
      `Access-Control-Allow-Origin` set** — you should see a readable
      `{"error":"Authentication required"}`, _not_ an opaque CORS failure in the console. I broke
      this once during this round and caught it only in review; it is worth confirming with your
      own eyes.
- [ ] Confirm a non-upload route (e.g. loading the runs list) still works — the CORS change is
      scoped to `/uploads`, and I want that scoping confirmed against the real origin.

---

## 5. Smoke test the reingest correction — the headline fix

This is the workflow the whole B6 fix exists for, and it has never run against production data.

- [ ] **First, an ordinary paired upload.** Two files, paired, through the web form. Before this
      release the API rejected the web's own payload outright (`400 ... is paired but missing
rowID`), and before
      _that_ the pair landed silently unpaired. Confirm the run completes and **both** Reads have
      a non-null `sibling` — the second half is the one that was silently wrong for a long time.
- [ ] Create a **paired** run where one file has a deliberately bad upload id, so the ingest
      fails with one mate delivered and one not.
- [ ] `POST /runs/:id/reingest` with a replacement payload containing **only the broken file**.
      It must return **200**, not 400.
- [ ] Confirm the run completes and **both** Reads end up with a non-null `sibling`.
- [ ] Repeat with a **paired-indexed** run where the pair mate and index read both fail. Correct
      only the mate. The stored retry payload must still contain the omitted index read, and the
      run must not complete until that index is also corrected and delivered.
- [ ] Try the same incomplete paired-indexed list with `replaceRawFiles: true`. It must return
      **400** because an explicit full replacement still cannot contradict the Run's indexed
      LibraryType.
- [ ] Try changing an **already-delivered** file's `uploadName` in a replacement payload. It must
      return **409** naming that file — the guard against a silent no-op.

---

## 6. Watch for these in the first week

Grep the logs (**stdout**, not just the stderr you usually paste):

- `the source was modified while it was being copied` — the new mid-copy guard firing. A few is
  expected if people re-scp over staging names. A **flood** means the guard is too strict for
  your workflow; investigate rather than disabling the content comparison.
- Retained HPC and cross-device copies now perform one full positional source read after the copy
  to prove the streamed bytes are coherent. For a 50 GiB file, budget for copy time plus one
  verification read and watch first-week ingest throughput.
- `is not a bare filename` — the new canonical-name rule (BREAKING_CHANGES.md §37) rejecting a
  client that used to work. If komondor-nudge or a script sends path-qualified names, this is
  where you will find out.
- `cannot link ... — no ingested read for` — a pairing declaration the worker could not resolve.
  Should be impossible for a payload that went through `POST /runs/new`, since validation now
  requires mutual siblings; if it appears, something is reaching the queue another way, or a
  payload stored before this release is being replayed.

---

## 7. Rollback

Rollback is **not** just `git checkout` plus `pm2 reload`. This release accepts a Run only after it
has durably enqueued its file work; the previous API has no ingest worker and cannot drain or
reingest those jobs. It also cannot safely reopen local paired submissions: both Web generations
send reciprocal `sibling` names, but the old API looks for `rowID` and can complete the Run with
both sibling links null. Finally, uploads staged through the old API have no recorded owner and
cannot be claimed after this release is restored.

Before a planned API rollback:

1. Quiesce new uploads and every Run producer: Web, Power, scripts and any direct client. Leave the
   current API running so its worker can finish accepted work.
2. Run `node scripts/inspect-ingest-backlog.js` from the current checkout. Exit 0 is not enough: a
   structurally valid pending job also exits 0. Require the literal line
   `Checked 0 unfinished ingest job(s).` (`No ingestjobs collection ...` is equivalent only if
   this release never started). If the count is non-zero, wait for the worker or correct the jobs
   through the current API before continuing.
3. Check out the recorded previous API commit and reload PM2. Confirm the process is online **and**
   the production health check receives an HTTP response; recent log lines alone can describe a
   previous start.
4. Keep uploads and Run/Power submissions quiesced while the old API is serving. It is suitable as
   a read-service rollback, not as a return to safe Run ingest. Restore this API version and
   complete the controlled smokes before reopening writes.

If the incident makes waiting for the queue impossible, save the inspector output and perform the
API rollback as read-only: do not delete the `ingestjobs` rows or staged files. They remain durable
but will not progress on the old API; roll forward to this version to resume or reingest them.

The new Web and Power builds may remain deployed during that read-only rollback. For a full
three-app rollback, keep producers quiesced, drain the queue, roll back the API first, then Power
if desired, and Web last. Rolling Web back while the new API is still live makes every old-tab
upload fail authentication; rolling all three back does not make paired local writes safe.

If you ran `--fix` in step 0, do not undo the generated unique `sample_1_name_1` index. The old API
continues serving with that stronger constraint, although its unawaited model index build may log
an index-options conflict because its schema declares the same key non-unique. Leave the unique
index in place; do not recreate the old custom or non-unique definition to silence the log.

---

## 8. Known open items — your call, not mine

These are known follow-ups rather than release blockers. I flagged them to the auditor in
`docs/AUDIT_RESPONSE_PROMPT_R6.md`; none of them is a silent-corruption risk.

1. **Power waits the full 30-minute poll window before reporting some terminal errors.** The entry
   is still correctly marked as errored; it is a latency and message-quality problem, confirmed
   as such by the audit.
2. **Pre-existing lint errors in komondor-web**, on files this branch does not touch.
3. **Mongoose 5 to 7 is still deferred.** The known dependency advisory remains accepted for this
   supervised private-network deployment; plan the major-version upgrade separately.

---

## If you cannot iterate with ChatGPT any further

Then the minimum I would want done before this touches production is, in order:

1. **Step 0** — non-negotiable, this release can fail to boot without it.
2. **Step 1** — repeat the already-green Linux run in the release environment; Linux testing
   exposed a real timestamp assumption during this review.
3. **Step 4's expired-token check** — the specific thing I broke and self-caught this round.
4. **Step 5** — the reingest correction, since it is the headline change and has never run
   against real data.

Steps 2, 3 and 6 are confirmations of things I have reasonable evidence for. Steps 1, 4 and 5
cover things where my evidence is Darwin-only, my own test suite, or nothing.
